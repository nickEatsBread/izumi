//! Direct P2P networking guards: adapter enumeration, a session-level VPN kill switch, and
//! recovery after the machine changes networks.
//!
//! macOS and Linux additionally pass the selected interface to librqbit, which applies the native
//! per-socket binding to DHT, BT TCP/uTP, trackers, listeners and local discovery. All desktop
//! platforms retain this independent session-level guard:
//!   * a bound engine refuses to START unless the adapter is up with a routable address;
//!   * a network monitor pauses every torrent in every engine the moment the adapter drops and
//!     resumes them when it returns, so a crashed VPN cannot quietly continue on the ISP route;
//!   * Windows, where librqbit cannot bind by device name, remains outbound-only while configured
//!     and relies on the guard plus the VPN's route.
//!
//! Every engine, bound or not, also restarts peer discovery once the route to the internet changes
//! (Wi-Fi to another Wi-Fi, Ethernet, mobile data, waking from sleep). librqbit has no notion of a
//! network change, so without this a torrent keeps waiting out reconnect delays for its peers that
//! were scheduled while there was no route at all.

use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock, Weak,
    },
    time::{Duration, Instant, SystemTime},
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
    route_watch_started: AtomicBool,
    /// Serializes kill-switch sweeps with network-change restarts, so a restart's brief
    /// pause-and-resume can never resume a torrent that the kill switch is pausing.
    transition: tokio::sync::Mutex<()>,
}

/// Process-wide network guard shared by the playback and download engines: it restarts peer
/// discovery after a network change and, with a binding, is the VPN kill switch. The binding is
/// locked by the first engine to start (both read the same persisted setting, so a mismatch means
/// the user changed it in between — the same restart semantics as the SOCKS proxy).
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
        self.inner
            .sessions
            .lock()
            .expect("VPN guard session list lock poisoned")
            .push(Arc::downgrade(session));
        if !self.inner.route_watch_started.swap(true, Ordering::SeqCst) {
            let inner = self.inner.clone();
            tauri::async_runtime::spawn(async move {
                watch_route(inner).await;
            });
        }
        let Some(name) = locked.clone() else {
            return Ok(());
        };
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

fn attached_sessions(inner: &GuardInner) -> Vec<Arc<Session>> {
    let mut guard = inner
        .sessions
        .lock()
        .expect("VPN guard session list lock poisoned");
    guard.retain(|weak| weak.strong_count() > 0);
    guard.iter().filter_map(Weak::upgrade).collect()
}

async fn set_all(inner: &GuardInner, resume: bool) {
    let _transition = inner.transition.lock().await;
    for session in attached_sessions(inner) {
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

/// How often the route is sampled while a torrent is live. Changing networks passes through a
/// window with no route that normally lasts seconds, so one-second samples see it even when the
/// new network hands out the same address as the old one.
const ROUTE_SAMPLE: Duration = Duration::from_secs(1);
/// With no live torrent there is nothing to restart; only look for one becoming live.
const ROUTE_IDLE_SAMPLE: Duration = Duration::from_secs(10);
/// How long a new route must hold before torrents restart on it. Joining a network settles IPv4
/// and IPv6 separately, and every restart drops whichever peers did reconnect.
const ROUTE_SETTLE: Duration = Duration::from_secs(2);
/// A sample this much later than scheduled means the machine was asleep. Every peer connection
/// timed out meanwhile, even when it wakes on the same network with the same address.
const SLEEP_GAP: Duration = Duration::from_secs(10);

/// The local address the OS currently picks for traffic to the internet, which is the address
/// peer connections leave from. IPv4 wins whenever there is any: IPv6 privacy addresses rotate on
/// a network that never changed, and a real switch changes the IPv4 address or drops it for a
/// moment. Connecting a UDP socket only resolves the route; nothing is sent. The destinations are
/// documentation prefixes, which no network routes anywhere but its default route.
fn outbound_address() -> Option<IpAddr> {
    fn source(unspecified: IpAddr, destination: IpAddr) -> Option<IpAddr> {
        let socket = std::net::UdpSocket::bind((unspecified, 0)).ok()?;
        socket.connect((destination, 9)).ok()?;
        Some(socket.local_addr().ok()?.ip()).filter(routable)
    }
    source(
        Ipv4Addr::UNSPECIFIED.into(),
        Ipv4Addr::new(192, 0, 2, 1).into(),
    )
    .or_else(|| {
        source(
            Ipv6Addr::UNSPECIFIED.into(),
            Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1).into(),
        )
    })
}

/// Decides when a route change warrants restarting torrents: once a route has held for
/// `ROUTE_SETTLE` since the last change. Every further change restarts that wait, and there is
/// nothing to restart onto while there is no route at all.
struct RouteWatch {
    address: Option<IpAddr>,
    changed_at: Option<Instant>,
}

impl RouteWatch {
    fn new(address: Option<IpAddr>) -> Self {
        Self {
            address,
            changed_at: None,
        }
    }

    /// Record one sample. Returns true when torrents should restart now.
    fn sample(&mut self, address: Option<IpAddr>, now: Instant) -> bool {
        if address != self.address {
            self.address = address;
            self.changed_at = Some(now);
        }
        match self.changed_at {
            Some(changed) if address.is_some() && now.duration_since(changed) >= ROUTE_SETTLE => {
                self.changed_at = None;
                true
            }
            _ => false,
        }
    }

    /// The machine slept: count it as a change even if it woke up on the same route.
    fn interrupt(&mut self, now: Instant) {
        self.changed_at = Some(now);
    }
}

async fn watch_route(inner: Arc<GuardInner>) {
    // Sampled only while a torrent is live; the first sample after idling is the baseline.
    let mut watch: Option<RouteWatch> = None;
    loop {
        let interval = if watch.is_some() {
            ROUTE_SAMPLE
        } else {
            ROUTE_IDLE_SAMPLE
        };
        let scheduled = SystemTime::now();
        tokio::time::sleep(interval).await;
        // Monotonic clocks stand still during sleep on some platforms; the wall clock does not.
        let slept = SystemTime::now()
            .duration_since(scheduled)
            .is_ok_and(|elapsed| elapsed > interval + SLEEP_GAP);
        if !has_live_torrent(&inner) {
            watch = None;
            continue;
        }
        let address = outbound_address();
        let now = Instant::now();
        let Some(current) = watch.as_mut() else {
            watch = Some(RouteWatch::new(address));
            continue;
        };
        if slept {
            current.interrupt(now);
        }
        if current.sample(address, now) {
            restart_after_network_change(&inner).await;
        }
    }
}

fn has_live_torrent(inner: &GuardInner) -> bool {
    attached_sessions(inner).iter().any(|session| {
        session.with_torrents(|torrents| {
            for (_, handle) in torrents {
                if handle.live().is_some() {
                    return true;
                }
            }
            false
        })
    })
}

async fn restart_after_network_change(inner: &GuardInner) {
    let _transition = inner.transition.lock().await;
    // A disconnected VPN belongs to the kill switch, which resumes torrents once it returns.
    if inner.down.load(Ordering::SeqCst) {
        return;
    }
    eprintln!("[direct-p2p] network route changed; reconnecting torrent peers");
    for session in attached_sessions(inner) {
        restart_peer_discovery(&session).await;
    }
}

/// Reconnect every live torrent in `session` from a clean slate. librqbit retries a failed peer
/// only after a delay that grows sixfold per failure (10-20 s, 60-120 s, 6-12 min, ...), and it
/// ignores addresses it already knows when DHT or trackers report them again. After an outage a
/// torrent therefore waits out delays scheduled while there was no route at all. Pausing drops
/// the peers together with those delays; resuming keeps every verified piece and open stream, and
/// asks DHT and the trackers for peers again from the new network, announcing the new address.
async fn restart_peer_discovery(session: &Arc<Session>) {
    let handles: Vec<_> =
        session.with_torrents(|torrents| torrents.map(|(_, handle)| handle.clone()).collect());
    for handle in handles {
        // Initializing torrents have no peers yet, and paused ones belong to the kill switch.
        if handle.live().is_none() {
            continue;
        }
        if session.pause(&handle).await.is_ok() {
            if let Err(error) = session.unpause(&handle).await {
                eprintln!("could not reconnect torrent peers after a network change: {error:#}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{find, is_vpn_like, ready, IfaceView, RouteWatch};
    use std::{
        net::IpAddr,
        time::{Duration, Instant},
    };

    fn address(ip: &str) -> Option<IpAddr> {
        Some(ip.parse().unwrap())
    }

    fn clock() -> impl Fn(f64) -> Instant {
        let start = Instant::now();
        move |seconds| start + Duration::from_secs_f64(seconds)
    }

    #[test]
    fn a_steady_route_never_restarts_torrents() {
        let at = clock();
        let home = address("192.168.1.20");
        let mut watch = RouteWatch::new(home);
        assert!((1..60).all(|second| !watch.sample(home, at(second as f64))));
    }

    #[test]
    fn restarts_once_after_a_new_route_settles() {
        let at = clock();
        let cafe = address("10.0.0.7");
        let mut watch = RouteWatch::new(address("192.168.1.20"));
        assert!(!watch.sample(cafe, at(1.0)));
        assert!(!watch.sample(cafe, at(2.0)));
        assert!(watch.sample(cafe, at(3.0)));
        assert!(!watch.sample(cafe, at(4.0)));
    }

    #[test]
    fn an_outage_that_ends_on_the_same_address_still_restarts() {
        // Two networks can hand out the same address; the gap without a route is what matters.
        let at = clock();
        let home = address("192.168.1.20");
        let mut watch = RouteWatch::new(home);
        assert!(!watch.sample(None, at(1.0)));
        assert!(!watch.sample(None, at(30.0)));
        assert!(!watch.sample(home, at(31.0)));
        assert!(!watch.sample(home, at(32.0)));
        assert!(watch.sample(home, at(33.0)));
    }

    #[test]
    fn an_address_that_changes_again_restarts_the_wait() {
        let at = clock();
        let settled = address("10.0.0.7");
        let mut watch = RouteWatch::new(address("192.168.1.20"));
        assert!(!watch.sample(None, at(1.0)));
        assert!(!watch.sample(address("100.64.0.9"), at(2.0)));
        assert!(!watch.sample(address("100.64.0.9"), at(3.5)));
        assert!(!watch.sample(settled, at(3.9)));
        assert!(!watch.sample(settled, at(5.0)));
        assert!(watch.sample(settled, at(5.9)));
    }

    #[test]
    fn waking_from_sleep_restarts_even_on_the_same_route() {
        let at = clock();
        let home = address("192.168.1.20");
        let mut watch = RouteWatch::new(home);
        watch.interrupt(at(100.0));
        assert!(!watch.sample(home, at(101.0)));
        assert!(watch.sample(home, at(102.0)));
    }

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

#[cfg(test)]
mod network_switch_tests {
    use super::restart_peer_discovery;
    use librqbit::{
        create_torrent, limits::LimitsConfig, spawn_utils::BlockingSpawner, AddTorrent,
        AddTorrentOptions, CreateTorrentOptions, ListenerMode, ListenerOptions, Session,
        SessionOptions,
    };
    use std::{
        io::SeekFrom,
        net::{Ipv4Addr, SocketAddr},
        num::NonZeroU32,
        path::PathBuf,
        time::Duration,
    };
    use tokio::{
        io::{AsyncReadExt, AsyncSeekExt},
        net::{TcpListener, TcpStream},
        sync::watch,
        time::{sleep, timeout, Instant},
    };

    const PIECE: u32 = 256 * 1024;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "izumi-network-switch-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The only network path to the seeder. Taking it down drops every relayed connection and
    /// turns new ones away, which is what the swarm looks like while the machine changes networks.
    async fn relay(seeder: SocketAddr) -> (SocketAddr, watch::Sender<bool>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (link, state) = watch::channel(true);
        tokio::spawn(async move {
            while let Ok((mut inbound, _)) = listener.accept().await {
                if !*state.borrow() {
                    continue;
                }
                let mut state = state.clone();
                tokio::spawn(async move {
                    let Ok(mut outbound) = TcpStream::connect(seeder).await else {
                        return;
                    };
                    tokio::select! {
                        _ = tokio::io::copy_bidirectional(&mut inbound, &mut outbound) => {}
                        _ = state.wait_for(|up| !*up) => {}
                    }
                });
            }
        });
        (addr, link)
    }

    async fn wait_until(limit: Duration, mut ready: impl FnMut() -> bool) -> bool {
        let deadline = Instant::now() + limit;
        while Instant::now() < deadline {
            if ready() {
                return true;
            }
            sleep(Duration::from_millis(100)).await;
        }
        ready()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore = "takes about 40 s: it waits out librqbit's reconnect backoff"]
    async fn a_torrent_stalled_by_a_network_outage_resumes_once_discovery_restarts() {
        let seed_dir = scratch("seed");
        let payload = seed_dir.join("episode.bin");
        let mut noise = 0x9e37_79b9_7f4a_7c15_u64;
        let content = (0..16 * 1024 * 1024)
            .map(|_| {
                noise ^= noise << 13;
                noise ^= noise >> 7;
                noise ^= noise << 17;
                noise as u8
            })
            .collect::<Vec<_>>();
        std::fs::write(&payload, &content).unwrap();
        let torrent = create_torrent(
            &payload,
            CreateTorrentOptions {
                piece_length: Some(PIECE),
                ..Default::default()
            },
            &BlockingSpawner::new(2),
        )
        .await
        .unwrap()
        .as_bytes()
        .unwrap();

        // No DHT, trackers or LSD: the relay is the only way the leecher can reach the seeder.
        let isolated = |listen| SessionOptions {
            dht: None,
            disable_trackers: true,
            disable_local_service_discovery: true,
            persistence: None,
            listen,
            ..Default::default()
        };
        let seeder = Session::new_with_opts(
            seed_dir.clone(),
            isolated(Some(ListenerOptions {
                mode: ListenerMode::TcpOnly,
                listen_addr: (Ipv4Addr::LOCALHOST, 0).into(),
                ..Default::default()
            })),
        )
        .await
        .unwrap();
        let seeding = seeder
            .add_torrent(
                AddTorrent::from_bytes(torrent.clone()),
                Some(AddTorrentOptions {
                    output_folder: Some(seed_dir.to_string_lossy().into_owned()),
                    overwrite: true,
                    ..Default::default()
                }),
            )
            .await
            .unwrap()
            .into_handle()
            .unwrap();
        timeout(Duration::from_secs(30), seeding.wait_until_completed())
            .await
            .unwrap()
            .unwrap();
        let (path, link) = relay(seeder.listen_addr().unwrap()).await;

        let leech_dir = scratch("leech");
        let leecher = Session::new_with_opts(leech_dir.clone(), isolated(None))
            .await
            .unwrap();
        let downloading = leecher
            .add_torrent(
                AddTorrent::from_bytes(torrent),
                Some(AddTorrentOptions {
                    initial_peers: Some(vec![path]),
                    overwrite: true,
                    // Slow enough that the outage lands in the middle of the download.
                    ratelimits: LimitsConfig {
                        download_bps: NonZeroU32::new(1024 * 1024),
                        upload_bps: None,
                    },
                    ..Default::default()
                }),
            )
            .await
            .unwrap()
            .into_handle()
            .unwrap();
        let progress = || downloading.stats().progress_bytes;
        assert!(
            wait_until(Duration::from_secs(30), || progress() >= 2 * PIECE as u64).await,
            "the download never started"
        );

        // Longer than the first reconnect delay (10-20 s), so that retry fails as well and the
        // peer's next attempt is pushed 60-120 s further out.
        link.send_replace(false);
        // A player read left waiting by the outage, like mpv's request to the playback server.
        const READ_AT: usize = 12 * 1024 * 1024;
        let mut stream = downloading.clone().stream(0).await.unwrap();
        stream.seek(SeekFrom::Start(READ_AT as u64)).await.unwrap();
        let pending_read = tokio::spawn(async move {
            let mut buffer = vec![0; 64 * 1024];
            stream.read_exact(&mut buffer).await.map(|_| buffer)
        });
        sleep(Duration::from_secs(22)).await;
        link.send_replace(true);

        let stalled = progress();
        sleep(Duration::from_secs(15)).await;
        assert_eq!(
            progress(),
            stalled,
            "the peer came back on its own; librqbit's reconnect backoff has changed"
        );
        assert!(!pending_read.is_finished());

        restart_peer_discovery(&leecher).await;
        assert!(
            wait_until(Duration::from_secs(10), || progress() > stalled).await,
            "the download did not resume after peer discovery restarted"
        );
        let read = timeout(Duration::from_secs(10), pending_read)
            .await
            .expect("the waiting read was not served after peer discovery restarted")
            .unwrap()
            .unwrap();
        assert!(read == content[READ_AT..READ_AT + read.len()]);

        leecher.stop().await;
        seeder.stop().await;
        let _ = std::fs::remove_dir_all(seed_dir);
        let _ = std::fs::remove_dir_all(leech_dir);
    }
}
