//! Loopback SOCKS5 bridge for the desktop JVM extension runtime.
//!
//! Java's SOCKS proxy support keeps the original hostname all the way to this
//! process. That lets extension traffic share Izumi's configured DoH resolver
//! without changing the external runtime or weakening HTTPS verification.

use crate::doh::DohResolver;
use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use tauri::async_runtime::JoinHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Mutex};
use tokio::time::{timeout, Duration};

struct ActiveProxy {
    endpoint: String,
    address: SocketAddr,
    stop: oneshot::Sender<()>,
    task: JoinHandle<()>,
}

#[derive(Default)]
pub(crate) struct DohSocksProxy {
    active: Mutex<Option<ActiveProxy>>,
}

impl DohSocksProxy {
    pub(crate) async fn enable(&self, endpoint: &str) -> Result<SocketAddr, String> {
        let mut active = self.active.lock().await;
        if let Some(proxy) = active.as_ref() {
            if proxy.endpoint == endpoint {
                return Ok(proxy.address);
            }
        }
        stop_active(active.take());

        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|error| format!("Could not start the JVM DoH bridge: {error}"))?;
        let address = listener
            .local_addr()
            .map_err(|error| format!("Could not inspect the JVM DoH bridge: {error}"))?;
        let resolver = Arc::new(DohResolver::new(endpoint.to_string()));
        let (stop, mut stopped) = oneshot::channel();
        let task = tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut stopped => break,
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else { break };
                        let resolver = resolver.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = serve(stream, resolver).await;
                        });
                    }
                }
            }
        });
        *active = Some(ActiveProxy {
            endpoint: endpoint.to_string(),
            address,
            stop,
            task,
        });
        Ok(address)
    }

    pub(crate) async fn disable(&self) {
        stop_active(self.active.lock().await.take());
    }
}

fn stop_active(active: Option<ActiveProxy>) {
    if let Some(proxy) = active {
        let _ = proxy.stop.send(());
        proxy.task.abort();
    }
}

async fn serve(mut client: TcpStream, resolver: Arc<DohResolver>) -> io::Result<()> {
    let mut greeting = [0u8; 2];
    client.read_exact(&mut greeting).await?;
    if greeting[0] != 5 || greeting[1] == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid SOCKS greeting",
        ));
    }
    let mut methods = vec![0u8; greeting[1] as usize];
    client.read_exact(&mut methods).await?;
    if !methods.contains(&0) {
        client.write_all(&[5, 0xff]).await?;
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "SOCKS authentication required",
        ));
    }
    client.write_all(&[5, 0]).await?;

    let mut request = [0u8; 4];
    client.read_exact(&mut request).await?;
    if request[0] != 5 || request[1] != 1 || request[2] != 0 {
        reply(&mut client, 7).await?;
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "unsupported SOCKS command",
        ));
    }
    let target = match request[3] {
        1 => {
            let mut bytes = [0u8; 4];
            client.read_exact(&mut bytes).await?;
            Target::Ip(IpAddr::V4(bytes.into()))
        }
        3 => {
            let length = client.read_u8().await? as usize;
            if length == 0 {
                reply(&mut client, 4).await?;
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "empty SOCKS hostname",
                ));
            }
            let mut bytes = vec![0u8; length];
            client.read_exact(&mut bytes).await?;
            Target::Host(String::from_utf8(bytes).map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidData, "non-UTF-8 SOCKS hostname")
            })?)
        }
        4 => {
            let mut bytes = [0u8; 16];
            client.read_exact(&mut bytes).await?;
            Target::Ip(IpAddr::V6(bytes.into()))
        }
        _ => {
            reply(&mut client, 8).await?;
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unknown SOCKS address type",
            ));
        }
    };
    let port = client.read_u16().await?;
    let addresses = match target {
        Target::Ip(ip) => vec![ip],
        Target::Host(host) => match resolver.resolve_doh_only(&host).await {
            Ok(addresses) if !addresses.is_empty() => addresses,
            _ => {
                reply(&mut client, 4).await?;
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "DoH hostname lookup failed",
                ));
            }
        },
    };

    let mut upstream = None;
    for ip in addresses {
        if let Ok(Ok(stream)) =
            timeout(Duration::from_secs(10), TcpStream::connect((ip, port))).await
        {
            upstream = Some(stream);
            break;
        }
    }
    let Some(mut upstream) = upstream else {
        reply(&mut client, 5).await?;
        return Err(io::Error::new(
            io::ErrorKind::ConnectionRefused,
            "SOCKS target refused connection",
        ));
    };
    reply(&mut client, 0).await?;
    tokio::io::copy_bidirectional(&mut client, &mut upstream).await?;
    Ok(())
}

enum Target {
    Ip(IpAddr),
    Host(String),
}

async fn reply(stream: &mut TcpStream, status: u8) -> io::Result<()> {
    stream.write_all(&[5, status, 0, 1, 0, 0, 0, 0, 0, 0]).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bridge_reuses_endpoint_and_restarts_for_a_new_one() {
        let bridge = DohSocksProxy::default();
        let first = bridge
            .enable("https://one.invalid/dns-query")
            .await
            .unwrap();
        assert_eq!(
            bridge
                .enable("https://one.invalid/dns-query")
                .await
                .unwrap(),
            first
        );
        bridge
            .enable("https://two.invalid/dns-query")
            .await
            .unwrap();
        assert_eq!(
            bridge
                .active
                .lock()
                .await
                .as_ref()
                .map(|active| active.endpoint.as_str()),
            Some("https://two.invalid/dns-query")
        );
        bridge.disable().await;
        assert!(bridge.active.lock().await.is_none());
    }
}
