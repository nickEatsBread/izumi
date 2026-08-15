//! Direct P2P VPN binding: adapter enumeration plus the session-level kill switch.
//!
//! Izumi's cross-platform adapter binding is enforced at the session layer:
//!   * a bound engine refuses to START unless the adapter is up with a routable address;
//!   * a network monitor pauses every torrent in every engine the moment the adapter drops and
//!     resumes them when it returns, so a crashed VPN cannot quietly continue on the ISP route;
//!   * while the VPN is connected its default route carries the traffic, like any other app.
//! librqbit 9 can bind by device name on Unix, but not Windows. Keep one consistent fail-closed
//! behavior until the native path can be validated on ordinary Linux/Deck accounts and Android.

use std::{
    net::IpAddr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock, Weak,
    },
    time::Duration,
};

use iroh::Watcher as _;
use librqbit::Session;
use n0_future::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Shared by both engines' config guards: the binding (SOCKS proxy or bound adapter) is locked
/// into a session at creation, so changing it mid-process requires a restart.
pub(crate) const BINDING_CHANGED_ERROR: &str = "The Direct P2P network binding changed after its session started. Restart Izumi to apply it safely.";

/// The subset of adapter state binding decisions are made from. netdev's full struct is reduced
/// to this so the matching/readiness rules stay pure and unit-testable.
#[derive(Debug, Clone)]
pub(crate) struct IfaceView {
    name: String,
    friendly: Option<String>,
    description: Option<String>,
    tunnel_like_type: bool,
    up: bool,
    default_route: bool,
    ips: Vec<IpAddr>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetInterfaceInfo {
    /// The OS identifier stored in settings (a GUID on Windows, `wg0`-style elsewhere).
    name: String,
    /// What the user recognises: the Windows friendly name ("NordLynx"), else the name itself.
    label: String,
    ips: Vec<String>,
    is_up: bool,
    is_vpn_like: bool,
    is_default_route: bool,
}

/// Loopback/link-local/unspecified addresses cannot carry peer traffic; an adapter that only has
/// those (e.g. NordLynx while NordVPN is disconnected) counts as not connected.
fn routable(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => !v4.is_loopback() && !v4.is_link_local() && !v4.is_unspecified(),
        IpAddr::V6(v6) => {
            !v6.is_loopback() && !v6.is_unspecified() && (v6.segments()[0] & 0xffc0) != 0xfe80
        }
    }
}

fn ready(iface: &IfaceView) -> bool {
    iface.up && iface.ips.iter().any(routable)
}

fn display_label(iface: &IfaceView) -> String {
    iface
        .friendly
        .clone()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| iface.name.clone())
}

/// `tun0`, `wg0`, `utun4`, `wg-mullvad`, bare `tun` — a known device prefix followed by nothing,
/// a dash, or digits. Plain prefix matching would swallow names like "Wi-Fi" via `wi`-style rules.
fn name_is_device(name: &str, prefix: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    match lower.strip_prefix(prefix) {
        Some(rest) => {
            rest.is_empty() || rest.starts_with('-') || rest.chars().all(|c| c.is_ascii_digit())
        }
        None => false,
    }
}

/// Cosmetic dropdown badge only — the user picks the adapter either way. Interface type says
/// tunnel/PPP, or the name/description carries a known VPN product or tunnel-device pattern.
fn is_vpn_like(iface: &IfaceView) -> bool {
    if iface.tunnel_like_type {
        return true;
    }
    let haystack = format!(
        "{} {} {}",
        iface.name,
        iface.friendly.as_deref().unwrap_or(""),
        iface.description.as_deref().unwrap_or("")
    )
    .to_lowercase();
    const HINTS: &[&str] = &[
        "vpn",
        "tunnel",
        "nordlynx",
        "mullvad",
        "gotatun",
        "proton",
        "wireguard",
        "wintun",
        "openvpn",
        "lightway",
        "expressvpn",
        "surfshark",
        "windscribe",
        "cyberghost",
        "ipvanish",
        "private internet access",
        "wgpia",
        "tailscale",
        "zerotier",
        "hamachi",
        "tap-",
    ];
    if HINTS.iter().any(|hint| haystack.contains(hint)) {
        return true;
    }
    const DEVICE_PREFIXES: &[&str] = &["tun", "tap", "utun", "wg", "ppp", "ipsec"];
    DEVICE_PREFIXES
        .iter()
        .any(|prefix| name_is_device(&iface.name, prefix))
}

/// Settings store the exact `name`, but VPN clients occasionally recreate adapters with different
/// casing, and older saved values may hold a friendly name — accept those before failing.
fn find<'a>(interfaces: &'a [IfaceView], wanted: &str) -> Option<&'a IfaceView> {
    interfaces
        .iter()
        .find(|iface| iface.name == wanted)
        .or_else(|| {
            interfaces
                .iter()
                .find(|iface| iface.friendly.as_deref() == Some(wanted))
        })
        .or_else(|| {
            interfaces.iter().find(|iface| {
                iface.name.eq_ignore_ascii_case(wanted)
                    || iface
                        .friendly
                        .as_deref()
                        .is_some_and(|name| name.eq_ignore_ascii_case(wanted))
            })
        })
}

pub(crate) async fn snapshot() -> Result<Vec<IfaceView>, String> {
    tokio::task::spawn_blocking(|| {
        netdev::get_interfaces()
            .into_iter()
            .filter(|iface| !iface.is_loopback())
            .map(|iface| IfaceView {
                // NOT ProprietaryVirtual: Windows reports plenty of non-VPN virtual adapters as
                // IF_TYPE_PROP_VIRTUAL (stale "Local Area Connection" entries on the dev box).
                // Real VPN adapters that carry that type (wintun, OpenVPN DCO) are caught by the
                // product-name hints instead.
                tunnel_like_type: iface.is_tun()
                    || matches!(
                        iface.if_type,
                        netdev::prelude::InterfaceType::Tunnel
                            | netdev::prelude::InterfaceType::Ppp
                    ),
                up: iface.is_up(),
                default_route: iface.default,
                ips: iface
                    .ipv4
                    .iter()
                    .map(|net| IpAddr::V4(net.addr()))
                    .chain(iface.ipv6.iter().map(|net| IpAddr::V6(net.addr())))
                    .collect(),
                name: iface.name,
                friendly: iface.friendly_name,
                description: iface.description,
            })
            .collect()
    })
    .await
    .map_err(|error| format!("Could not scan network interfaces: {error}"))
}

/// Fail-closed gate used before a bound librqbit session is created.
pub(crate) async fn ensure_bound_iface_ready(name: &str) -> Result<(), String> {
    let interfaces = snapshot().await?;
    let Some(iface) = find(&interfaces, name) else {
        return Err(format!(
            "The bound network interface '{name}' was not found. Connect your VPN, or clear the binding in Settings → Network."
        ));
    };
    if !ready(iface) {
        return Err(format!(
            "The bound network interface '{}' is not connected. Connect your VPN and try again.",
            display_label(iface)
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn list_network_interfaces() -> Result<Vec<NetInterfaceInfo>, String> {
    let mut list: Vec<NetInterfaceInfo> = snapshot()
        .await?
        .iter()
        .map(|iface| NetInterfaceInfo {
            name: iface.name.clone(),
            label: display_label(iface),
            ips: iface
                .ips
                .iter()
                .filter(|ip| routable(ip))
                .map(|ip| ip.to_string())
                .collect(),
            is_up: iface.up,
            is_vpn_like: is_vpn_like(iface),
            is_default_route: iface.default_route,
        })
        .collect();
    // The dropdown's whole audience is "find my VPN adapter": VPN-looking first, connected before
    // down, then alphabetical.
    list.sort_by(|a, b| {
        (b.is_vpn_like, b.is_up)
            .cmp(&(a.is_vpn_like, a.is_up))
            .then_with(|| a.label.cmp(&b.label))
    });
    Ok(list)
}

#[derive(Default)]
struct GuardInner {
    sessions: Mutex<Vec<Weak<Session>>>,
    down: AtomicBool,
    monitor_started: AtomicBool,
}

/// Process-wide kill switch shared by the playback and download engines. The binding is locked by
/// the first engine to start (both read the same persisted setting, so a mismatch means the user
/// changed it in between — the same restart semantics as the SOCKS proxy).
#[derive(Default)]
pub struct VpnGuard {
    config: OnceLock<Option<String>>,
    inner: Arc<GuardInner>,
}

impl VpnGuard {
    pub async fn attach(
        &self,
        app: &AppHandle,
        bind_interface: Option<String>,
        session: &Arc<Session>,
    ) -> Result<(), String> {
        let locked = self.config.get_or_init(|| bind_interface.clone());
        if *locked != bind_interface {
            return Err(BINDING_CHANGED_ERROR.into());
        }
        let Some(name) = locked.clone() else {
            return Ok(());
        };
        self.inner
            .sessions
            .lock()
            .expect("VPN guard session list lock poisoned")
            .push(Arc::downgrade(session));
        if !self.inner.monitor_started.swap(true, Ordering::SeqCst) {
            let inner = self.inner.clone();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                monitor(app, name, inner).await;
            });
        }
        Ok(())
    }

    pub fn is_down(&self) -> bool {
        self.inner.down.load(Ordering::SeqCst)
    }

    /// Gate for commands that would add torrents or fetch metadata: fail fast with the reason
    /// instead of letting a paused session time out with a misleading "no seeders" message.
    pub fn ensure_up(&self) -> Result<(), String> {
        if !self.is_down() {
            return Ok(());
        }
        let name = self
            .config
            .get()
            .and_then(|config| config.clone())
            .unwrap_or_default();
        Err(format!(
            "The VPN interface '{name}' is disconnected — Direct P2P is paused until it returns."
        ))
    }
}

async fn monitor(app: AppHandle, name: String, inner: Arc<GuardInner>) {
    // netwatch reacts to adapter changes in well under a second; the interval is the fallback if
    // the platform monitor cannot start, and a safety re-check either way.
    let net_monitor = netwatch::netmon::Monitor::new().await.ok();
    let mut updates = net_monitor
        .as_ref()
        .map(|monitor| monitor.interface_state().stream_updates_only());
    let mut tick =
        tokio::time::interval(Duration::from_secs(if updates.is_some() { 7 } else { 2 }));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        match &mut updates {
            Some(stream) => {
                tokio::select! {
                    _ = stream.next() => {}
                    _ = tick.tick() => {}
                }
            }
            None => {
                tick.tick().await;
            }
        }
        // Evaluate against a fresh netdev snapshot (not the netwatch state) so the monitor and the
        // session-start gate share one matching rule, friendly names included.
        let up = match snapshot().await {
            Ok(interfaces) => find(&interfaces, &name).is_some_and(ready),
            Err(_) => continue,
        };
        if !up {
            // Flag first so new playback/download commands fail fast while the pause sweep runs.
            let first = !inner.down.swap(true, Ordering::SeqCst);
            // Re-sweep every cycle while down: a torrent that was still initializing during the
            // first sweep becomes live afterwards and must not keep transferring off-VPN.
            set_all(&inner, false).await;
            if first {
                let _ = app.emit("torrent-vpn-down", name.clone());
            }
        } else if inner.down.swap(false, Ordering::SeqCst) {
            set_all(&inner, true).await;
            let _ = app.emit("torrent-vpn-up", name.clone());
        }
    }
}

async fn set_all(inner: &GuardInner, resume: bool) {
    let sessions: Vec<Arc<Session>> = {
        let mut guard = inner
            .sessions
            .lock()
            .expect("VPN guard session list lock poisoned");
        guard.retain(|weak| weak.strong_count() > 0);
        guard.iter().filter_map(Weak::upgrade).collect()
    };
    for session in sessions {
        let handles: Vec<_> =
            session.with_torrents(|torrents| torrents.map(|(_, handle)| handle.clone()).collect());
        for handle in handles {
            if resume {
                // The app never exposes a user-facing pause, so every paused torrent here was
                // paused by this kill switch.
                if handle.stats().state.to_string() == "paused" {
                    let _ = session.unpause(&handle).await;
                }
            } else {
                // Errors (already paused / still initializing / errored) are fine — the sweep
                // repeats while the interface stays down.
                let _ = session.pause(&handle).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{find, is_vpn_like, ready, IfaceView};
    use std::net::IpAddr;

    fn iface(name: &str, friendly: Option<&str>, up: bool, ips: &[&str]) -> IfaceView {
        IfaceView {
            name: name.to_string(),
            friendly: friendly.map(str::to_string),
            description: None,
            tunnel_like_type: false,
            up,
            default_route: false,
            ips: ips.iter().map(|ip| ip.parse::<IpAddr>().unwrap()).collect(),
        }
    }

    #[test]
    fn recognizes_vpn_adapters_by_product_and_device_names() {
        for name in [
            "NordLynx",
            "wg0",
            "tun0",
            "utun4",
            "wg-mullvad",
            "proton0",
            "ppp0",
        ] {
            assert!(is_vpn_like(&iface(name, None, true, &[])), "{name}");
        }
        let tap = IfaceView {
            description: Some("TAP-Windows Adapter V9".into()),
            ..iface("{guid}", Some("Ethernet 2"), true, &[])
        };
        assert!(is_vpn_like(&tap));
        assert!(is_vpn_like(&iface("{guid}", Some("Mullvad"), true, &[])));
        assert!(is_vpn_like(&iface(
            "{guid}",
            Some("ProtonVPN TUN"),
            true,
            &[]
        )));
    }

    #[test]
    fn does_not_flag_ordinary_adapters() {
        for name in ["Ethernet", "Wi-Fi", "eth0", "wlan0", "enp3s0"] {
            assert!(!is_vpn_like(&iface(name, None, true, &[])), "{name}");
        }
        assert!(!is_vpn_like(&iface(
            "{guid}",
            Some("Realtek Gaming 2.5GbE"),
            true,
            &[]
        )));
    }

    #[test]
    fn finds_by_name_friendly_name_and_case_insensitively() {
        let list = vec![
            iface("{guid-1}", Some("NordLynx"), true, &["10.5.0.2"]),
            iface("wg0", None, true, &["10.64.0.3"]),
        ];
        assert_eq!(find(&list, "{guid-1}").unwrap().name, "{guid-1}");
        assert_eq!(find(&list, "NordLynx").unwrap().name, "{guid-1}");
        assert_eq!(find(&list, "nordlynx").unwrap().name, "{guid-1}");
        assert_eq!(find(&list, "WG0").unwrap().name, "wg0");
        assert!(find(&list, "tun0").is_none());
    }

    #[test]
    fn readiness_requires_up_plus_a_routable_address() {
        assert!(ready(&iface("wg0", None, true, &["10.64.0.3"])));
        assert!(!ready(&iface("wg0", None, false, &["10.64.0.3"])));
        // A disconnected adapter often keeps only link-local addresses.
        assert!(!ready(&iface(
            "wg0",
            None,
            true,
            &["169.254.10.2", "fe80::1"]
        )));
        assert!(!ready(&iface("wg0", None, true, &[])));
        assert!(ready(&iface(
            "wg0",
            None,
            true,
            &["fe80::1", "2a03:1b20::4"]
        )));
    }
}
