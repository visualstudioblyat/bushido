use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use serde::{Serialize, Deserialize};
use tauri::{AppHandle, Manager, Emitter};
use futures_util::StreamExt;

const PROGRESS_INTERVAL_MS: u128 = 500;
const MANIFEST_INTERVAL_SECS: u64 = 5;
const SPEED_WINDOW_SECS: f64 = 2.0;
const MIN_CHUNK_SIZE: u64 = 512 * 1024; // 512KB min per segment
const DEFAULT_SEGMENTS: u32 = 6;

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DlState {
    Downloading,
    Paused,
    Completed,
    Failed,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DlItem {
    pub id: String,
    pub url: String,
    pub file_path: String,
    pub file_name: String,
    pub mime_type: String,
    pub total_bytes: Option<u64>,
    pub received_bytes: u64,
    pub state: DlState,
    pub speed: u64,
    pub error: Option<String>,
    pub created_at: u64,
    pub supports_range: bool,
    pub segments: u32, // active connection count (0 = single-stream)
}

#[derive(Clone, Serialize, Deserialize)]
struct Segment {
    idx: u32,
    start: u64,   // byte range start (inclusive)
    end: u64,     // byte range end (inclusive)
    downloaded: u64,
    done: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    id: String,
    url: String,
    file_path: String,
    file_name: String,
    total_bytes: Option<u64>,
    received_bytes: u64,
    supports_range: bool,
    etag: Option<String>,
    created_at: u64,
    #[serde(default)]
    segments: Vec<Segment>,
    #[serde(default)]
    cookies: Option<String>,
}

pub struct DownloadManager {
    pub downloads: Mutex<HashMap<String, DlItem>>,
    pub cancel_tx: Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>,
}

impl DownloadManager {
    pub fn new() -> Self {
        Self {
            downloads: Mutex::new(HashMap::new()),
            cancel_tx: Mutex::new(HashMap::new()),
        }
    }
}

fn now_epoch() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn manifests_dir(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(".")).join("downloads");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn manifest_path(app: &AppHandle, id: &str) -> PathBuf {
    manifests_dir(app).join(format!("{}.part.json", id))
}

fn save_manifest(app: &AppHandle, m: &Manifest) {
    let path = manifest_path(app, &m.id);
    let tmp = path.with_extension("tmp");
    if let Ok(json) = serde_json::to_string(m) {
        if std::fs::write(&tmp, &json).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        }
    }
}

fn load_manifest(path: &Path) -> Option<Manifest> {
    let data = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

fn delete_manifest(app: &AppHandle, id: &str) {
    let _ = std::fs::remove_file(manifest_path(app, id));
}

pub fn load_pending(app: &AppHandle) -> Vec<DlItem> {
    let dir = manifests_dir(app);
    let mut items = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Some(m) = load_manifest(&path) {
                    // only restore if partial file exists
                    if Path::new(&m.file_path).exists() {
                        let seg_count = m.segments.iter().filter(|s| !s.done).count() as u32;
                        items.push(DlItem {
                            id: m.id,
                            url: m.url,
                            file_path: m.file_path,
                            file_name: m.file_name,
                            mime_type: String::new(),
                            total_bytes: m.total_bytes,
                            received_bytes: m.received_bytes,
                            state: DlState::Paused,
                            speed: 0,
                            error: None,
                            created_at: m.created_at,
                            supports_range: m.supports_range,
                            segments: seg_count,
                        });
                    }
                }
            }
        }
    }
    items
}

// deduplicate filename: report.pdf -> report (1).pdf
fn dedup_filename(dir: &str, name: &str) -> String {
    let base = Path::new(dir).join(name);
    if !base.exists() { return name.to_string(); }

    let stem = Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let ext = Path::new(name).extension().and_then(|e| e.to_str());

    for i in 1..1000 {
        let candidate = match ext {
            Some(e) => format!("{} ({}).{}", stem, i, e),
            None => format!("{} ({})", stem, i),
        };
        if !Path::new(dir).join(&candidate).exists() {
            return candidate;
        }
    }
    name.to_string()
}

// extract filename from content-disposition or url
pub fn parse_filename(url: &str, disposition: &str) -> String {
    // try content-disposition first
    if !disposition.is_empty() {
        // filename*=UTF-8''encoded or filename="name"
        if let Some(idx) = disposition.find("filename*=") {
            let rest = &disposition[idx + 10..];
            if let Some(start) = rest.find("''") {
                let encoded = rest[start + 2..].split(';').next().unwrap_or("").trim();
                if let Ok(decoded) = urlencoding::decode(encoded) {
                    let name = decoded.trim_matches('"').to_string();
                    if !name.is_empty() { return name; }
                }
            }
        }
        if let Some(idx) = disposition.find("filename=") {
            let rest = &disposition[idx + 9..].trim_start();
            let name = rest.split(';').next().unwrap_or("").trim().trim_matches('"').to_string();
            if !name.is_empty() { return name; }
        }
    }

    // fall back to url path
    if let Ok(parsed) = url::Url::parse(url) {
        if let Some(segments) = parsed.path_segments() {
            if let Some(last) = segments.last() {
                let decoded = urlencoding::decode(last).unwrap_or_else(|_| last.into());
                let name = decoded.to_string();
                if !name.is_empty() && name != "/" { return name; }
            }
        }
    }

    "download".to_string()
}

pub async fn start(app: AppHandle, url: String, file_name: String, download_dir: String, cookies: Option<String>) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let final_name = dedup_filename(&download_dir, &file_name);
    let file_path = Path::new(&download_dir).join(&final_name).to_string_lossy().to_string();

    let item = DlItem {
        id: id.clone(),
        url: url.clone(),
        file_path: file_path.clone(),
        file_name: final_name.clone(),
        mime_type: String::new(),
        total_bytes: None,
        received_bytes: 0,
        state: DlState::Downloading,
        speed: 0,
        error: None,
        created_at: now_epoch(),
        supports_range: false,
        segments: 0,
    };

    {
        let dm = app.state::<DownloadManager>();
        dm.downloads.lock().unwrap().insert(id.clone(), item.clone());
    }

    let (tx, rx) = tokio::sync::watch::channel(false);
    {
        let dm = app.state::<DownloadManager>();
        dm.cancel_tx.lock().unwrap().insert(id.clone(), tx);
    }

    let _ = app.emit_to("main", "download-started", &item);

    let app2 = app.clone();
    let id2 = id.clone();
    let cookies2 = cookies.clone();
    tokio::spawn(async move {
        // HEAD to check range support + total size
        let client = reqwest::Client::new();
        let mut total_bytes: Option<u64> = None;
        let mut supports_range = false;

        let mut head_req = client.head(&url);
        if let Some(ref c) = cookies2 {
            head_req = head_req.header("Cookie", c.as_str());
        }
        if let Ok(head) = head_req.send().await {
            if let Some(cl) = head.headers().get("content-length") {
                if let Ok(len) = cl.to_str().unwrap_or("0").parse::<u64>() {
                    total_bytes = Some(len);
                }
            }
            if let Some(ar) = head.headers().get("accept-ranges") {
                if ar.to_str().unwrap_or("") == "bytes" {
                    supports_range = true;
                }
            }
        }

        // update item with size info
        {
            let dm = app2.state::<DownloadManager>();
            let mut downloads = dm.downloads.lock().unwrap();
            if let Some(item) = downloads.get_mut(&id2) {
                item.total_bytes = total_bytes;
                item.supports_range = supports_range;
            }
        }

        // decide: chunked or single-stream
        let use_chunked = supports_range
            && total_bytes.map_or(false, |t| t >= MIN_CHUNK_SIZE * 2);

        if use_chunked {
            let total = total_bytes.unwrap();
            dl_task_chunked(app2, id2, url, file_path, total, cookies2, None, rx).await;
        } else {
            dl_task(app2, id2, url, file_path, cookies2, 0, rx).await;
        }
    });

    Ok(id)
}

pub async fn resume(app: AppHandle, id: String) -> Result<(), String> {
    let manifest_data = {
        let manifest_p = manifest_path(&app, &id);
        load_manifest(&manifest_p)
    };

    let (url, file_path, _file_name, _download_dir, offset, has_segments) = {
        let dm = app.state::<DownloadManager>();
        let mut downloads = dm.downloads.lock().unwrap();
        let item = downloads.get_mut(&id).ok_or("not found")?;
        if item.state != DlState::Paused { return Err("not paused".into()); }
        if !item.supports_range { return Err("server doesn't support resume".into()); }
        item.state = DlState::Downloading;
        item.speed = 0;
        let dir = Path::new(&item.file_path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        let has_segs = manifest_data.as_ref().map_or(false, |m| !m.segments.is_empty());
        (item.url.clone(), item.file_path.clone(), item.file_name.clone(), dir, item.received_bytes, has_segs)
    };

    let (tx, rx) = tokio::sync::watch::channel(false);
    {
        let dm = app.state::<DownloadManager>();
        dm.cancel_tx.lock().unwrap().insert(id.clone(), tx);
    }

    let app2 = app.clone();
    let id2 = id.clone();

    if has_segments {
        // chunked resume
        let m = manifest_data.unwrap();
        let total = m.total_bytes.unwrap_or(0);
        let cookies = m.cookies.clone();
        let segments = m.segments.clone();
        tokio::spawn(async move {
            dl_task_chunked(app2, id2, url, file_path, total, cookies, Some(segments), rx).await;
        });
    } else {
        // single-stream resume
        let cookies = manifest_data.and_then(|m| m.cookies.clone());
        tokio::spawn(async move {
            dl_task(app2, id2, url, file_path, cookies, offset, rx).await;
        });
    }

    Ok(())
}

pub fn pause(app: &AppHandle, id: &str) -> Result<(), String> {
    let dm = app.state::<DownloadManager>();

    // signal cancel to stop the stream
    if let Some(tx) = dm.cancel_tx.lock().unwrap().remove(id) {
        let _ = tx.send(true);
    }

    let mut downloads = dm.downloads.lock().unwrap();
    let item = downloads.get_mut(id).ok_or("not found")?;
    item.state = DlState::Paused;
    item.speed = 0;

    // save manifest for resume (segments saved by chunked task itself on cancel)
    // but we always write a basic manifest here as fallback
    let m = Manifest {
        id: id.to_string(),
        url: item.url.clone(),
        file_path: item.file_path.clone(),
        file_name: item.file_name.clone(),
        total_bytes: item.total_bytes,
        received_bytes: item.received_bytes,
        supports_range: item.supports_range,
        etag: None,
        created_at: item.created_at,
        segments: Vec::new(),
        cookies: None,
    };
    // only save if no manifest exists yet (chunked task saves its own with segments)
    let mpath = manifest_path(app, id);
    if !mpath.exists() {
        save_manifest(app, &m);
    }

    let _ = app.emit_to("main", "download-progress", item.clone());
    Ok(())
}

pub fn cancel(app: &AppHandle, id: &str) -> Result<(), String> {
    let dm = app.state::<DownloadManager>();

    // signal cancel
    if let Some(tx) = dm.cancel_tx.lock().unwrap().remove(id) {
        let _ = tx.send(true);
    }

    let file_path = {
        let mut downloads = dm.downloads.lock().unwrap();
        let item = downloads.remove(id).ok_or("not found")?;
        item.file_path
    };

    // clean up partial file + manifest
    let _ = std::fs::remove_file(&file_path);
    delete_manifest(app, id);

    let _ = app.emit_to("main", "download-cancelled", serde_json::json!({ "id": id }));
    Ok(())
}

// single-stream download (v1 path, also fallback for non-range servers)
async fn dl_task(
    app: AppHandle,
    id: String,
    url: String,
    file_path: String,
    cookies: Option<String>,
    resume_offset: u64,
    mut cancel_rx: tokio::sync::watch::Receiver<bool>,
) {
    let client = reqwest::Client::new();

    // HEAD to check range support + total size (skip if start() already did it)
    let mut total_bytes: Option<u64> = None;
    let mut supports_range = false;
    {
        let dm = app.state::<DownloadManager>();
        let downloads = dm.downloads.lock().unwrap();
        if let Some(item) = downloads.get(&id) {
            total_bytes = item.total_bytes;
            supports_range = item.supports_range;
        }
    }

    // build GET request
    let mut req = client.get(&url);
    if let Some(ref c) = cookies {
        req = req.header("Cookie", c.as_str());
    }
    if resume_offset > 0 && supports_range {
        req = req.header("Range", format!("bytes={}-", resume_offset));
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            fail(&app, &id, &e.to_string());
            return;
        }
    };

    // if resuming and server doesn't honor range, restart from 0
    let actual_offset = if resume_offset > 0 && resp.status() == 200 {
        0u64
    } else {
        resume_offset
    };

    // if we got 200 on fresh request, check content-length from response
    if total_bytes.is_none() {
        if let Some(cl) = resp.headers().get("content-length") {
            if let Ok(len) = cl.to_str().unwrap_or("0").parse::<u64>() {
                total_bytes = Some(len + actual_offset);
                let dm = app.state::<DownloadManager>();
                let mut downloads = dm.downloads.lock().unwrap();
                if let Some(item) = downloads.get_mut(&id) {
                    item.total_bytes = total_bytes;
                }
            }
        }
    }

    // open file for writing
    use std::io::{Seek, SeekFrom, Write};
    let file = if actual_offset > 0 {
        // resume: open existing, seek to offset
        match std::fs::OpenOptions::new().write(true).open(&file_path) {
            Ok(mut f) => {
                if f.seek(SeekFrom::Start(actual_offset)).is_err() {
                    fail(&app, &id, "failed to seek in file");
                    return;
                }
                f
            }
            Err(e) => {
                fail(&app, &id, &e.to_string());
                return;
            }
        }
    } else {
        match std::fs::File::create(&file_path) {
            Ok(f) => f,
            Err(e) => {
                fail(&app, &id, &e.to_string());
                return;
            }
        }
    };
    let mut writer = std::io::BufWriter::new(file);

    let mut received = actual_offset;
    let mut last_emit = Instant::now();
    let mut last_manifest = Instant::now();
    let mut speed_bytes: u64 = 0;
    let mut speed_start = Instant::now();
    let mut stream = resp.bytes_stream();

    loop {
        tokio::select! {
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        if writer.write_all(&bytes).is_err() {
                            fail(&app, &id, "write error");
                            return;
                        }
                        received += bytes.len() as u64;
                        speed_bytes += bytes.len() as u64;

                        // calc speed
                        let elapsed = speed_start.elapsed().as_secs_f64();
                        let speed = if elapsed >= SPEED_WINDOW_SECS {
                            let s = (speed_bytes as f64 / elapsed) as u64;
                            speed_bytes = 0;
                            speed_start = Instant::now();
                            s
                        } else if elapsed > 0.1 {
                            (speed_bytes as f64 / elapsed) as u64
                        } else {
                            0
                        };

                        // throttled progress emit
                        if last_emit.elapsed().as_millis() >= PROGRESS_INTERVAL_MS {
                            last_emit = Instant::now();
                            let dm = app.state::<DownloadManager>();
                            let mut downloads = dm.downloads.lock().unwrap();
                            if let Some(item) = downloads.get_mut(&id) {
                                item.received_bytes = received;
                                item.speed = speed;
                                let _ = app.emit_to("main", "download-progress", item.clone());
                            }
                        }

                        // periodic manifest save
                        if last_manifest.elapsed().as_secs() >= MANIFEST_INTERVAL_SECS {
                            last_manifest = Instant::now();
                            let dm = app.state::<DownloadManager>();
                            let downloads = dm.downloads.lock().unwrap();
                            if let Some(item) = downloads.get(&id) {
                                let m = Manifest {
                                    id: id.clone(),
                                    url: item.url.clone(),
                                    file_path: item.file_path.clone(),
                                    file_name: item.file_name.clone(),
                                    total_bytes: item.total_bytes,
                                    received_bytes: received,
                                    supports_range: item.supports_range,
                                    etag: None,
                                    created_at: item.created_at,
                                    segments: Vec::new(),
                                    cookies: cookies.clone(),
                                };
                                save_manifest(&app, &m);
                            }
                        }
                    }
                    Some(Err(e)) => {
                        fail(&app, &id, &e.to_string());
                        return;
                    }
                    None => break, // stream done
                }
            }
            _ = cancel_rx.changed() => {
                // paused or cancelled externally
                let _ = writer.flush();
                return;
            }
        }
    }

    // flush and complete
    let _ = writer.flush();

    {
        let dm = app.state::<DownloadManager>();
        let mut downloads = dm.downloads.lock().unwrap();
        if let Some(item) = downloads.get_mut(&id) {
            item.received_bytes = received;
            item.state = DlState::Completed;
            item.speed = 0;
            item.segments = 0;
            let _ = app.emit_to("main", "download-complete", item.clone());
        }
    }

    delete_manifest(&app, &id);
}

// parallel chunked download (v2 path)
#[cfg(windows)]
async fn dl_task_chunked(
    app: AppHandle,
    id: String,
    url: String,
    file_path: String,
    total: u64,
    cookies: Option<String>,
    resume_segments: Option<Vec<Segment>>,
    mut cancel_rx: tokio::sync::watch::Receiver<bool>,
) {
    // pre-allocate file if fresh download
    if resume_segments.is_none() {
        match std::fs::File::create(&file_path) {
            Ok(f) => {
                if f.set_len(total).is_err() {
                    fail(&app, &id, "failed to pre-allocate file");
                    return;
                }
                // drop the handle so workers can open it
            }
            Err(e) => {
                fail(&app, &id, &e.to_string());
                return;
            }
        }
    }

    // create or restore segments
    let initial_segments = if let Some(segs) = resume_segments {
        segs
    } else {
        let seg_count = DEFAULT_SEGMENTS.min((total / MIN_CHUNK_SIZE).max(1) as u32);
        let chunk_size = total / seg_count as u64;
        let mut segs = Vec::new();
        for i in 0..seg_count {
            let start = i as u64 * chunk_size;
            let end = if i == seg_count - 1 { total - 1 } else { (i as u64 + 1) * chunk_size - 1 };
            segs.push(Segment { idx: i, start, end, downloaded: 0, done: false });
        }
        segs
    };

    let seg_state: Arc<Mutex<Vec<Segment>>> = Arc::new(Mutex::new(initial_segments));

    // update DlItem segment count
    {
        let dm = app.state::<DownloadManager>();
        let mut downloads = dm.downloads.lock().unwrap();
        if let Some(item) = downloads.get_mut(&id) {
            let segs = seg_state.lock().unwrap();
            item.segments = segs.iter().filter(|s| !s.done).count() as u32;
        }
    }

    // channel for workers to signal completion
    // keep done_tx alive in orchestrator so we can spawn new workers from splits
    let (done_tx, mut done_rx) = tokio::sync::mpsc::unbounded_channel::<u32>();

    // spawn workers for non-done segments
    {
        let segs = seg_state.lock().unwrap();
        for seg in segs.iter() {
            if seg.done { continue; }
            spawn_segment_worker(
                seg.idx,
                seg.start + seg.downloaded,
                seg.end,
                url.clone(),
                file_path.clone(),
                cookies.clone(),
                seg_state.clone(),
                done_tx.clone(),
                cancel_rx.clone(),
            );
        }
    }

    // track active worker count to know when all are done
    let mut active_workers = {
        let segs = seg_state.lock().unwrap();
        segs.iter().filter(|s| !s.done).count()
    };

    let mut tick = tokio::time::interval(std::time::Duration::from_millis(500));
    let mut last_manifest_save = Instant::now();
    let mut speed_bytes: u64 = 0;
    let mut speed_start = Instant::now();
    let mut last_total: u64 = {
        let segs = seg_state.lock().unwrap();
        segs.iter().map(|s| s.downloaded).sum()
    };

    loop {
        tokio::select! {
            done_seg = done_rx.recv() => {
                match done_seg {
                    Some(_seg_idx) => {
                        active_workers -= 1;

                        // try dynamic split — spawn new worker for the split-off range
                        if let Some((new_idx, new_start, new_end)) = try_split(&seg_state) {
                            spawn_segment_worker(
                                new_idx,
                                new_start,
                                new_end,
                                url.clone(),
                                file_path.clone(),
                                cookies.clone(),
                                seg_state.clone(),
                                done_tx.clone(),
                                cancel_rx.clone(),
                            );
                            active_workers += 1;
                        }

                        if active_workers == 0 { break; }
                    }
                    None => {
                        // all senders dropped = all workers finished
                        break;
                    }
                }
            }
            _ = tick.tick() => {
                // aggregate progress
                let (received, active_count) = {
                    let segs = seg_state.lock().unwrap();
                    let r: u64 = segs.iter().map(|s| s.downloaded).sum();
                    let a = segs.iter().filter(|s| !s.done).count() as u32;
                    (r, a)
                };

                // speed calc
                let delta = received.saturating_sub(last_total);
                speed_bytes += delta;
                last_total = received;
                let elapsed = speed_start.elapsed().as_secs_f64();
                let speed = if elapsed >= SPEED_WINDOW_SECS {
                    let s = (speed_bytes as f64 / elapsed) as u64;
                    speed_bytes = 0;
                    speed_start = Instant::now();
                    s
                } else if elapsed > 0.1 {
                    (speed_bytes as f64 / elapsed) as u64
                } else {
                    0
                };

                // emit progress
                {
                    let dm = app.state::<DownloadManager>();
                    let mut downloads = dm.downloads.lock().unwrap();
                    if let Some(item) = downloads.get_mut(&id) {
                        item.received_bytes = received;
                        item.speed = speed;
                        item.segments = active_count;
                        let _ = app.emit_to("main", "download-progress", item.clone());
                    }
                }

                // periodic manifest save
                if last_manifest_save.elapsed().as_secs() >= MANIFEST_INTERVAL_SECS {
                    last_manifest_save = Instant::now();
                    let segs = seg_state.lock().unwrap().clone();
                    let dm = app.state::<DownloadManager>();
                    let downloads = dm.downloads.lock().unwrap();
                    if let Some(item) = downloads.get(&id) {
                        let m = Manifest {
                            id: id.clone(),
                            url: item.url.clone(),
                            file_path: item.file_path.clone(),
                            file_name: item.file_name.clone(),
                            total_bytes: item.total_bytes,
                            received_bytes: received,
                            supports_range: item.supports_range,
                            etag: None,
                            created_at: item.created_at,
                            segments: segs,
                            cookies: cookies.clone(),
                        };
                        save_manifest(&app, &m);
                    }
                }
            }
            _ = cancel_rx.changed() => {
                // pause/cancel — save manifest with current segment state
                let segs = seg_state.lock().unwrap().clone();
                let received: u64 = segs.iter().map(|s| s.downloaded).sum();
                let dm = app.state::<DownloadManager>();
                let downloads = dm.downloads.lock().unwrap();
                if let Some(item) = downloads.get(&id) {
                    let m = Manifest {
                        id: id.clone(),
                        url: item.url.clone(),
                        file_path: item.file_path.clone(),
                        file_name: item.file_name.clone(),
                        total_bytes: item.total_bytes,
                        received_bytes: received,
                        supports_range: item.supports_range,
                        etag: None,
                        created_at: item.created_at,
                        segments: segs,
                        cookies: cookies.clone(),
                    };
                    save_manifest(&app, &m);
                }
                // workers will exit via their own cancel_rx clone
                return;
            }
        }
    }

    // all done — mark complete
    let received: u64 = {
        let segs = seg_state.lock().unwrap();
        segs.iter().map(|s| s.downloaded).sum()
    };

    {
        let dm = app.state::<DownloadManager>();
        let mut downloads = dm.downloads.lock().unwrap();
        if let Some(item) = downloads.get_mut(&id) {
            item.received_bytes = received;
            item.state = DlState::Completed;
            item.speed = 0;
            item.segments = 0;
            let _ = app.emit_to("main", "download-complete", item.clone());
        }
    }

    delete_manifest(&app, &id);
}

#[cfg(not(windows))]
async fn dl_task_chunked(
    app: AppHandle,
    id: String,
    url: String,
    file_path: String,
    _total: u64,
    cookies: Option<String>,
    _resume_segments: Option<Vec<Segment>>,
    cancel_rx: tokio::sync::watch::Receiver<bool>,
) {
    // non-windows fallback: single-stream
    dl_task(app, id, url, file_path, cookies, 0, cancel_rx).await;
}

#[cfg(windows)]
fn spawn_segment_worker(
    seg_idx: u32,
    start_from: u64,
    end: u64,
    url: String,
    file_path: String,
    cookies: Option<String>,
    seg_state: Arc<Mutex<Vec<Segment>>>,
    done_tx: tokio::sync::mpsc::UnboundedSender<u32>,
    mut cancel_rx: tokio::sync::watch::Receiver<bool>,
) {
    let _ = tokio::spawn(async move {
        use std::os::windows::fs::FileExt;

        let client = reqwest::Client::new();
        let mut req = client.get(&url)
            .header("Range", format!("bytes={}-{}", start_from, end));
        if let Some(ref c) = cookies {
            req = req.header("Cookie", c.as_str());
        }

        let resp = match req.send().await {
            Ok(r) => r,
            Err(_) => {
                // segment failed, mark done to not block
                let mut segs = seg_state.lock().unwrap();
                if let Some(s) = segs.iter_mut().find(|s| s.idx == seg_idx) {
                    s.done = true;
                }
                let _ = done_tx.send(seg_idx);
                return;
            }
        };

        let file = match std::fs::OpenOptions::new().write(true).open(&file_path) {
            Ok(f) => f,
            Err(_) => {
                let mut segs = seg_state.lock().unwrap();
                if let Some(s) = segs.iter_mut().find(|s| s.idx == seg_idx) {
                    s.done = true;
                }
                let _ = done_tx.send(seg_idx);
                return;
            }
        };

        let mut stream = resp.bytes_stream();
        let mut offset = start_from;

        loop {
            tokio::select! {
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            let len = bytes.len() as u64;
                            // seek_write at exact offset
                            if file.seek_write(&bytes, offset).is_err() {
                                break;
                            }
                            offset += len;

                            // update shared segment state
                            let current_end = {
                                let mut segs = seg_state.lock().unwrap();
                                if let Some(s) = segs.iter_mut().find(|s| s.idx == seg_idx) {
                                    s.downloaded += len;
                                    s.end
                                } else {
                                    break;
                                }
                            };

                            // check if this segment's range was shrunk by try_split
                            if offset > current_end + 1 {
                                break;
                            }
                        }
                        Some(Err(_)) => break,
                        None => break,
                    }
                }
                _ = cancel_rx.changed() => {
                    return; // cancelled, don't send done
                }
            }
        }

        // mark segment done
        {
            let mut segs = seg_state.lock().unwrap();
            if let Some(s) = segs.iter_mut().find(|s| s.idx == seg_idx) {
                s.done = true;
            }
        }
        let _ = done_tx.send(seg_idx);
    });
}

// dynamic segment splitting: find biggest non-done segment, split at midpoint
fn try_split(seg_state: &Arc<Mutex<Vec<Segment>>>) -> Option<(u32, u64, u64)> {
    let mut segs = seg_state.lock().unwrap();

    // find non-done segment with most remaining bytes
    let mut best_idx: Option<usize> = None;
    let mut best_remaining: u64 = 0;
    for (i, s) in segs.iter().enumerate() {
        if s.done { continue; }
        let remaining = (s.end - s.start + 1).saturating_sub(s.downloaded);
        if remaining > best_remaining {
            best_remaining = remaining;
            best_idx = Some(i);
        }
    }

    let idx = best_idx?;
    // not worth splitting if less than 1MB remaining
    if best_remaining < 1024 * 1024 {
        return None;
    }

    let new_idx = segs.len() as u32;
    let seg = &segs[idx];
    let current_pos = seg.start + seg.downloaded;
    let midpoint = current_pos + (seg.end - current_pos) / 2;

    let new_end = seg.end;
    // shrink existing segment
    let segs_idx = idx;
    segs[segs_idx].end = midpoint;

    // push new segment
    segs.push(Segment {
        idx: new_idx,
        start: midpoint + 1,
        end: new_end,
        downloaded: 0,
        done: false,
    });

    Some((new_idx, midpoint + 1, new_end))
}

fn fail(app: &AppHandle, id: &str, error: &str) {
    let dm = app.state::<DownloadManager>();
    let mut downloads = dm.downloads.lock().unwrap();
    if let Some(item) = downloads.get_mut(id) {
        item.state = DlState::Failed;
        item.error = Some(error.to_string());
        item.speed = 0;
        let _ = app.emit_to("main", "download-failed", item.clone());
    }
}
