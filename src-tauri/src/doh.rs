//! DNS-over-HTTPS resolver for the pooled reqwest client.
//!
//! When "Use DNS over HTTPS" is enabled in Settings → Network, izumi's shared HTTP
//! client (addon stream/manifest fetches, AniZip, the id map, Kitsu, offline
//! downloads, edge prefetch) resolves hostnames through a DoH JSON endpoint
//! (Cloudflare by default) instead of the OS resolver. If the DoH query fails it
//! falls back to the system resolver so networking never hard-breaks — best-effort,
//! not fail-closed. AniList/MAL browse traffic (webview fetch) and mpv playback use
//! their own resolvers and are out of scope.

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

/// Custom reqwest resolver that answers via a DoH JSON endpoint. Cheap to clone
/// (the cache + bootstrap client are shared), which the `Resolve` impl relies on to
/// hand a `'static` future to reqwest.
pub struct DohResolver {
    doh_url: String,
    /// Bootstrap client for the DoH request itself. Deliberately uses the OS
    /// resolver (no DoH wrapper) so reaching the DoH host can't recurse.
    boot: reqwest::Client,
    cache: Arc<Mutex<HashMap<String, CacheEntry>>>,
}

impl DohResolver {
    pub fn new(doh_url: String) -> Self {
        let boot = reqwest::Client::builder()
            .timeout(Duration::from_secs(6))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { doh_url, boot, cache: Arc::new(Mutex::new(HashMap::new())) }
    }

    fn clone_shared(&self) -> Self {
        Self { doh_url: self.doh_url.clone(), boot: self.boot.clone(), cache: self.cache.clone() }
    }

    /// One DoH JSON query for a record type (1 = A, 28 = AAAA). Returns (ip, ttl)
    /// pairs; empty on any failure (caller decides fallback).
    async fn query(&self, host: &str, qtype: u16) -> Vec<(IpAddr, u32)> {
        let url = format!("{}?name={}&type={}", self.doh_url, host, qtype);
        let resp = match self.boot.get(&url).header("Accept", "application/dns-json").send().await {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };
        let body = match resp.text().await {
            Ok(t) => t,
            Err(_) => return Vec::new(),
        };
        let json: serde_json::Value = match serde_json::from_str(&body) {
            Ok(j) => j,
            Err(_) => return Vec::new(),
        };
        let mut out = Vec::new();
        if let Some(answers) = json.get("Answer").and_then(|a| a.as_array()) {
            for a in answers {
                if a.get("type").and_then(|t| t.as_u64()).unwrap_or(0) as u16 != qtype {
                    continue; // skip CNAME/other intermediary records
                }
                if let Some(ip) = a.get("data").and_then(|d| d.as_str()).and_then(|d| d.parse::<IpAddr>().ok()) {
                    let ttl = a.get("TTL").and_then(|t| t.as_u64()).unwrap_or(60) as u32;
                    out.push((ip, ttl));
                }
            }
        }
        out
    }

    async fn lookup(&self, host: &str) -> Result<Vec<SocketAddr>, BoxError> {
        // IP literal → nothing to resolve.
        if let Ok(ip) = host.parse::<IpAddr>() {
            return Ok(vec![SocketAddr::new(ip, 0)]);
        }
        if let Some(ips) = self.cached(host) {
            return Ok(with_port(ips));
        }
        // A + AAAA concurrently.
        let (mut recs, aaaa) = tokio::join!(self.query(host, 1), self.query(host, 28));
        recs.extend(aaaa);
        if recs.is_empty() {
            // DoH unreachable / empty → system resolver so the app keeps working.
            return self.system(host).await;
        }
        let ttl = recs.iter().map(|(_, t)| *t).min().unwrap_or(60).clamp(30, 3600);
        let ips: Vec<IpAddr> = recs.into_iter().map(|(ip, _)| ip).collect();
        self.store(host, &ips, ttl);
        Ok(with_port(ips))
    }

    async fn system(&self, host: &str) -> Result<Vec<SocketAddr>, BoxError> {
        Ok(tokio::net::lookup_host(format!("{host}:0")).await?.collect())
    }

    fn cached(&self, host: &str) -> Option<Vec<IpAddr>> {
        let guard = self.cache.lock().ok()?;
        let e = guard.get(host)?;
        (e.expires > Instant::now()).then(|| e.ips.clone())
    }

    fn store(&self, host: &str, ips: &[IpAddr], ttl: u32) {
        if let Ok(mut g) = self.cache.lock() {
            g.insert(host.to_string(), CacheEntry { ips: ips.to_vec(), expires: Instant::now() + Duration::from_secs(ttl as u64) });
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
