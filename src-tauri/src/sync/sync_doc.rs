use loro::{ExportMode, LoroDoc, LoroMap, TreeID};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::path::PathBuf;

const COMPACT_THRESHOLD: u32 = 500;
const TREE_BOOKMARKS: &str = "bookmarks";
const MAP_HISTORY: &str = "history";
const MAP_SETTINGS: &str = "settings";
const MAP_TABS: &str = "open_tabs";

// device-local settings (never synced)
const DEVICE_LOCAL: &[&str] = &[
    "compactMode", "suspendTimeout", "downloadLocation",
    "askDownloadLocation", "onStartup", "syncDeviceName",
    "syncEnabled", "onboardingComplete",
];

// dangerous uri schemes (blocked on receive)
const BLOCKED_SCHEMES: &[&str] = &[
    "ms-msdt:", "search-ms:", "ms-officecmd:", "ms-word:",
    "ms-excel:", "ms-powerpoint:", "ms-cxh:", "ms-cxh-full:",
    "file:", "javascript:", "data:", "vbscript:",
];

// ── serde structs (same as loro_doc.rs) ──

#[derive(Debug, Serialize, Deserialize)]
struct BookmarkData {
    bookmarks: Vec<Bookmark>,
    folders: Vec<BookmarkFolder>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Bookmark {
    id: String,
    url: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    favicon: Option<String>,
    #[serde(rename = "folderId")]
    folder_id: String,
    #[serde(rename = "createdAt")]
    created_at: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct BookmarkFolder {
    id: String,
    name: String,
    #[serde(rename = "parentId")]
    parent_id: String,
    order: f64,
}

// ── main struct ──

pub struct SyncDoc {
    pub(crate) doc: LoroDoc,
    save_path: PathBuf,
    op_count: u32,
    device_id: String,
}

impl SyncDoc {
    // ── lifecycle ──

    pub fn init(app_data_dir: &PathBuf, peer_id: u64, device_id: &str) -> Result<Self, String> {
        let sync_dir = app_data_dir.join("sync");
        std::fs::create_dir_all(&sync_dir).map_err(|e| format!("create sync dir: {}", e))?;

        let save_path = sync_dir.join("sync.loro");
        let doc = LoroDoc::new();
        doc.set_peer_id(peer_id).map_err(|e| format!("set peer: {}", e))?;

        if save_path.exists() {
            // load existing
            let bytes = std::fs::read(&save_path).map_err(|e| format!("read sync.loro: {}", e))?;
            doc.import(&bytes).map_err(|e| format!("import sync.loro: {}", e))?;
        } else {
            // migrate from bookmarks.loro if it exists
            let old_path = sync_dir.join("bookmarks.loro");
            if old_path.exists() {
                eprintln!("[sync_doc] migrating from bookmarks.loro");
                let bytes = std::fs::read(&old_path).map_err(|e| format!("read bookmarks.loro: {}", e))?;
                doc.import(&bytes).map_err(|e| format!("import bookmarks.loro: {}", e))?;
                // rename old file
                let migrated = sync_dir.join("bookmarks.loro.migrated");
                let _ = std::fs::rename(&old_path, &migrated);
            }
        }

        // enable fractional index for ordered tree children
        doc.get_tree(TREE_BOOKMARKS).enable_fractional_index(0);

        Ok(SyncDoc {
            doc,
            save_path,
            op_count: 0,
            device_id: device_id.to_string(),
        })
    }

    // ── version control ──

    pub fn version_vector(&self) -> Vec<u8> {
        self.doc.oplog_vv().encode()
    }

    pub fn export_delta(&self, from_vv: &[u8]) -> Result<Vec<u8>, String> {
        let vv = loro::VersionVector::decode(from_vv)
            .map_err(|e| format!("decode vv: {}", e))?;
        self.doc
            .export(ExportMode::Updates { from: Cow::Owned(vv) })
            .map_err(|e| format!("export delta: {}", e))
    }

    pub fn export_snapshot(&self) -> Result<Vec<u8>, String> {
        self.doc
            .export(ExportMode::Snapshot)
            .map_err(|e| format!("export snapshot: {}", e))
    }

    pub fn export_all_updates(&self) -> Result<Vec<u8>, String> {
        self.doc
            .export(ExportMode::Updates {
                from: Cow::Owned(loro::VersionVector::default()),
            })
            .map_err(|e| format!("export all updates: {}", e))
    }

    pub fn import_remote(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.doc.import(bytes).map_err(|e| format!("import: {}", e))?;
        Ok(())
    }

    pub fn save(&self) -> Result<(), String> {
        let bytes = self.export_snapshot()?;
        let tmp = self.save_path.with_extension("loro.tmp");
        std::fs::write(&tmp, &bytes).map_err(|e| format!("write tmp: {}", e))?;
        std::fs::rename(&tmp, &self.save_path).map_err(|e| format!("rename: {}", e))?;
        Ok(())
    }

    pub fn backup(&self) {
        if self.save_path.exists() {
            let bak = self.save_path.with_extension("loro.bak");
            let _ = std::fs::copy(&self.save_path, &bak);
        }
    }

    // ── internal helpers ──

    fn find_node_by_id(&self, target_id: &str) -> Option<TreeID> {
        let tree = self.doc.get_tree(TREE_BOOKMARKS);
        for node_id in tree.children(None).unwrap_or_default() {
            if let Ok(meta) = tree.get_meta(node_id) {
                if get_map_str(&meta, "id").as_deref() == Some(target_id) {
                    return Some(node_id);
                }
            }
        }
        None
    }

    fn maybe_compact(&mut self) -> Result<(), String> {
        self.op_count += 1;
        if self.op_count < COMPACT_THRESHOLD {
            return Ok(());
        }
        let snapshot = self.export_snapshot()?;
        let peer = self.doc.peer_id();
        let new_doc = LoroDoc::new();
        new_doc.set_peer_id(peer).map_err(|e| format!("set peer: {}", e))?;
        new_doc.import(&snapshot).map_err(|e| format!("compact: {}", e))?;
        new_doc.get_tree(TREE_BOOKMARKS).enable_fractional_index(0);
        self.doc = new_doc;
        self.op_count = 0;
        Ok(())
    }

    // ── bookmarks (migrated from BookmarkDoc) ──

    pub fn write_full_from_json(&mut self, json: &str) -> Result<(), String> {
        let data: BookmarkData =
            serde_json::from_str(json).map_err(|e| format!("parse: {}", e))?;
        self.write_full(&data)
    }

    fn write_full(&mut self, data: &BookmarkData) -> Result<(), String> {
        let tree = self.doc.get_tree(TREE_BOOKMARKS);

        // delete existing nodes
        for node_id in tree.children(None).unwrap_or_default() {
            let _ = tree.delete(node_id);
        }

        // write folders
        for folder in &data.folders {
            let node = tree.create(None).map_err(|e| format!("create folder: {}", e))?;
            let meta = tree.get_meta(node).map_err(|e| format!("get meta: {}", e))?;
            set_map_str(&meta, "type", "folder");
            set_map_str(&meta, "id", &folder.id);
            set_map_str(&meta, "name", &folder.name);
            set_map_str(&meta, "parentId", &folder.parent_id);
            set_map_f64(&meta, "order", folder.order);
        }

        // write bookmarks
        for bm in &data.bookmarks {
            let node = tree.create(None).map_err(|e| format!("create bookmark: {}", e))?;
            let meta = tree.get_meta(node).map_err(|e| format!("get meta: {}", e))?;
            set_map_str(&meta, "type", "bookmark");
            set_map_str(&meta, "id", &bm.id);
            set_map_str(&meta, "url", &bm.url);
            set_map_str(&meta, "title", &bm.title);
            if let Some(ref fav) = bm.favicon {
                set_map_str(&meta, "favicon", fav);
            }
            set_map_str(&meta, "folderId", &bm.folder_id);
            set_map_f64(&meta, "createdAt", bm.created_at);
        }

        Ok(())
    }

    pub fn read_bookmarks_as_json(&self) -> Result<String, String> {
        let tree = self.doc.get_tree(TREE_BOOKMARKS);
        let mut bookmarks = Vec::new();
        let mut folders = Vec::new();

        for node_id in tree.children(None).unwrap_or_default() {
            let meta = tree.get_meta(node_id).map_err(|e| format!("read meta: {}", e))?;
            let node_type = get_map_str(&meta, "type").unwrap_or_default();

            if node_type == "folder" {
                folders.push(BookmarkFolder {
                    id: get_map_str(&meta, "id").unwrap_or_default(),
                    name: get_map_str(&meta, "name").unwrap_or_default(),
                    parent_id: get_map_str(&meta, "parentId").unwrap_or_default(),
                    order: get_map_f64(&meta, "order").unwrap_or(0.0),
                });
            } else if node_type == "bookmark" {
                bookmarks.push(Bookmark {
                    id: get_map_str(&meta, "id").unwrap_or_default(),
                    url: get_map_str(&meta, "url").unwrap_or_default(),
                    title: get_map_str(&meta, "title").unwrap_or_default(),
                    favicon: get_map_str(&meta, "favicon"),
                    folder_id: get_map_str(&meta, "folderId").unwrap_or_default(),
                    created_at: get_map_f64(&meta, "createdAt").unwrap_or(0.0),
                });
            }
        }

        let data = BookmarkData { bookmarks, folders };
        serde_json::to_string(&data).map_err(|e| format!("serialize: {}", e))
    }

    // surgical bookmark ops

    pub fn add_bookmark(
        &mut self, id: &str, url: &str, title: &str,
        favicon: Option<&str>, folder_id: &str, created_at: f64,
    ) -> Result<(), String> {
        let tree = self.doc.get_tree(TREE_BOOKMARKS);
        let node = tree.create(None).map_err(|e| format!("create: {}", e))?;
        let meta = tree.get_meta(node).map_err(|e| format!("meta: {}", e))?;
        set_map_str(&meta, "type", "bookmark");
        set_map_str(&meta, "id", id);
        set_map_str(&meta, "url", url);
        set_map_str(&meta, "title", title);
        if let Some(fav) = favicon {
            set_map_str(&meta, "favicon", fav);
        }
        set_map_str(&meta, "folderId", folder_id);
        set_map_f64(&meta, "createdAt", created_at);
        self.maybe_compact()
    }

    pub fn remove_bookmark(&mut self, id: &str) -> Result<(), String> {
        let node = self.find_node_by_id(id).ok_or("bookmark not found")?;
        let tree = self.doc.get_tree(TREE_BOOKMARKS);
        tree.delete(node).map_err(|e| format!("delete: {}", e))?;
        self.maybe_compact()
    }

    pub fn add_folder(
        &mut self, id: &str, name: &str, parent_id: &str, order: f64,
    ) -> Result<(), String> {
        let tree = self.doc.get_tree(TREE_BOOKMARKS);
        let node = tree.create(None).map_err(|e| format!("create: {}", e))?;
        let meta = tree.get_meta(node).map_err(|e| format!("meta: {}", e))?;
        set_map_str(&meta, "type", "folder");
        set_map_str(&meta, "id", id);
        set_map_str(&meta, "name", name);
        set_map_str(&meta, "parentId", parent_id);
        set_map_f64(&meta, "order", order);
        self.maybe_compact()
    }

    pub fn rename_folder(&mut self, id: &str, name: &str) -> Result<(), String> {
        let node = self.find_node_by_id(id).ok_or("folder not found")?;
        let tree = self.doc.get_tree(TREE_BOOKMARKS);
        let meta = tree.get_meta(node).map_err(|e| format!("meta: {}", e))?;
        set_map_str(&meta, "name", name);
        self.maybe_compact()
    }

    pub fn move_bookmark(&mut self, id: &str, folder_id: &str) -> Result<(), String> {
        let node = self.find_node_by_id(id).ok_or("bookmark not found")?;
        let tree = self.doc.get_tree(TREE_BOOKMARKS);
        let meta = tree.get_meta(node).map_err(|e| format!("meta: {}", e))?;
        set_map_str(&meta, "folderId", folder_id);
        self.maybe_compact()
    }

    pub fn delete_folder_cascade(&mut self, folder_id: &str) -> Result<(), String> {
        let tree = self.doc.get_tree(TREE_BOOKMARKS);
        // move bookmarks out of folder
        for node_id in tree.children(None).unwrap_or_default() {
            if let Ok(meta) = tree.get_meta(node_id) {
                if get_map_str(&meta, "type").as_deref() == Some("bookmark")
                    && get_map_str(&meta, "folderId").as_deref() == Some(folder_id)
                {
                    set_map_str(&meta, "folderId", "");
                }
            }
        }
        // delete folder node
        if let Some(node) = self.find_node_by_id(folder_id) {
            tree.delete(node).map_err(|e| format!("delete: {}", e))?;
        }
        self.maybe_compact()
    }

    // ── history ──

    pub fn add_history(&mut self, url: &str, title: &str, favicon: Option<&str>, timestamp: i64) -> Result<(), String> {
        if !is_safe_url(url) { return Ok(()); } // skip dangerous urls
        let safe_title = sanitize_title(title);
        let map = self.doc.get_map(MAP_HISTORY);
        let key = format!("{}|{}", url, timestamp);
        let val = serde_json::json!({
            "url": url,
            "title": safe_title,
            "favicon": favicon,
            "ts": timestamp
        });
        let _ = map.insert(&key, val.to_string());
        self.maybe_compact()
    }

    pub fn read_history_json(&self) -> Result<String, String> {
        let map = self.doc.get_map(MAP_HISTORY);
        let mut entries = Vec::new();

        // iterate all keys in the map
        map.for_each(|key, value| {
            if let loro::ValueOrContainer::Value(loro::LoroValue::String(s)) = value {
                if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&s) {
                    // ensure key is parseable
                    if let Some((_url, _ts)) = key.split_once('|') {
                        entries.push(v.take());
                    }
                }
            }
        });

        serde_json::to_string(&entries).map_err(|e| format!("serialize: {}", e))
    }

    // prune entries older than cutoff_days, enforce max_entries limit
    pub fn compact_history(&mut self, cutoff_days: u64, max_entries: usize) -> Result<usize, String> {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let cutoff_ms = now_ms - (cutoff_days as i64 * 86_400_000);

        let map = self.doc.get_map(MAP_HISTORY);
        let mut to_delete = Vec::new();
        let mut all_keys: Vec<(String, i64)> = Vec::new();

        map.for_each(|key, _value| {
            if let Some((_url, ts_str)) = key.split_once('|') {
                if let Ok(ts) = ts_str.parse::<i64>() {
                    if ts < cutoff_ms {
                        to_delete.push(key.to_string());
                    } else {
                        all_keys.push((key.to_string(), ts));
                    }
                }
            }
        });

        // delete old entries
        for key in &to_delete {
            let _ = map.delete(key);
        }

        // enforce max limit — delete oldest if over
        if all_keys.len() > max_entries {
            all_keys.sort_by_key(|(_, ts)| *ts);
            let excess = all_keys.len() - max_entries;
            for (key, _) in all_keys.iter().take(excess) {
                let _ = map.delete(key);
                to_delete.push(key.clone());
            }
        }

        let count = to_delete.len();
        if count > 0 {
            self.maybe_compact()?;
        }
        Ok(count)
    }

    // ── settings ──

    pub fn write_setting(&mut self, key: &str, value: &str) -> Result<(), String> {
        // skip device-local settings
        if DEVICE_LOCAL.contains(&key) { return Ok(()); }
        // validate json
        if !validate_setting(value) { return Err("invalid setting value".into()); }
        let map = self.doc.get_map(MAP_SETTINGS);
        let _ = map.insert(key, value);
        self.maybe_compact()
    }

    pub fn read_settings_json(&self) -> Result<String, String> {
        let map = self.doc.get_map(MAP_SETTINGS);
        let mut obj = serde_json::Map::new();

        map.for_each(|key, value| {
            if let loro::ValueOrContainer::Value(loro::LoroValue::String(s)) = value {
                // parse the stored json value
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                    obj.insert(key.to_string(), v);
                }
            }
        });

        serde_json::to_string(&serde_json::Value::Object(obj))
            .map_err(|e| format!("serialize: {}", e))
    }

    // ── open tabs ──

    pub fn write_tabs(&mut self, tabs_json: &str) -> Result<(), String> {
        let map = self.doc.get_map(MAP_TABS);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let val = serde_json::json!({ "tabs": tabs_json, "ts": now });
        let _ = map.insert(&self.device_id, val.to_string());
        Ok(()) // no compact — tabs overwrite, don't accumulate ops
    }

    pub fn read_all_tabs(&self) -> Result<String, String> {
        let map = self.doc.get_map(MAP_TABS);
        let mut devices = Vec::new();

        map.for_each(|key, value| {
            if let loro::ValueOrContainer::Value(loro::LoroValue::String(s)) = value {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                    let mut entry = serde_json::json!({ "device_id": key });
                    if let Some(tabs) = v.get("tabs") {
                        entry["tabs"] = tabs.clone();
                    }
                    if let Some(ts) = v.get("ts") {
                        entry["timestamp"] = ts.clone();
                    }
                    devices.push(entry);
                }
            }
        });

        serde_json::to_string(&devices).map_err(|e| format!("serialize: {}", e))
    }

    // remove tabs from devices not seen in stale_days
    pub fn clean_stale_tabs(&mut self, stale_days: u64) -> Result<usize, String> {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let cutoff = now_ms - (stale_days as i64 * 86_400_000);

        let map = self.doc.get_map(MAP_TABS);
        let mut to_delete = Vec::new();

        map.for_each(|key, value| {
            if let loro::ValueOrContainer::Value(loro::LoroValue::String(s)) = value {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                    if let Some(ts) = v.get("ts").and_then(|t| t.as_i64()) {
                        if ts < cutoff {
                            to_delete.push(key.to_string());
                        }
                    }
                }
            }
        });

        let count = to_delete.len();
        for key in &to_delete {
            let _ = map.delete(key);
        }
        Ok(count)
    }

    // ── migration helper ──

    pub fn maybe_migrate_json(
        &mut self,
        app_data_dir: &PathBuf,
    ) -> Result<bool, String> {
        let json_path = app_data_dir.join("bookmarks.json");
        if !json_path.exists() {
            return Ok(false);
        }

        // only migrate if tree is empty
        let tree = self.doc.get_tree(TREE_BOOKMARKS);
        if !tree.is_empty() {
            return Ok(false);
        }

        let json = std::fs::read_to_string(&json_path)
            .map_err(|e| format!("read bookmarks.json: {}", e))?;
        let data: BookmarkData = serde_json::from_str(&json)
            .map_err(|e| format!("parse bookmarks.json: {}", e))?;

        self.write_full(&data)?;
        self.save()?;

        // backup old file
        let bak = app_data_dir.join("bookmarks.json.bak");
        let _ = std::fs::rename(&json_path, &bak);

        Ok(true)
    }
}

// ── sanitization helpers (security) ──

fn sanitize_title(raw: &str) -> String {
    // strip html tags — match existing pattern from lib.rs title sanitization
    raw.replace('<', "&lt;").replace('>', "&gt;")
}

fn is_safe_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    !BLOCKED_SCHEMES.iter().any(|s| lower.starts_with(s))
}

// public wrapper for url validation from other modules
pub fn is_safe_url_pub(url: &str) -> bool {
    is_safe_url(url)
}

fn validate_setting(value: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(value).is_ok()
}

// ── loro map helpers ──

fn set_map_str(meta: &LoroMap, key: &str, val: &str) {
    let _ = meta.insert(key, val);
}

fn set_map_f64(meta: &LoroMap, key: &str, val: f64) {
    let _ = meta.insert(key, val);
}

fn get_map_str(meta: &LoroMap, key: &str) -> Option<String> {
    meta.get(key).and_then(|v| match v {
        loro::ValueOrContainer::Value(loro::LoroValue::String(s)) => Some(s.to_string()),
        _ => None,
    })
}

fn get_map_f64(meta: &LoroMap, key: &str) -> Option<f64> {
    meta.get(key).and_then(|v| match v {
        loro::ValueOrContainer::Value(loro::LoroValue::Double(d)) => Some(d),
        loro::ValueOrContainer::Value(loro::LoroValue::I64(i)) => Some(i as f64),
        _ => None,
    })
}

// public wrapper for debug access
pub fn get_map_str_pub(meta: &LoroMap, key: &str) -> Option<String> {
    get_map_str(meta, key)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::atomic::{AtomicU64, Ordering};
    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> PathBuf {
        let n = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let mut p = std::env::temp_dir();
        p.push(format!("bushido_syncdoc_{}_{}", std::process::id(), n));
        let _ = std::fs::remove_dir_all(&p);
        let _ = std::fs::create_dir_all(&p);
        p
    }

    fn cleanup(dir: &PathBuf) {
        let _ = std::fs::remove_dir_all(dir);
    }

    fn sample_json() -> &'static str {
        r#"{"bookmarks":[
            {"id":"b1","url":"https://rust-lang.org","title":"Rust","favicon":"https://rust-lang.org/fav.ico","folderId":"f1","createdAt":1700000000},
            {"id":"b2","url":"https://tauri.app","title":"Tauri","folderId":"root","createdAt":1700000001}
        ],"folders":[
            {"id":"f1","name":"Dev","parentId":"root","order":0},
            {"id":"f2","name":"News","parentId":"root","order":1}
        ]}"#
    }

    #[test]
    fn empty_doc() {
        let dir = temp_dir();
        let doc = SyncDoc::init(&dir, 1, "dev1").unwrap();
        let json = doc.read_bookmarks_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["bookmarks"].as_array().unwrap().len(), 0);
        assert_eq!(v["folders"].as_array().unwrap().len(), 0);
        cleanup(&dir);
    }

    #[test]
    fn bookmark_roundtrip() {
        let dir = temp_dir();
        let mut doc = SyncDoc::init(&dir, 1, "dev1").unwrap();
        doc.write_full_from_json(sample_json()).unwrap();

        let json = doc.read_bookmarks_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["bookmarks"].as_array().unwrap().len(), 2);
        assert_eq!(v["folders"].as_array().unwrap().len(), 2);
        cleanup(&dir);
    }

    #[test]
    fn surgical_bookmark_ops() {
        let dir = temp_dir();
        let mut doc = SyncDoc::init(&dir, 1, "dev1").unwrap();
        doc.add_bookmark("b1", "https://a.com", "A", None, "root", 1.0).unwrap();
        doc.add_bookmark("b2", "https://b.com", "B", Some("fav.ico"), "f1", 2.0).unwrap();

        let json = doc.read_bookmarks_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["bookmarks"].as_array().unwrap().len(), 2);

        doc.remove_bookmark("b1").unwrap();
        let json = doc.read_bookmarks_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["bookmarks"].as_array().unwrap().len(), 1);
        cleanup(&dir);
    }

    #[test]
    fn history_add_and_read() {
        let dir = temp_dir();
        let mut doc = SyncDoc::init(&dir, 1, "dev1").unwrap();
        doc.add_history("https://rust-lang.org", "Rust", None, 1700000000000).unwrap();
        doc.add_history("https://tauri.app", "Tauri", Some("fav.ico"), 1700000001000).unwrap();

        let json = doc.read_history_json().unwrap();
        let entries: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert_eq!(entries.len(), 2);
        cleanup(&dir);
    }

    #[test]
    fn history_blocks_dangerous_urls() {
        let dir = temp_dir();
        let mut doc = SyncDoc::init(&dir, 1, "dev1").unwrap();
        doc.add_history("javascript:alert(1)", "XSS", None, 1700000000000).unwrap();
        doc.add_history("file:///etc/passwd", "Hack", None, 1700000001000).unwrap();
        doc.add_history("https://safe.com", "Safe", None, 1700000002000).unwrap();

        let json = doc.read_history_json().unwrap();
        let entries: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert_eq!(entries.len(), 1); // only the safe one
        assert_eq!(entries[0]["url"], "https://safe.com");
        cleanup(&dir);
    }

    #[test]
    fn history_sanitizes_titles() {
        let dir = temp_dir();
        let mut doc = SyncDoc::init(&dir, 1, "dev1").unwrap();
        doc.add_history("https://a.com", "<script>alert(1)</script>", None, 1700000000000).unwrap();

        let json = doc.read_history_json().unwrap();
        let entries: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert!(!entries[0]["title"].as_str().unwrap().contains('<'));
        cleanup(&dir);
    }

    #[test]
    fn history_compaction() {
        let dir = temp_dir();
        let mut doc = SyncDoc::init(&dir, 1, "dev1").unwrap();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        // add old entry (100 days ago)
        doc.add_history("https://old.com", "Old", None, now - 100 * 86_400_000).unwrap();
        // add recent entry
        doc.add_history("https://new.com", "New", None, now).unwrap();

        let pruned = doc.compact_history(90, 50000).unwrap();
        assert_eq!(pruned, 1);

        let json = doc.read_history_json().unwrap();
        let entries: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["url"], "https://new.com");
        cleanup(&dir);
    }

    #[test]
    fn settings_write_and_read() {
        let dir = temp_dir();
        let mut doc = SyncDoc::init(&dir, 1, "dev1").unwrap();
        doc.write_setting("accentColor", "\"#6366f1\"").unwrap();
        doc.write_setting("themeMode", "\"dark\"").unwrap();
        // device-local should be skipped
        doc.write_setting("compactMode", "true").unwrap();

        let json = doc.read_settings_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["accentColor"], "#6366f1");
        assert_eq!(v["themeMode"], "dark");
        // compactMode should NOT be in synced settings
        assert!(v.get("compactMode").is_none());
        cleanup(&dir);
    }

    #[test]
    fn settings_rejects_invalid_json() {
        let dir = temp_dir();
        let mut doc = SyncDoc::init(&dir, 1, "dev1").unwrap();
        let result = doc.write_setting("accentColor", "not valid json");
        assert!(result.is_err());
        cleanup(&dir);
    }

    #[test]
    fn tabs_write_and_read() {
        let dir = temp_dir();
        let mut doc = SyncDoc::init(&dir, 1, "dev1").unwrap();
        let tabs = r#"[{"id":"t1","url":"https://a.com","title":"A"},{"id":"t2","url":"https://b.com","title":"B"}]"#;
        doc.write_tabs(tabs).unwrap();

        let json = doc.read_all_tabs().unwrap();
        let devices: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0]["device_id"], "dev1");
        cleanup(&dir);
    }

    #[test]
    fn stale_tabs_cleanup() {
        let dir = temp_dir();
        let mut doc = SyncDoc::init(&dir, 1, "dev1").unwrap();

        // write tabs for this device (fresh)
        doc.write_tabs(r#"[{"id":"t1","url":"https://a.com","title":"A"}]"#).unwrap();

        // manually inject a stale device entry
        let map = doc.doc.get_map(MAP_TABS);
        let old_ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64 - 10 * 86_400_000; // 10 days ago
        let val = serde_json::json!({ "tabs": "[]", "ts": old_ts });
        let _ = map.insert("stale_device", val.to_string());

        let cleaned = doc.clean_stale_tabs(7).unwrap();
        assert_eq!(cleaned, 1);

        let json = doc.read_all_tabs().unwrap();
        let devices: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert_eq!(devices.len(), 1); // only dev1 remains
        cleanup(&dir);
    }

    #[test]
    fn sync_between_docs() {
        let dir1 = temp_dir();
        let dir2 = temp_dir();

        let mut doc_a = SyncDoc::init(&dir1, 1, "devA").unwrap();
        let mut doc_b = SyncDoc::init(&dir2, 2, "devB").unwrap();

        // A adds bookmarks and history
        doc_a.add_bookmark("b1", "https://a.com", "A", None, "", 1.0).unwrap();
        doc_a.add_history("https://a.com", "A", None, 1700000000000).unwrap();
        doc_a.write_setting("themeMode", "\"dark\"").unwrap();

        // B adds different data
        doc_b.add_bookmark("b2", "https://b.com", "B", None, "", 2.0).unwrap();
        doc_b.add_history("https://b.com", "B", None, 1700000001000).unwrap();

        // exchange updates
        let updates_a = doc_a.export_all_updates().unwrap();
        let updates_b = doc_b.export_all_updates().unwrap();
        doc_a.import_remote(&updates_b).unwrap();
        doc_b.import_remote(&updates_a).unwrap();

        // both should have merged data
        let bm_a = doc_a.read_bookmarks_as_json().unwrap();
        let va: serde_json::Value = serde_json::from_str(&bm_a).unwrap();
        assert!(va["bookmarks"].as_array().unwrap().len() >= 2);

        let hist_b = doc_b.read_history_json().unwrap();
        let hb: Vec<serde_json::Value> = serde_json::from_str(&hist_b).unwrap();
        assert!(hb.len() >= 2);

        // settings should sync too
        let settings_b = doc_b.read_settings_json().unwrap();
        let sb: serde_json::Value = serde_json::from_str(&settings_b).unwrap();
        assert_eq!(sb["themeMode"], "dark");

        cleanup(&dir1);
        cleanup(&dir2);
    }

    #[test]
    fn save_and_reload() {
        let dir = temp_dir();

        {
            let mut doc = SyncDoc::init(&dir, 1, "dev1").unwrap();
            doc.add_bookmark("b1", "https://a.com", "A", None, "", 1.0).unwrap();
            doc.add_history("https://a.com", "A", None, 1700000000000).unwrap();
            doc.write_setting("themeMode", "\"dark\"").unwrap();
            doc.write_tabs(r#"[{"id":"t1","url":"https://a.com","title":"A"}]"#).unwrap();
            doc.save().unwrap();
        }

        // reload
        let doc = SyncDoc::init(&dir, 1, "dev1").unwrap();
        let bm = doc.read_bookmarks_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&bm).unwrap();
        assert_eq!(v["bookmarks"].as_array().unwrap().len(), 1);

        let hist = doc.read_history_json().unwrap();
        let h: Vec<serde_json::Value> = serde_json::from_str(&hist).unwrap();
        assert_eq!(h.len(), 1);

        let settings = doc.read_settings_json().unwrap();
        let s: serde_json::Value = serde_json::from_str(&settings).unwrap();
        assert_eq!(s["themeMode"], "dark");

        cleanup(&dir);
    }
}
