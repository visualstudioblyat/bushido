use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use axum::{Router, body::Bytes, extract::State, http::{StatusCode, header}, routing::{get, post}};
use hickory_proto::op::{Message, MessageType, OpCode, ResponseCode};
use hickory_proto::rr::RData;
use hickory_proto::serialize::binary::{BinDecodable, BinEncodable};
use moka::future::Cache;
use parking_lot::RwLock;

const MAX_CACHE: u64 = 10_000;
const MAX_TTL: u64 = 300;
const MIN_TTL: u64 = 10;
const UPSTREAM_TIMEOUT: u64 = 3;
const PRIMARY: &str = "https://cloudflare-dns.com/dns-query";
const FALLBACK: &str = "https://dns.google/dns-query";

#[derive(Clone, Copy, PartialEq, serde::Deserialize, serde::Serialize)]
pub enum PrivacyLevel {
    Standard,  // doh + basic tracker blocklist
    Strict,    // + cname uncloaking + expanded lists
    Maximum,   // + block all third-party dns, fail-closed
}

impl Default for PrivacyLevel { fn default() -> Self { Self::Strict } }

const CNAME_TRACKERS: &[&str] = &[
    "data.adobedc.net", "sc.omtrdc.net", "demdex.net", "2o7.net",
    "omniture.com", "everesttech.net", "tt.omtrdc.net", "eulerian.net",
    "dnsdelegation.io", "at-o.net", "keyade.com", "storetail.io",
    "affex.org", "wt-eu02.net", "webtrekk.net", "tracedock.com",
    "oghub.io", "wizaly.com", "npttech.com", "tagcommander.com",
];

#[derive(Hash, Eq, PartialEq, Clone)]
struct CacheKey { name: String, qtype: u16 }

struct CacheEntry { bytes: Vec<u8>, at: Instant, ttl: Duration }

pub struct Stats {
    pub queries: AtomicU64,
    pub hits: AtomicU64,
    pub blocked: AtomicU64,
    pub cname_blocked: AtomicU64,
    pub upstream: AtomicU64,
    pub errors: AtomicU64,
}

struct Resolver {
    cache: Cache<CacheKey, Arc<CacheEntry>>,
    blocklist: RwLock<HashSet<String>>,
    client: reqwest::Client,
    stats: Arc<Stats>,
    level: RwLock<PrivacyLevel>,
}

impl Resolver {
    fn new() -> Arc<Self> {
        let mut bl = HashSet::new();
        for t in CNAME_TRACKERS { bl.insert(t.to_string()); }

        Arc::new(Self {
            cache: Cache::builder()
                .max_capacity(MAX_CACHE)
                .time_to_live(Duration::from_secs(MAX_TTL))
                .build(),
            blocklist: RwLock::new(bl),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(UPSTREAM_TIMEOUT + 2))
                .https_only(true)
                .build()
                .expect("dns http client"),
            stats: Arc::new(Stats {
                queries: AtomicU64::new(0),
                hits: AtomicU64::new(0),
                blocked: AtomicU64::new(0),
                cname_blocked: AtomicU64::new(0),
                upstream: AtomicU64::new(0),
                errors: AtomicU64::new(0),
            }),
            level: RwLock::new(PrivacyLevel::Strict),
        })
    }

    fn is_blocked(&self, domain: &str) -> bool {
        let d = domain.trim_end_matches('.');
        self.blocklist.read().iter().any(|b| d == b.as_str() || d.ends_with(&format!(".{}", b)))
    }

    async fn query(&self, bytes: &[u8]) -> Result<Vec<u8>, String> {
        if let Ok(r) = self.doh(PRIMARY, bytes).await { return Ok(r); }
        if *self.level.read() == PrivacyLevel::Maximum {
            return Err("primary failed, maximum mode blocks fallback".into());
        }
        self.doh(FALLBACK, bytes).await
    }

    async fn doh(&self, url: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
        let r = self.client.post(url)
            .header("content-type", "application/dns-message")
            .header("accept", "application/dns-message")
            .body(bytes.to_vec())
            .timeout(Duration::from_secs(UPSTREAM_TIMEOUT))
            .send().await.map_err(|e| e.to_string())?;
        if !r.status().is_success() { return Err(format!("{}", r.status())); }
        r.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string())
    }

    fn nxdomain(req: &Message) -> Vec<u8> {
        let mut r = Message::new();
        r.set_id(req.id());
        r.set_message_type(MessageType::Response);
        r.set_op_code(OpCode::Query);
        r.set_response_code(ResponseCode::NXDomain);
        r.set_recursion_desired(true);
        r.set_recursion_available(true);
        for q in req.queries() { r.add_query(q.clone()); }
        r.to_bytes().unwrap_or_default()
    }

    fn cnames(msg: &Message) -> Vec<String> {
        msg.answers().iter().filter_map(|r| match r.data() {
            RData::CNAME(c) => Some(c.0.to_ascii()),
            _ => None,
        }).collect()
    }

    fn ttl(msg: &Message) -> Duration {
        let t = msg.answers().iter().map(|r| r.ttl()).min().unwrap_or(60);
        Duration::from_secs(t.max(MIN_TTL as u32).min(MAX_TTL as u32) as u64)
    }

    async fn resolve(&self, raw: &[u8]) -> Result<Vec<u8>, String> {
        self.stats.queries.fetch_add(1, Ordering::Relaxed);

        let req = Message::from_bytes(raw).map_err(|e| e.to_string())?;
        let q = req.queries().first().ok_or("empty")?;
        let name = q.name().to_ascii();

        let level = *self.level.read();

        if self.is_blocked(&name) {
            self.stats.blocked.fetch_add(1, Ordering::Relaxed);
            return Ok(Self::nxdomain(&req));
        }

        let key = CacheKey { name: name.clone(), qtype: q.query_type().into() };
        if let Some(e) = self.cache.get(&key).await {
            if e.at.elapsed() < e.ttl {
                self.stats.hits.fetch_add(1, Ordering::Relaxed);
                return Ok(e.bytes.clone());
            }
        }

        self.stats.upstream.fetch_add(1, Ordering::Relaxed);
        let resp = self.query(raw).await?;

        if let Ok(msg) = Message::from_bytes(&resp) {
            if level != PrivacyLevel::Standard {
                for target in Self::cnames(&msg) {
                    if self.is_blocked(&target) {
                        self.stats.cname_blocked.fetch_add(1, Ordering::Relaxed);
                        return Ok(Self::nxdomain(&req));
                    }
                }
            }
            self.cache.insert(key, Arc::new(CacheEntry {
                bytes: resp.clone(), at: Instant::now(), ttl: Self::ttl(&msg),
            })).await;
        }

        Ok(resp)
    }
}

async fn handle_post(State(r): State<Arc<Resolver>>, body: Bytes) -> axum::response::Response {
    match r.resolve(&body).await {
        Ok(b) => axum::response::Response::builder()
            .status(200).header(header::CONTENT_TYPE, "application/dns-message")
            .body(axum::body::Body::from(b)).unwrap(),
        Err(_) => { r.stats.errors.fetch_add(1, Ordering::Relaxed);
            axum::response::Response::builder().status(500).body(axum::body::Body::empty()).unwrap() }
    }
}

async fn handle_get(State(r): State<Arc<Resolver>>, req: axum::extract::Request) -> axum::response::Response {
    let param = req.uri().query().unwrap_or("").split('&')
        .find_map(|p| p.strip_prefix("dns=")).unwrap_or("");
    if param.is_empty() {
        return axum::response::Response::builder().status(400).body(axum::body::Body::empty()).unwrap();
    }
    use base64::Engine;
    let raw = match base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(param) {
        Ok(b) => b, Err(_) => return axum::response::Response::builder()
            .status(400).body(axum::body::Body::empty()).unwrap(),
    };
    match r.resolve(&raw).await {
        Ok(b) => axum::response::Response::builder()
            .status(200).header(header::CONTENT_TYPE, "application/dns-message")
            .body(axum::body::Body::from(b)).unwrap(),
        Err(_) => { r.stats.errors.fetch_add(1, Ordering::Relaxed);
            axum::response::Response::builder().status(500).body(axum::body::Body::empty()).unwrap() }
    }
}

async fn handle_stats(State(r): State<Arc<Resolver>>) -> axum::Json<serde_json::Value> {
    let level = match *r.level.read() {
        PrivacyLevel::Standard => "standard",
        PrivacyLevel::Strict => "strict",
        PrivacyLevel::Maximum => "maximum",
    };
    axum::Json(serde_json::json!({
        "level": level,
        "queries": r.stats.queries.load(Ordering::Relaxed),
        "hits": r.stats.hits.load(Ordering::Relaxed),
        "blocked": r.stats.blocked.load(Ordering::Relaxed),
        "cname_blocked": r.stats.cname_blocked.load(Ordering::Relaxed),
        "upstream": r.stats.upstream.load(Ordering::Relaxed),
        "errors": r.stats.errors.load(Ordering::Relaxed),
        "cache": r.cache.entry_count(),
    }))
}

async fn set_level(State(r): State<Arc<Resolver>>, body: Bytes) -> StatusCode {
    if let Ok(s) = std::str::from_utf8(&body) {
        let new_level = match s.trim().trim_matches('"') {
            "standard" => PrivacyLevel::Standard,
            "strict" => PrivacyLevel::Strict,
            "maximum" => PrivacyLevel::Maximum,
            _ => return StatusCode::BAD_REQUEST,
        };
        *r.level.write() = new_level;
        r.cache.invalidate_all();
        StatusCode::OK
    } else { StatusCode::BAD_REQUEST }
}

pub async fn start() -> Result<u16, String> {
    let app = Router::new()
        .route("/dns-query", post(handle_post))
        .route("/dns-query", get(handle_get))
        .route("/stats", get(handle_stats))
        .route("/level", post(set_level))
        .with_state(Resolver::new());

    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    Ok(port)
}

pub fn flags(port: u16) -> String {
    format!("--enable-features=DnsOverHttps --dns-over-https-mode=secure --dns-over-https-templates=http://localhost:{}/dns-query", port)
}
