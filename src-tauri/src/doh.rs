//! DNS-over-HTTPS resolver for the pooled reqwest client.
//!
//! When "Use DNS over HTTPS" is enabled in Settings → Network, izumi's shared HTTP
//! client (addon stream/manifest fetches, AniZip, the id map, Kitsu, offline
//! downloads, edge prefetch) resolves hostnames through a DoH JSON endpoint
//! (Cloudflare by default) instead of the OS resolver. If the DoH query fails it
//! falls back to the system resolver so networking never hard-breaks — best-effort,
//! not fail-closed. AniList/MAL browse traffic (webview fetch) and mpv playback use
//! their own resolvers and are out of scope. Desktop JVM extensions use this
//! resolver through a loopback SOCKS bridge and fail closed instead of falling
//! back to a potentially intercepted system answer.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

type BoxError = Box<dyn std::error::Error + Send + Sync>;

struct CacheEntry {
    ips: Vec<IpAddr>,
    expires: Instant,
}

#[derive(Default)]
struct DohHealth {
    bypass_until: Option<Instant>,
}

const UNHEALTHY_BYPASS: Duration = Duration::from_secs(5 * 60);

/// Custom reqwest resolver that answers via a DoH JSON endpoint. Cheap to clone
/// (the cache + bootstrap client are shared), which the `Resolve` impl relies on to
/// hand a `'static` future to reqwest.
pub struct DohResolver {
    doh_url: String,
    /// Bootstrap client for the DoH request itself. Deliberately uses the OS
    /// resolver (no DoH wrapper) so reaching the DoH host can't recurse.
    boot: reqwest::Client,
    cache: Arc<Mutex<HashMap<String, CacheEntry>>>,
    health: Arc<Mutex<DohHealth>>,
}

impl DohResolver {
    pub fn new(doh_url: String) -> Self {
        let boot = reqwest::Client::builder()
            .timeout(Duration::from_secs(6))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            doh_url,
            boot,
            cache: Arc::new(Mutex::new(HashMap::new())),
            health: Arc::new(Mutex::new(DohHealth::default())),
        }
    }

    fn clone_shared(&self) -> Self {
        Self {
            doh_url: self.doh_url.clone(),
            boot: self.boot.clone(),
            cache: self.cache.clone(),
            health: self.health.clone(),
        }
    }

    /// One DoH JSON query for a record type (1 = A, 28 = AAAA). Returns (ip, ttl)
    /// pairs. Transport/status/JSON failures are distinct from a valid empty DNS answer so one
    /// nonexistent hostname cannot incorrectly mark the whole configured resolver unhealthy.
    async fn query(&self, host: &str, qtype: u16) -> Result<Vec<(IpAddr, u32)>, ()> {
        let url = format!("{}?name={}&type={}", self.doh_url, host, qtype);
        let resp = match self
            .boot
            .get(&url)
            .header("Accept", "application/dns-json")
            .send()
            .await
        {
            Ok(r) => r,
            Err(_) => return Err(()),
        };
        if !resp.status().is_success() {
            return Err(());
        }
        let body = match resp.text().await {
            Ok(t) => t,
            Err(_) => return Err(()),
        };
        let json: serde_json::Value = match serde_json::from_str(&body) {
            Ok(j) => j,
            Err(_) => return Err(()),
        };
        let mut out = Vec::new();
        if let Some(answers) = json.get("Answer").and_then(|a| a.as_array()) {
            for a in answers {
                if a.get("type").and_then(|t| t.as_u64()).unwrap_or(0) as u16 != qtype {
                    continue; // skip CNAME/other intermediary records
                }
                if let Some(ip) = a
                    .get("data")
                    .and_then(|d| d.as_str())
                    .and_then(|d| d.parse::<IpAddr>().ok())
                {
                    let ttl = a.get("TTL").and_then(|t| t.as_u64()).unwrap_or(60) as u32;
                    out.push((ip, ttl));
                }
            }
        }
        Ok(out)
    }

    /// Resolve only through the configured endpoint. The JVM bridge deliberately
    /// fails closed here: falling back to OS DNS would silently reintroduce the
    /// interception that the user enabled DoH to avoid.
    pub(crate) async fn resolve_doh_only(&self, host: &str) -> Result<Vec<IpAddr>, BoxError> {
        if let Ok(ip) = host.parse::<IpAddr>() {
            return Ok(vec![ip]);
        }
        if let Some(ips) = self.cached(host) {
            return Ok(ips);
        }
        let (a, aaaa) = tokio::join!(self.query(host, 1), self.query(host, 28));
        if a.is_err() && aaaa.is_err() {
            return Err("DNS-over-HTTPS endpoint is unreachable".into());
        }
        let mut records = a.unwrap_or_default();
        records.extend(aaaa.unwrap_or_default());
        if records.is_empty() {
            return Err(format!("DNS-over-HTTPS returned no address for {host}").into());
        }
        let ttl = records
            .iter()
            .map(|(_, ttl)| *ttl)
            .min()
            .unwrap_or(60)
            .clamp(30, 3600);
        let ips: Vec<IpAddr> = records.into_iter().map(|(ip, _)| ip).collect();
        self.store(host, &ips, ttl);
        Ok(ips)
    }

    async fn lookup(&self, host: &str) -> Result<Vec<SocketAddr>, BoxError> {
        // IP literal → nothing to resolve.
        if let Ok(ip) = host.parse::<IpAddr>() {
            return Ok(vec![SocketAddr::new(ip, 0)]);
        }
        if let Some(ips) = self.cached(host) {
            return Ok(with_port(ips));
        }
        // After one proven transport failure, use system DNS immediately for all uncached hosts
        // for a short period. This turns a blocked/custom DoH endpoint from a six-second delay per
        // hostname into one initial failure followed by fast, working lookups.
        if self.doh_bypassed() {
            return self.system(host).await;
        }
        // A + AAAA concurrently.
        let (a, aaaa) = tokio::join!(self.query(host, 1), self.query(host, 28));
        let reachable = a.is_ok() || aaaa.is_ok();
        let mut recs = a.unwrap_or_default();
        recs.extend(aaaa.unwrap_or_default());
        if reachable {
            self.mark_doh_healthy();
        } else {
            self.mark_doh_unhealthy();
        }
        if recs.is_empty() {
            // DoH unreachable / empty → system resolver so the app keeps working. Negative-cache
            // the fallback for a short TTL: without this, a blackholed/blocked/mistyped DoH
            // endpoint re-runs the full ~6s query (bootstrap timeout) on EVERY subsequent
            // connection to the same host, so with DoH on, every uncached host stalls ~6s and it
            // presents as "everything is slow". Short TTL so a transient DoH outage still recovers.
            let addrs = self.system(host).await?;
            let ips: Vec<IpAddr> = addrs.iter().map(|a| a.ip()).collect();
            if !ips.is_empty() {
                self.store(host, &ips, 30);
            }
            return Ok(addrs);
        }
        let ttl = recs
            .iter()
            .map(|(_, t)| *t)
            .min()
            .unwrap_or(60)
            .clamp(30, 3600);
        let ips: Vec<IpAddr> = recs.into_iter().map(|(ip, _)| ip).collect();
        self.store(host, &ips, ttl);
        Ok(with_port(ips))
    }

    async fn system(&self, host: &str) -> Result<Vec<SocketAddr>, BoxError> {
        Ok(tokio::net::lookup_host(format!("{host}:0"))
            .await?
            .collect())
    }

    fn cached(&self, host: &str) -> Option<Vec<IpAddr>> {
        let guard = self.cache.lock().ok()?;
        let e = guard.get(host)?;
        (e.expires > Instant::now()).then(|| e.ips.clone())
    }

    fn store(&self, host: &str, ips: &[IpAddr], ttl: u32) {
        if let Ok(mut g) = self.cache.lock() {
            // Opportunistic eviction: drop expired entries on write so the map stays bounded by
            // currently-live hosts, not every distinct hostname resolved this session.
            let now = Instant::now();
            g.retain(|_, e| e.expires > now);
            g.insert(
                host.to_string(),
                CacheEntry {
                    ips: ips.to_vec(),
                    expires: now + Duration::from_secs(ttl as u64),
                },
            );
        }
    }

    fn doh_bypassed(&self) -> bool {
        self.health
            .lock()
            .ok()
            .and_then(|health| health.bypass_until)
            .is_some_and(|until| until > Instant::now())
    }

    fn mark_doh_unhealthy(&self) {
        if let Ok(mut health) = self.health.lock() {
            health.bypass_until = Some(Instant::now() + UNHEALTHY_BYPASS);
        }
    }

    fn mark_doh_healthy(&self) {
        if let Ok(mut health) = self.health.lock() {
            health.bypass_until = None;
        }
    }
}

/// Port is a placeholder — hyper overrides it with the request's target port.
fn with_port(ips: Vec<IpAddr>) -> Vec<SocketAddr> {
    ips.into_iter().map(|ip| SocketAddr::new(ip, 0)).collect()
}

impl Resolve for DohResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        let this = self.clone_shared();
        Box::pin(async move {
            let addrs = this.lookup(&host).await?;
            let iter: Addrs = Box::new(addrs.into_iter());
            Ok(iter)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unhealthy_resolver_is_temporarily_bypassed() {
        let resolver = DohResolver::new("https://example.invalid/dns-query".into());
        assert!(!resolver.doh_bypassed());
        resolver.mark_doh_unhealthy();
        assert!(resolver.doh_bypassed());
        resolver.mark_doh_healthy();
        assert!(!resolver.doh_bypassed());
    }
}
