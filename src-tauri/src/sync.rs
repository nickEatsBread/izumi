//! Account-free, peer-to-peer sync backed by iroh-docs.
//!
//! The frontend owns Izumi's application-level merge policy. This module only
//! persists one JSON record per device and category in a shared document.

use std::{
    collections::{BTreeSet, HashMap},
    fmt,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use data_encoding::BASE32_NOPAD;
use iroh::{
    endpoint::Connection,
    protocol::{AcceptError, ProtocolHandler, Router},
    Endpoint, EndpointAddr, EndpointId, SecretKey, TransportAddr, Watcher,
};
use iroh_blobs::{api::blobs::Blobs, store::fs::FsStore, BlobsProtocol, ALPN as BLOBS_ALPN};
use iroh_docs::{
    api::{protocol::ShareMode, Doc},
    engine::{LiveEvent, SyncEvent},
    protocol::Docs,
    store::Query,
    AuthorId, DocTicket, ALPN as DOCS_ALPN,
};
use iroh_gossip::{net::Gossip, ALPN as GOSSIP_ALPN};
use n0_future::StreamExt;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use swarm_discovery::{Discoverer, IpClass, Peer};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_extplayer::{ExtPlayerExt, LanDiscoveryRequest};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    sync::{mpsc, oneshot, Mutex},
    task::JoinHandle,
};

const MAX_PAYLOAD_BYTES: usize = 2 * 1024 * 1024;
const MAX_PAIR_FRAME_BYTES: usize = 64 * 1024;
const VALID_CATEGORIES: [&str; 3] = ["watch", "manual", "watch-party"];
const PAIR_ALPN: &[u8] = b"/izumi/device-pair/1";
const PAIR_MDNS_SERVICE: &str = "izumi-sync-v1";
const PAIRING_WINDOW: Duration = Duration::from_secs(120);
const PAIRING_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Default)]
pub struct SyncState {
    inner: Mutex<RuntimeState>,
}

#[derive(Default)]
enum RuntimeState {
    #[default]
    Disabled,
    Starting,
    Ready(SyncRuntime),
    Failed(String),
}

struct SyncRuntime {
    // These handles keep the endpoint, protocols, and persistent blob store alive.
    #[allow(dead_code)]
    router: Router,
    endpoint: Endpoint,
    nearby_discovery: NearbyDiscovery,
    pairing: Arc<PairingHub>,
    store: FsStore,
    docs: Docs,
    author: AuthorId,
    endpoint_id: String,
    root: PathBuf,
    doc: Option<Doc>,
    ticket: Option<DocTicket>,
    events: Option<JoinHandle<()>>,
}

#[derive(Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Status {
    Disabled,
    Starting,
    Failed {
        error: String,
    },
    Ready {
        #[serde(rename = "endpointId")]
        endpoint_id: String,
        paired: bool,
        ticket: Option<String>,
    },
}

struct NearbyDiscovery {
    #[allow(dead_code)]
    task: JoinHandle<()>,
    control_tx: mpsc::UnboundedSender<DiscoveryControl>,
}

enum DiscoveryControl {
    AdvertiseUntil(Instant),
    Stop(oneshot::Sender<()>),
}

impl NearbyDiscovery {
    async fn stop_advertising(&self) {
        let (done_tx, done_rx) = oneshot::channel();
        if self.control_tx.send(DiscoveryControl::Stop(done_tx)).is_ok() {
            let _ = tokio::time::timeout(Duration::from_secs(1), done_rx).await;
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRecord {
    device_id: String,
    payload: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NearbyDevice {
    endpoint_id: String,
    short_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingWindow {
    endpoint_id: String,
    short_id: String,
    expires_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairRequestEvent {
    request_id: String,
    device_name: String,
    code: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairOutgoingEvent {
    endpoint_id: String,
    code: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairWireRequest {
    device_name: String,
    nonce: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairWireResponse {
    approved: bool,
    ticket: Option<String>,
    error: Option<String>,
}

#[derive(Default)]
struct PairingHubState {
    open_until: Option<Instant>,
    ticket: Option<String>,
    nearby: HashMap<EndpointId, NearbyPeer>,
    pending: HashMap<String, oneshot::Sender<bool>>,
}

#[derive(Clone)]
struct NearbyPeer {
    endpoint_addr: EndpointAddr,
    seen: Instant,
}

struct PairingHub {
    app: AppHandle,
    local_id: EndpointId,
    state: Mutex<PairingHubState>,
}

impl fmt::Debug for PairingHub {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PairingHub")
            .field("local_id", &self.local_id)
            .finish_non_exhaustive()
    }
}

#[derive(Clone)]
struct PairingProtocol(Arc<PairingHub>);

impl fmt::Debug for PairingProtocol {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("PairingProtocol").field(&self.0).finish()
    }
}

impl PairingHub {
    fn new(app: AppHandle, local_id: EndpointId) -> Self {
        Self {
            app,
            local_id,
            state: Mutex::new(PairingHubState::default()),
        }
    }

    async fn set_ticket(&self, ticket: Option<String>) {
        let mut state = self.state.lock().await;
        state.ticket = ticket;
        if state.ticket.is_none() {
            state.open_until = None;
            for (_, pending) in state.pending.drain() {
                let _ = pending.send(false);
            }
        }
    }

    async fn open(&self) -> Result<PairingWindow> {
        let mut state = self.state.lock().await;
        anyhow::ensure!(state.ticket.is_some(), "create or join a sync group first");
        state.open_until = Some(Instant::now() + PAIRING_WINDOW);
        let expires_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .saturating_add(PAIRING_WINDOW)
            .as_millis() as u64;
        Ok(PairingWindow {
            endpoint_id: self.local_id.to_string(),
            short_id: short_id(self.local_id),
            expires_at,
        })
    }

    async fn set_nearby(&self, endpoint_addr: EndpointAddr) {
        let endpoint_id = endpoint_addr.id;
        if endpoint_id == self.local_id {
            return;
        }
        let mut state = self.state.lock().await;
        state.nearby.insert(
            endpoint_id,
            NearbyPeer {
                endpoint_addr,
                seen: Instant::now(),
            },
        );
        let _ = self.app.emit("iroh-nearby-update", ());
    }

    async fn remove_nearby(&self, endpoint_id: EndpointId) {
        if self
            .state
            .lock()
            .await
            .nearby
            .remove(&endpoint_id)
            .is_some()
        {
            let _ = self.app.emit("iroh-nearby-update", ());
        }
    }

    async fn nearby_addr(&self, endpoint_id: EndpointId) -> Option<EndpointAddr> {
        let mut state = self.state.lock().await;
        retain_recent_nearby(&mut state.nearby);
        state
            .nearby
            .get(&endpoint_id)
            .map(|peer| peer.endpoint_addr.clone())
    }

    async fn nearby(&self) -> Vec<NearbyDevice> {
        let mut state = self.state.lock().await;
        retain_recent_nearby(&mut state.nearby);
        let mut devices = state
            .nearby
            .keys()
            .copied()
            .map(|endpoint_id| NearbyDevice {
                endpoint_id: endpoint_id.to_string(),
                short_id: short_id(endpoint_id),
            })
            .collect::<Vec<_>>();
        devices.sort_by(|a, b| a.short_id.cmp(&b.short_id));
        devices
    }

    async fn respond(&self, request_id: &str, approved: bool) -> Result<()> {
        let sender = self
            .state
            .lock()
            .await
            .pending
            .remove(request_id)
            .context("that pairing request has expired")?;
        sender
            .send(approved)
            .map_err(|_| anyhow::anyhow!("that pairing request has expired"))
    }

    async fn handle(&self, connection: Connection) -> Result<()> {
        let remote_id = connection.remote_id();
        let (mut send, mut recv) =
            tokio::time::timeout(Duration::from_secs(10), connection.accept_bi())
                .await
                .context("pairing request timed out")??;
        let request: PairWireRequest = read_frame(&mut recv).await?;
        let device_name = request
            .device_name
            .trim()
            .chars()
            .take(80)
            .collect::<String>();
        anyhow::ensure!(!device_name.is_empty(), "pairing device name is empty");
        anyhow::ensure!(
            request.nonce.len() == 64 && request.nonce.bytes().all(|byte| byte.is_ascii_hexdigit()),
            "invalid pairing nonce"
        );

        let code = pairing_code(self.local_id, remote_id, &request.nonce);
        let request_id = format!("{}-{}", short_id(remote_id), &request.nonce[..16]);
        let (approval_tx, approval_rx) = oneshot::channel();
        let ticket = {
            let mut state = self.state.lock().await;
            let open = state.open_until.is_some_and(|until| until > Instant::now());
            if !open || state.ticket.is_none() {
                let response = PairWireResponse {
                    approved: false,
                    ticket: None,
                    error: Some("Nearby pairing is not enabled on that device.".into()),
                };
                write_frame(&mut send, &response).await?;
                send.finish()?;
                // Returning from a protocol handler closes the connection. Keep it alive until
                // the requester has received the response and closed its side, otherwise the
                // requester can race the router shutdown and see `connection lost`.
                let _ = tokio::time::timeout(Duration::from_secs(5), connection.closed()).await;
                return Ok(());
            }
            state.pending.insert(request_id.clone(), approval_tx);
            state.ticket.clone().expect("checked above")
        };

        self.app.emit(
            "iroh-pair-request",
            PairRequestEvent {
                request_id: request_id.clone(),
                device_name,
                code,
            },
        )?;

        let approved = matches!(
            tokio::time::timeout(PAIRING_REQUEST_TIMEOUT, approval_rx).await,
            Ok(Ok(true))
        );
        self.state.lock().await.pending.remove(&request_id);
        let response = PairWireResponse {
            approved,
            ticket: approved.then_some(ticket),
            error: (!approved).then_some("Pairing was declined or timed out.".into()),
        };
        write_frame(&mut send, &response).await?;
        send.finish()?;
        let _ = tokio::time::timeout(Duration::from_secs(5), connection.closed()).await;
        Ok(())
    }
}

fn retain_recent_nearby(nearby: &mut HashMap<EndpointId, NearbyPeer>) {
    let now = Instant::now();
    let cutoff = now.checked_sub(Duration::from_secs(90)).unwrap_or(now);
    nearby.retain(|_, peer| peer.seen >= cutoff);
}

fn advertisement_active(until: Option<Instant>, now: Instant) -> bool {
    until.is_some_and(|until| until > now)
}

/// Encode the 32-byte endpoint identity into one DNS-safe label.
///
/// Iroh displays endpoint IDs as 64 hex characters, but an mDNS label may be
/// at most 63 bytes. Unpadded base32 preserves the complete identity in 52
/// characters, leaving enough room for swarm-discovery's `-<port>` hostname.
fn discovery_peer_id(endpoint_id: EndpointId) -> String {
    BASE32_NOPAD
        .encode(endpoint_id.as_bytes())
        .to_ascii_lowercase()
}

fn endpoint_id_from_discovery_peer_id(peer_id: &str) -> Option<EndpointId> {
    let encoded = peer_id.to_ascii_uppercase();
    let bytes: [u8; 32] = BASE32_NOPAD
        .decode(encoded.as_bytes())
        .ok()?
        .try_into()
        .ok()?;
    EndpointId::from_bytes(&bytes).ok()
}

fn active_multicast_interfaces(state: &netwatch::interfaces::State) -> BTreeSet<Ipv4Addr> {
    state
        .interfaces
        .values()
        .filter(|interface| interface.is_up())
        .flat_map(|interface| interface.addrs())
        .filter_map(|network| match network.addr() {
            IpAddr::V4(addr)
                if !addr.is_loopback() && !addr.is_unspecified() && !addr.is_link_local() =>
            {
                Some(addr)
            }
            _ => None,
        })
        .collect()
}

fn peer_endpoint_addr(endpoint_id: EndpointId, peer: &Peer) -> EndpointAddr {
    let mut addrs = peer
        .addrs()
        .iter()
        .map(|(ip, port)| TransportAddr::Ip(SocketAddr::new(*ip, *port)))
        .collect::<Vec<_>>();
    if let Some(Some(relay)) = peer.txt_attribute("relay") {
        match relay.parse() {
            Ok(relay) => addrs.push(TransportAddr::Relay(relay)),
            Err(error) => eprintln!("[sync] ignored invalid nearby relay URL: {error}"),
        }
    }
    EndpointAddr::from_parts(endpoint_id, addrs)
}

fn publish_endpoint_addr(discovery: &swarm_discovery::DropGuard, addr: &EndpointAddr) {
    discovery.remove_all();
    discovery.remove_txt_attribute("relay".to_string());

    let mut by_port: HashMap<u16, Vec<IpAddr>> = HashMap::new();
    for addr in addr.ip_addrs() {
        by_port.entry(addr.port()).or_default().push(addr.ip());
    }
    for (port, addrs) in by_port {
        discovery.add(port, addrs);
    }
    if let Some(relay) = addr.relay_urls().next() {
        if let Err(error) =
            discovery.set_txt_attribute("relay".to_string(), Some(relay.to_string()))
        {
            eprintln!("[sync] failed to advertise nearby relay URL: {error}");
        }
    }
}

async fn start_nearby_discovery(
    endpoint: Endpoint,
    pairing: Arc<PairingHub>,
) -> Result<NearbyDiscovery> {
    let monitor = netwatch::netmon::Monitor::new()
        .await
        .context("failed to monitor network interfaces for nearby pairing")?;
    let mut interface_watch = monitor.interface_state();
    let initial_interfaces = active_multicast_interfaces(&interface_watch.get());
    let (peer_tx, mut peer_rx) = mpsc::unbounded_channel::<(String, Peer)>();
    let (control_tx, mut control_rx) = mpsc::unbounded_channel::<DiscoveryControl>();

    let discovery = Discoverer::new_interactive(
        PAIR_MDNS_SERVICE.to_string(),
        discovery_peer_id(endpoint.id()),
    )
    .with_ip_class(IpClass::Auto)
    .with_multicast_interfaces_v4(initial_interfaces.iter().copied().collect())
    .with_callback(move |peer_id, peer| {
        let _ = peer_tx.send((peer_id.to_string(), peer.clone()));
    })
    .spawn(&tokio::runtime::Handle::current())
    .context("failed to start nearby-pairing discovery")?;

    let mut interfaces = initial_interfaces;
    let mut interface_stream = interface_watch.stream_updates_only();
    let mut endpoint_addr_stream = endpoint.watch_addr().stream();
    let endpoint_closed = endpoint.closed();
    let mut expiry_tick = tokio::time::interval(Duration::from_secs(1));
    let task = tokio::spawn(async move {
        let mut latest_addr = None;
        let mut advertise_until = None;
        tokio::pin!(endpoint_closed);
        loop {
            tokio::select! {
                _ = &mut endpoint_closed => break,
                Some(control) = control_rx.recv() => {
                    match control {
                        DiscoveryControl::AdvertiseUntil(until) => {
                            advertise_until = Some(until);
                            if let Some(addr) = &latest_addr {
                                publish_endpoint_addr(&discovery, addr);
                            }
                        }
                        DiscoveryControl::Stop(done) => {
                            advertise_until = None;
                            discovery.remove_all();
                            discovery.remove_txt_attribute("relay".to_string());
                            let _ = done.send(());
                        }
                    }
                }
                _ = expiry_tick.tick() => {
                    if advertise_until.is_some()
                        && !advertisement_active(advertise_until, Instant::now())
                    {
                        advertise_until = None;
                        discovery.remove_all();
                        discovery.remove_txt_attribute("relay".to_string());
                    }
                }
                Some((peer_id, peer)) = peer_rx.recv() => {
                    let Some(endpoint_id) = endpoint_id_from_discovery_peer_id(&peer_id) else {
                        eprintln!("[sync] ignored invalid nearby endpoint identity: {peer_id}");
                        continue;
                    };
                    if peer.is_expiry() {
                        pairing.remove_nearby(endpoint_id).await;
                    } else {
                        pairing
                            .set_nearby(peer_endpoint_addr(endpoint_id, &peer))
                            .await;
                    }
                }
                Some(state) = interface_stream.next() => {
                    let current = active_multicast_interfaces(&state);
                    for added in current.difference(&interfaces) {
                        discovery.add_interface_v4(*added);
                    }
                    for removed in interfaces.difference(&current) {
                        discovery.remove_interface_v4(*removed);
                    }
                    interfaces = current;
                }
                Some(addr) = endpoint_addr_stream.next() => {
                    latest_addr = Some(addr);
                    if advertisement_active(advertise_until, Instant::now()) {
                        publish_endpoint_addr(
                            &discovery,
                            latest_addr.as_ref().expect("address was just stored"),
                        );
                    }
                }
                else => break,
            }
        }
    });
    Ok(NearbyDiscovery {
        task,
        control_tx,
    })
}

impl ProtocolHandler for PairingProtocol {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        if let Err(error) = self.0.handle(connection).await {
            eprintln!("[sync] pairing protocol failed: {error:#}");
            return Err(AcceptError::from_boxed(error.into()));
        }
        Ok(())
    }
}

fn short_id(endpoint_id: EndpointId) -> String {
    endpoint_id
        .to_string()
        .chars()
        .take(6)
        .collect::<String>()
        .to_uppercase()
}

fn pairing_code(left: EndpointId, right: EndpointId, nonce: &str) -> String {
    let mut ids = [left.to_string(), right.to_string()];
    ids.sort();
    let mut input = Vec::with_capacity(ids[0].len() + ids[1].len() + nonce.len() + 2);
    input.extend_from_slice(ids[0].as_bytes());
    input.push(0);
    input.extend_from_slice(ids[1].as_bytes());
    input.push(0);
    input.extend_from_slice(nonce.as_bytes());
    let digest = blake3::hash(&input);
    let value = u64::from_be_bytes(digest.as_bytes()[..8].try_into().expect("eight bytes"));
    let code = value % 1_000_000;
    format!("{:03} {:03}", code / 1000, code % 1000)
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(DIGITS[(byte >> 4) as usize] as char);
        encoded.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    encoded
}

async fn write_frame<W: AsyncWrite + Unpin, T: Serialize>(writer: &mut W, value: &T) -> Result<()> {
    let payload = serde_json::to_vec(value)?;
    anyhow::ensure!(
        payload.len() <= MAX_PAIR_FRAME_BYTES,
        "pairing response is too large"
    );
    writer
        .write_all(&(payload.len() as u32).to_be_bytes())
        .await?;
    writer.write_all(&payload).await?;
    writer.flush().await?;
    Ok(())
}

async fn read_frame<R: AsyncRead + Unpin, T: DeserializeOwned>(reader: &mut R) -> Result<T> {
    let mut length = [0u8; 4];
    reader.read_exact(&mut length).await?;
    let length = u32::from_be_bytes(length) as usize;
    anyhow::ensure!(
        length <= MAX_PAIR_FRAME_BYTES,
        "pairing request is too large"
    );
    let mut payload = vec![0u8; length];
    reader.read_exact(&mut payload).await?;
    Ok(serde_json::from_slice(&payload)?)
}

impl SyncRuntime {
    async fn new(root: PathBuf, app: AppHandle) -> Result<Self> {
        tokio::fs::create_dir_all(&root).await?;
        let key = load_secret_key(&root.join("endpoint-key")).await?;
        let endpoint = iroh::Endpoint::builder(iroh::endpoint::presets::N0)
            .secret_key(key)
            .bind()
            .await?;
        let endpoint_id = endpoint.id().to_string();
        let pairing = Arc::new(PairingHub::new(app, endpoint.id()));
        let nearby_discovery = start_nearby_discovery(endpoint.clone(), pairing.clone()).await?;
        let gossip = Gossip::builder().spawn(endpoint.clone());
        let store = FsStore::load(&root).await?;
        let docs = Docs::persistent(root.clone())
            .spawn(endpoint.clone(), (*store).clone(), gossip.clone())
            .await?;
        let router = Router::builder(endpoint.clone())
            .accept(BLOBS_ALPN, BlobsProtocol::new(&store, None))
            .accept(GOSSIP_ALPN, gossip)
            .accept(DOCS_ALPN, docs.clone())
            .accept(PAIR_ALPN, PairingProtocol(pairing.clone()))
            .spawn();
        let author = docs.author_create().await?;

        Ok(Self {
            router,
            endpoint,
            nearby_discovery,
            pairing,
            store,
            docs,
            author,
            endpoint_id,
            root,
            doc: None,
            ticket: None,
            events: None,
        })
    }

    async fn restore(&mut self, app: AppHandle) -> Result<()> {
        let path = self.root.join("sync-ticket");
        let Ok(raw) = tokio::fs::read_to_string(path).await else {
            return Ok(());
        };
        let ticket = DocTicket::from_str(raw.trim()).context("invalid saved sync ticket")?;
        let doc = self.docs.import(ticket.clone()).await?;
        self.attach(app, doc, ticket).await
    }

    async fn attach(&mut self, app: AppHandle, doc: Doc, ticket: DocTicket) -> Result<()> {
        if let Some(task) = self.events.take() {
            task.abort();
        }
        let mut events = doc.subscribe().await?;
        self.events = Some(tokio::spawn(async move {
            while let Some(Ok(event)) = events.next().await {
                if matches!(
                    event,
                    LiveEvent::InsertRemote { .. }
                        | LiveEvent::ContentReady { .. }
                        | LiveEvent::SyncFinished(SyncEvent { .. })
                ) {
                    let _ = app.emit("iroh-sync-update", ());
                }
            }
        }));
        tokio::fs::write(self.root.join("sync-ticket"), ticket.to_string()).await?;
        self.pairing.set_ticket(Some(ticket.to_string())).await;
        self.doc = Some(doc);
        self.ticket = Some(ticket);
        Ok(())
    }

    fn doc(&self) -> Result<&Doc> {
        self.doc
            .as_ref()
            .context("this device is not in a sync group")
    }

    fn blobs(&self) -> &Blobs {
        self.store.blobs()
    }
}

fn validate_category(category: &str) -> Result<()> {
    anyhow::ensure!(
        VALID_CATEGORIES.contains(&category),
        "unknown sync category"
    );
    Ok(())
}

async fn load_secret_key(path: &Path) -> Result<SecretKey> {
    if path.exists() {
        let bytes = tokio::fs::read(path).await?;
        anyhow::ensure!(bytes.len() == 32, "invalid saved iroh endpoint key");
        return SecretKey::try_from(bytes.as_slice()).context("invalid saved iroh endpoint key");
    }

    let key = SecretKey::generate();
    let tmp = path.with_extension("tmp");
    let mut file = tokio::fs::File::create(&tmp).await?;
    file.write_all(&key.to_bytes()).await?;
    file.flush().await?;
    drop(file);
    tokio::fs::rename(tmp, path).await?;
    Ok(key)
}

async fn build_runtime(app: AppHandle) -> Result<SyncRuntime> {
    let root = app.path().app_data_dir()?.join("iroh-sync");
    let mut runtime = SyncRuntime::new(root, app.clone()).await?;
    if let Err(error) = runtime.restore(app.clone()).await {
        // A stale or corrupt ticket must not brick the service. Keep the
        // endpoint usable and let the user form or join a new group.
        eprintln!("[sync] could not restore saved group: {error:#}");
        if let Some(task) = runtime.events.take() {
            task.abort();
        }
        runtime.doc = None;
        runtime.ticket = None;
        runtime.pairing.set_ticket(None).await;
        let _ = tokio::fs::remove_file(runtime.root.join("sync-ticket")).await;
    }
    Ok(runtime)
}

async fn enable_runtime(app: AppHandle) -> Result<(), String> {
    let state = app.state::<SyncState>();
    {
        let mut guard = state.inner.lock().await;
        match &*guard {
            RuntimeState::Ready(_) => return Ok(()),
            RuntimeState::Starting => return Err("sync is still starting".into()),
            RuntimeState::Disabled | RuntimeState::Failed(_) => {
                *guard = RuntimeState::Starting;
            }
        }
    }

    let result = async {
        app.extplayer()
            .set_lan_discovery(LanDiscoveryRequest { enabled: true })
            .context("failed to enable LAN discovery")?;
        build_runtime(app.clone()).await
    }
    .await;

    let error = result.as_ref().err().map(|error| format!("{error:#}"));
    {
        let mut guard = state.inner.lock().await;
        *guard = match result {
            Ok(runtime) => RuntimeState::Ready(runtime),
            Err(error) => RuntimeState::Failed(format!("{error:#}")),
        };
    }
    if error.is_some() {
        let _ = app
            .extplayer()
            .set_lan_discovery(LanDiscoveryRequest { enabled: false });
    }
    let _ = app.emit("iroh-sync-ready", ());
    error.map_or(Ok(()), Err)
}

/// Restore iroh only for users who previously opted into a sync group. A fresh
/// install has no ticket and therefore opens no endpoint, relay, or mDNS socket.
pub async fn initialize_if_configured(app: AppHandle) {
    let Ok(root) = app.path().app_data_dir() else {
        return;
    };
    if tokio::fs::try_exists(root.join("iroh-sync").join("sync-ticket"))
        .await
        .unwrap_or(false)
    {
        let _ = enable_runtime(app).await;
    }
}

#[tauri::command]
pub async fn sync_enable(app: AppHandle) -> Result<(), String> {
    enable_runtime(app).await
}

#[tauri::command]
pub async fn sync_status(state: tauri::State<'_, SyncState>) -> Result<Status, String> {
    Ok(match &*state.inner.lock().await {
        RuntimeState::Disabled => Status::Disabled,
        RuntimeState::Starting => Status::Starting,
        RuntimeState::Failed(error) => Status::Failed {
            error: error.clone(),
        },
        RuntimeState::Ready(runtime) => Status::Ready {
            endpoint_id: runtime.endpoint_id.clone(),
            paired: runtime.doc.is_some(),
            ticket: runtime.ticket.as_ref().map(ToString::to_string),
        },
    })
}

#[tauri::command]
pub async fn sync_create(
    app: AppHandle,
    state: tauri::State<'_, SyncState>,
) -> Result<String, String> {
    let mut guard = state.inner.lock().await;
    let RuntimeState::Ready(runtime) = &mut *guard else {
        return Err("sync is not ready".into());
    };
    if let Some(ticket) = &runtime.ticket {
        return Ok(ticket.to_string());
    }
    let doc = runtime.docs.create().await.map_err(|e| e.to_string())?;
    let ticket = doc
        .share(ShareMode::Write, Default::default())
        .await
        .map_err(|e| e.to_string())?;
    runtime
        .attach(app, doc, ticket.clone())
        .await
        .map_err(|e| e.to_string())?;
    Ok(ticket.to_string())
}

#[tauri::command]
pub async fn sync_join(
    app: AppHandle,
    ticket: String,
    state: tauri::State<'_, SyncState>,
) -> Result<(), String> {
    let ticket = DocTicket::from_str(ticket.trim())
        .map_err(|_| "That is not a valid Izumi sync ticket".to_string())?;
    let mut guard = state.inner.lock().await;
    let RuntimeState::Ready(runtime) = &mut *guard else {
        return Err("sync is not ready".into());
    };
    let doc = runtime
        .docs
        .import(ticket.clone())
        .await
        .map_err(|e| e.to_string())?;
    runtime
        .attach(app, doc, ticket)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_nearby_list(
    state: tauri::State<'_, SyncState>,
) -> Result<Vec<NearbyDevice>, String> {
    let pairing = {
        let guard = state.inner.lock().await;
        let RuntimeState::Ready(runtime) = &*guard else {
            return Err("sync is not ready".into());
        };
        runtime.pairing.clone()
    };
    Ok(pairing.nearby().await)
}

#[tauri::command]
pub async fn sync_pairing_open(
    state: tauri::State<'_, SyncState>,
) -> Result<PairingWindow, String> {
    let (pairing, control_tx) = {
        let guard = state.inner.lock().await;
        let RuntimeState::Ready(runtime) = &*guard else {
            return Err("sync is not ready".into());
        };
        (
            runtime.pairing.clone(),
            runtime.nearby_discovery.control_tx.clone(),
        )
    };
    let window = pairing.open().await.map_err(|error| error.to_string())?;
    let _ = control_tx.send(DiscoveryControl::AdvertiseUntil(
        Instant::now() + PAIRING_WINDOW,
    ));
    Ok(window)
}

#[tauri::command]
pub async fn sync_pair_respond(
    request_id: String,
    approved: bool,
    state: tauri::State<'_, SyncState>,
) -> Result<(), String> {
    let pairing = {
        let guard = state.inner.lock().await;
        let RuntimeState::Ready(runtime) = &*guard else {
            return Err("sync is not ready".into());
        };
        runtime.pairing.clone()
    };
    pairing
        .respond(&request_id, approved)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sync_pair_nearby(
    app: AppHandle,
    endpoint_id: String,
    device_name: String,
    state: tauri::State<'_, SyncState>,
) -> Result<(), String> {
    let remote_id = EndpointId::from_str(endpoint_id.trim())
        .map_err(|_| "That nearby device has an invalid identity".to_string())?;
    let device_name = device_name.trim().chars().take(80).collect::<String>();
    if device_name.is_empty() {
        return Err("Give this device a name before pairing".into());
    }
    let (endpoint, local_id, pairing) = {
        let guard = state.inner.lock().await;
        let RuntimeState::Ready(runtime) = &*guard else {
            return Err("sync is not ready".into());
        };
        if runtime.doc.is_some() {
            return Err("This device is already in a sync group".into());
        }
        (
            runtime.endpoint.clone(),
            runtime.endpoint.id(),
            runtime.pairing.clone(),
        )
    };
    let remote_addr = pairing.nearby_addr(remote_id).await.ok_or_else(|| {
        "That device is no longer visible nearby. Refresh and enable nearby pairing on it again."
            .to_string()
    })?;

    let nonce = hex(&SecretKey::generate().to_bytes());
    let code = pairing_code(local_id, remote_id, &nonce);
    app.emit(
        "iroh-pair-outgoing",
        PairOutgoingEvent {
            endpoint_id: remote_id.to_string(),
            code,
        },
    )
    .map_err(|error| error.to_string())?;

    let connection = tokio::time::timeout(
        Duration::from_secs(20),
        endpoint.connect(remote_addr, PAIR_ALPN),
    )
    .await
    .map_err(|_| "Timed out connecting to that nearby device".to_string())?
    .map_err(|error| error.to_string())?;
    let (mut send, mut recv) = connection
        .open_bi()
        .await
        .map_err(|error| error.to_string())?;
    write_frame(&mut send, &PairWireRequest { device_name, nonce })
        .await
        .map_err(|error| error.to_string())?;
    send.finish().map_err(|error| error.to_string())?;
    let response: PairWireResponse = tokio::time::timeout(
        PAIRING_REQUEST_TIMEOUT + Duration::from_secs(10),
        read_frame(&mut recv),
    )
    .await
    .map_err(|_| "The pairing request timed out".to_string())?
    .map_err(|error| error.to_string())?;
    // Tell the accepting protocol it can return now that the framed response is complete.
    connection.close(0u32.into(), b"pairing response received");
    if !response.approved {
        return Err(response
            .error
            .unwrap_or_else(|| "Pairing was not approved".into()));
    }
    let ticket = DocTicket::from_str(
        response
            .ticket
            .as_deref()
            .ok_or("The paired device did not provide a sync capability")?,
    )
    .map_err(|_| "The paired device returned an invalid sync capability".to_string())?;

    let mut guard = state.inner.lock().await;
    let RuntimeState::Ready(runtime) = &mut *guard else {
        return Err("sync is not ready".into());
    };
    let doc = runtime
        .docs
        .import(ticket.clone())
        .await
        .map_err(|error| error.to_string())?;
    runtime
        .attach(app, doc, ticket)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sync_disable(
    app: AppHandle,
    state: tauri::State<'_, SyncState>,
) -> Result<(), String> {
    let runtime = {
        let mut guard = state.inner.lock().await;
        match &*guard {
            RuntimeState::Disabled => None,
            RuntimeState::Starting => return Err("sync is still starting".into()),
            RuntimeState::Ready(runtime) if runtime.doc.is_some() => {
                return Err("Leave the sync group before disabling device sync".into());
            }
            RuntimeState::Ready(_) => match std::mem::replace(&mut *guard, RuntimeState::Disabled) {
                RuntimeState::Ready(runtime) => Some(runtime),
                _ => unreachable!("state was checked while locked"),
            },
            RuntimeState::Failed(_) => {
                *guard = RuntimeState::Disabled;
                None
            }
        }
    };
    if let Some(runtime) = &runtime {
        runtime.nearby_discovery.stop_advertising().await;
    }
    drop(runtime);
    app.extplayer()
        .set_lan_discovery(LanDiscoveryRequest { enabled: false })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sync_leave(
    app: AppHandle,
    state: tauri::State<'_, SyncState>,
) -> Result<(), String> {
    let mut runtime = {
        let mut guard = state.inner.lock().await;
        match std::mem::replace(&mut *guard, RuntimeState::Disabled) {
            RuntimeState::Ready(runtime) => runtime,
            other => {
                *guard = other;
                return Err("sync is not ready".into());
            }
        }
    };
    if let Some(task) = runtime.events.take() {
        task.abort();
    }
    let close_result = if let Some(doc) = runtime.doc.take() {
        doc.close().await.map_err(|error| error.to_string())
    } else {
        Ok(())
    };
    runtime.ticket = None;
    runtime.pairing.set_ticket(None).await;
    runtime.nearby_discovery.stop_advertising().await;
    let remove_result = match tokio::fs::remove_file(runtime.root.join("sync-ticket")).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    };
    drop(runtime);
    let lan_result = app
        .extplayer()
        .set_lan_discovery(LanDiscoveryRequest { enabled: false })
        .map_err(|error| error.to_string());
    close_result?;
    remove_result?;
    lan_result
}

#[tauri::command]
pub async fn sync_write(
    category: String,
    payload: String,
    state: tauri::State<'_, SyncState>,
) -> Result<(), String> {
    validate_category(&category).map_err(|e| e.to_string())?;
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err("sync payload is too large".into());
    }
    serde_json::from_str::<serde_json::Value>(&payload)
        .map_err(|_| "sync payload is not valid JSON")?;

    let guard = state.inner.lock().await;
    let RuntimeState::Ready(runtime) = &*guard else {
        return Err("sync is not ready".into());
    };
    let key = format!("{category}/{}", runtime.endpoint_id).into_bytes();
    runtime
        .doc()
        .map_err(|e| e.to_string())?
        .set_bytes(runtime.author, key, payload.into_bytes())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn sync_read(
    category: String,
    state: tauri::State<'_, SyncState>,
) -> Result<Vec<SyncRecord>, String> {
    validate_category(&category).map_err(|e| e.to_string())?;
    let guard = state.inner.lock().await;
    let RuntimeState::Ready(runtime) = &*guard else {
        return Err("sync is not ready".into());
    };
    let doc = runtime.doc().map_err(|e| e.to_string())?;
    let entries = doc
        .get_many(Query::single_latest_per_key().key_prefix(format!("{category}/")))
        .await
        .map_err(|e| e.to_string())?;
    tokio::pin!(entries);
    let mut records = Vec::new();
    while let Some(entry) = entries.next().await {
        let entry = entry.map_err(|e| e.to_string())?;
        let key = String::from_utf8(entry.key().to_vec()).map_err(|_| "invalid sync record key")?;
        let bytes = runtime
            .blobs()
            .get_bytes(entry.content_hash())
            .await
            .map_err(|e| e.to_string())?;
        let payload =
            String::from_utf8(bytes.to_vec()).map_err(|_| "invalid sync record payload")?;
        if let Some(device_id) = key.strip_prefix(&format!("{category}/")) {
            records.push(SyncRecord {
                device_id: device_id.to_string(),
                payload,
            });
        }
    }
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confirmation_code_is_symmetric_and_readable() {
        let left = SecretKey::generate().public();
        let right = SecretKey::generate().public();
        let nonce = hex(&SecretKey::generate().to_bytes());
        let first = pairing_code(left, right, &nonce);
        let second = pairing_code(right, left, &nonce);
        assert_eq!(first, second);
        assert_eq!(first.len(), 7);
        assert_eq!(first.as_bytes()[3], b' ');
        assert!(first
            .chars()
            .filter(|ch| *ch != ' ')
            .all(|ch| ch.is_ascii_digit()));
    }

    #[test]
    fn discovery_peer_id_is_dns_safe_and_round_trips() {
        let endpoint_id = SecretKey::generate().public();
        let encoded = discovery_peer_id(endpoint_id);

        assert_eq!(encoded.len(), 52);
        assert!(encoded.len() + 1 + u16::MAX.to_string().len() <= 63);
        assert!(encoded
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit()));
        assert_eq!(
            endpoint_id_from_discovery_peer_id(&encoded),
            Some(endpoint_id)
        );
    }

    #[test]
    fn invalid_discovery_peer_id_is_rejected() {
        assert_eq!(endpoint_id_from_discovery_peer_id("not-an-endpoint"), None);
    }

    #[test]
    fn discovery_advertisement_requires_an_active_window() {
        let now = Instant::now();
        assert!(!advertisement_active(None, now));
        assert!(!advertisement_active(Some(now), now));
        assert!(advertisement_active(
            Some(now + Duration::from_secs(1)),
            now
        ));
    }

    #[test]
    fn sync_runtime_defaults_to_disabled() {
        let state = SyncState::default();
        assert!(matches!(
            *state.inner.try_lock().expect("state should be unlocked"),
            RuntimeState::Disabled
        ));
    }

    #[tokio::test]
    async fn pairing_frames_round_trip() {
        let (mut writer, mut reader) = tokio::io::duplex(2048);
        let send = tokio::spawn(async move {
            write_frame(
                &mut writer,
                &PairWireRequest {
                    device_name: "Steam Deck".into(),
                    nonce: "a".repeat(64),
                },
            )
            .await
            .unwrap();
        });
        let received: PairWireRequest = read_frame(&mut reader).await.unwrap();
        send.await.unwrap();
        assert_eq!(received.device_name, "Steam Deck");
        assert_eq!(received.nonce.len(), 64);
    }
}
