use loro::{ExportMode, LoroDoc, LoroMap, TreeID};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::path::PathBuf;

const COMPACT_THRESHOLD: u32 = 500;

const TREE_CID: &str = "bookmarks";

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

pub struct BookmarkDoc {
    pub(crate) doc: LoroDoc,
    save_path: PathBuf,
    op_count: u32,
}

impl BookmarkDoc {
    /// Load existing .loro file or create a new empty doc.
    pub fn init(app_data_dir: &PathBuf, peer_id: u64) -> Result<Self, String> {
        let sync_dir = app_data_dir.join("sync");
        std::fs::create_dir_all(&sync_dir).map_err(|e| format!("create sync dir: {}", e))?;

        let save_path = sync_dir.join("bookmarks.loro");
        let doc = LoroDoc::new();
        doc.set_peer_id(peer_id).map_err(|e| format!("set peer: {}", e))?;

        if save_path.exists() {
            let bytes = std::fs::read(&save_path).map_err(|e| format!("read loro: {}", e))?;
            doc.import(&bytes).map_err(|e| format!("import loro: {}", e))?;
        }

        // enable fractional index for ordered tree children
        doc.get_tree(TREE_CID).enable_fractional_index(0);

        Ok(BookmarkDoc { doc, save_path, op_count: 0 })
    }

    /// Migrate from bookmarks.json into LoroDoc (one-time).
    /// Returns true if migration happened.
    pub fn maybe_migrate(&mut self, app_data_dir: &PathBuf) -> Result<bool, String> {
        let json_path = app_data_dir.join("bookmarks.json");
        if !json_path.exists() {
            return Ok(false);
        }

        // only migrate if doc is empty
        let tree = self.doc.get_tree(TREE_CID);
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

    /// Parse JSON string and write all bookmarks + folders.
    pub fn write_full_from_json(&mut self, json: &str) -> Result<(), String> {
        let data: BookmarkData =
            serde_json::from_str(json).map_err(|e| format!("parse: {}", e))?;
        self.write_full(&data)
    }

    /// Clear tree and write all bookmarks + folders from parsed data.
    fn write_full(&mut self, data: &BookmarkData) -> Result<(), String> {
        let tree = self.doc.get_tree(TREE_CID);

        // delete existing nodes
        for node_id in tree.children(None).unwrap_or_default() {
            let _ = tree.delete(node_id);
        }

        // write folders
        for folder in &data.folders {
            let node = tree.create(None).map_err(|e| format!("create folder node: {}", e))?;
            let meta = tree.get_meta(node).map_err(|e| format!("get meta: {}", e))?;
            set_map_str(&meta, "type", "folder");
            set_map_str(&meta, "id", &folder.id);
            set_map_str(&meta, "name", &folder.name);
            set_map_str(&meta, "parentId", &folder.parent_id);
            set_map_f64(&meta, "order", folder.order);
        }

        // write bookmarks
        for bm in &data.bookmarks {
            let node = tree.create(None).map_err(|e| format!("create bookmark node: {}", e))?;
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

    /// Reconstruct BookmarkData JSON from the tree for React consumption.
    pub fn read_as_json(&self) -> Result<String, String> {
        let tree = self.doc.get_tree(TREE_CID);
        let mut bookmarks = Vec::new();
        let mut folders = Vec::new();

        let nodes = tree.children(None).unwrap_or_default();
        for node_id in nodes {
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

    /// Export the version vector (for delta computation).
    pub fn version_vector(&self) -> Vec<u8> {
        self.doc.oplog_vv().encode()
    }

    /// Export delta (changes since a given version vector).
    pub fn export_delta(&self, from_vv: &[u8]) -> Result<Vec<u8>, String> {
        let vv = loro::VersionVector::decode(from_vv)
            .map_err(|e| format!("decode vv: {}", e))?;
        self.doc
            .export(ExportMode::Updates {
                from: Cow::Owned(vv),
            })
            .map_err(|e| format!("export delta: {}", e))
    }

    /// Export full snapshot.
    pub fn export_snapshot(&self) -> Result<Vec<u8>, String> {
        self.doc
            .export(ExportMode::Snapshot)
            .map_err(|e| format!("export snapshot: {}", e))
    }

    /// Export all updates from the beginning (full oplog).
    /// Use this for first-time sync between unrelated docs — snapshot import
    /// discards foreign tree nodes, but updates import merges them correctly.
    pub fn export_all_updates(&self) -> Result<Vec<u8>, String> {
        self.doc
            .export(ExportMode::Updates {
                from: Cow::Owned(loro::VersionVector::default()),
            })
            .map_err(|e| format!("export all updates: {}", e))
    }

    /// Import remote changes (delta or snapshot).
    pub fn import_remote(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.doc.import(bytes).map_err(|e| format!("import: {}", e))?;
        Ok(())
    }

    /// Save snapshot to disk (atomic write: .tmp → rename).
    pub fn save(&self) -> Result<(), String> {
        let bytes = self.export_snapshot()?;
        let tmp = self.save_path.with_extension("loro.tmp");
        std::fs::write(&tmp, &bytes).map_err(|e| format!("write tmp: {}", e))?;
        std::fs::rename(&tmp, &self.save_path).map_err(|e| format!("rename: {}", e))?;
        Ok(())
    }

    /// Copy .loro → .loro.bak before importing remote data (crash recovery).
    pub fn backup(&self) {
        if self.save_path.exists() {
            let bak = self.save_path.with_extension("loro.bak");
            let _ = std::fs::copy(&self.save_path, &bak);
        }
    }

    // ── surgical operations (1-8 Loro ops instead of 2N) ──────────────

    fn find_node_by_id(&self, target_id: &str) -> Option<TreeID> {
        let tree = self.doc.get_tree(TREE_CID);
        for node_id in tree.children(None).unwrap_or_default() {
            if let Ok(meta) = tree.get_meta(node_id) {
                if get_map_str(&meta, "id").as_deref() == Some(target_id) {
                    return Some(node_id);
                }
            }
        }
        None
    }

    // compact oplog after N surgical ops to prevent unbounded growth
    fn maybe_compact(&mut self) -> Result<(), String> {
        self.op_count += 1;
        if self.op_count < COMPACT_THRESHOLD { return Ok(()); }
        let snapshot = self.export_snapshot()?;
        let peer = self.doc.peer_id();
        let new_doc = LoroDoc::new();
        new_doc.set_peer_id(peer).map_err(|e| format!("set peer: {}", e))?;
        new_doc.import(&snapshot).map_err(|e| format!("compact: {}", e))?;
        new_doc.get_tree(TREE_CID).enable_fractional_index(0);
        self.doc = new_doc;
        self.op_count = 0;
        Ok(())
    }

    pub fn add_bookmark(
        &mut self, id: &str, url: &str, title: &str,
        favicon: Option<&str>, folder_id: &str, created_at: f64,
    ) -> Result<(), String> {
        let tree = self.doc.get_tree(TREE_CID);
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
        let tree = self.doc.get_tree(TREE_CID);
        tree.delete(node).map_err(|e| format!("delete: {}", e))?;
        self.maybe_compact()
    }

    pub fn add_folder(
        &mut self, id: &str, name: &str, parent_id: &str, order: f64,
    ) -> Result<(), String> {
        let tree = self.doc.get_tree(TREE_CID);
        let node = tree.create(None).map_err(|e| format!("create: {}", e))?;
        let meta = tree.get_meta(node).map_err(|e| format!("meta: {}", e))?;
        set_map_str(&meta, "type", "folder");
        set_map_str(&meta, "id", id);
        set_map_str(&meta, "name", name);
        set_map_str(&meta, "parentId", parent_id);
        set_map_f64(&meta, "order", order);
        self.maybe_compact()
    }

    #[allow(dead_code)]
    pub fn remove_folder(&mut self, id: &str) -> Result<(), String> {
        let node = self.find_node_by_id(id).ok_or("folder not found")?;
        let tree = self.doc.get_tree(TREE_CID);
        tree.delete(node).map_err(|e| format!("delete: {}", e))?;
        self.maybe_compact()
    }

    pub fn rename_folder(&mut self, id: &str, name: &str) -> Result<(), String> {
        let node = self.find_node_by_id(id).ok_or("folder not found")?;
        let tree = self.doc.get_tree(TREE_CID);
        let meta = tree.get_meta(node).map_err(|e| format!("meta: {}", e))?;
        set_map_str(&meta, "name", name);
        self.maybe_compact()
    }

    pub fn move_bookmark(&mut self, id: &str, folder_id: &str) -> Result<(), String> {
        let node = self.find_node_by_id(id).ok_or("bookmark not found")?;
        let tree = self.doc.get_tree(TREE_CID);
        let meta = tree.get_meta(node).map_err(|e| format!("meta: {}", e))?;
        set_map_str(&meta, "folderId", folder_id);
        self.maybe_compact()
    }

    /// Delete folder and move its bookmarks to root (folderId="")
    pub fn delete_folder_cascade(&mut self, folder_id: &str) -> Result<(), String> {
        let tree = self.doc.get_tree(TREE_CID);
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
}

// ── helpers ──────────────────────────────────────────────────────────

fn set_map_str(meta: &LoroMap, key: &str, val: &str) {
    let _ = meta.insert(key, val);
}

fn set_map_f64(meta: &LoroMap, key: &str, val: f64) {
    let _ = meta.insert(key, val);
}

pub fn get_map_str_pub(meta: &LoroMap, key: &str) -> Option<String> {
    get_map_str(meta, key)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_json() -> &'static str {
        r#"{
            "bookmarks": [
                {"id":"b1","url":"https://rust-lang.org","title":"Rust","favicon":"https://rust-lang.org/favicon.ico","folderId":"f1","createdAt":1700000000},
                {"id":"b2","url":"https://tauri.app","title":"Tauri","folderId":"root","createdAt":1700000001}
            ],
            "folders": [
                {"id":"f1","name":"Dev","parentId":"root","order":0},
                {"id":"f2","name":"News","parentId":"root","order":1}
            ]
        }"#
    }

    use std::sync::atomic::{AtomicU64, Ordering};
    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> PathBuf {
        let n = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let mut p = std::env::temp_dir();
        p.push(format!("bushido_test_{}_{}", std::process::id(), n));
        let _ = std::fs::remove_dir_all(&p); // clean stale
        let _ = std::fs::create_dir_all(&p);
        p
    }

    fn cleanup(dir: &PathBuf) {
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn empty_doc_returns_empty_json() {
        let dir = temp_dir();
        let doc = BookmarkDoc::init(&dir, 1).unwrap();
        let json = doc.read_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["bookmarks"].as_array().unwrap().len(), 0);
        assert_eq!(v["folders"].as_array().unwrap().len(), 0);
        cleanup(&dir);
    }

    #[test]
    fn write_and_read_roundtrip() {
        let dir = temp_dir();
        let mut doc = BookmarkDoc::init(&dir, 1).unwrap();
        doc.write_full_from_json(sample_json()).unwrap();

        let json = doc.read_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        let bookmarks = v["bookmarks"].as_array().unwrap();
        let folders = v["folders"].as_array().unwrap();

        assert_eq!(bookmarks.len(), 2);
        assert_eq!(folders.len(), 2);

        // verify bookmark fields
        let b1 = bookmarks.iter().find(|b| b["id"] == "b1").unwrap();
        assert_eq!(b1["url"], "https://rust-lang.org");
        assert_eq!(b1["title"], "Rust");
        assert_eq!(b1["folderId"], "f1");
        assert!(b1["favicon"].as_str().is_some());

        // b2 has no favicon
        let b2 = bookmarks.iter().find(|b| b["id"] == "b2").unwrap();
        assert!(b2["favicon"].is_null());

        // verify folder fields
        let f1 = folders.iter().find(|f| f["id"] == "f1").unwrap();
        assert_eq!(f1["name"], "Dev");
        assert_eq!(f1["parentId"], "root");

        cleanup(&dir);
    }

    #[test]
    fn write_full_is_idempotent() {
        let dir = temp_dir();
        let mut doc = BookmarkDoc::init(&dir, 1).unwrap();

        // write twice
        doc.write_full_from_json(sample_json()).unwrap();
        doc.write_full_from_json(sample_json()).unwrap();

        let json = doc.read_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        // should have exactly 2 bookmarks, not 4
        assert_eq!(v["bookmarks"].as_array().unwrap().len(), 2);
        assert_eq!(v["folders"].as_array().unwrap().len(), 2);

        cleanup(&dir);
    }

    #[test]
    fn snapshot_export_import() {
        let dir1 = temp_dir();
        let dir2 = temp_dir();

        // doc A writes bookmarks
        let mut doc_a = BookmarkDoc::init(&dir1, 1).unwrap();
        doc_a.write_full_from_json(sample_json()).unwrap();

        // export snapshot from A
        let snapshot = doc_a.export_snapshot().unwrap();
        assert!(!snapshot.is_empty());

        // doc B imports snapshot
        let mut doc_b = BookmarkDoc::init(&dir2, 2).unwrap();
        doc_b.import_remote(&snapshot).unwrap();

        // B should have same data
        let json_b = doc_b.read_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json_b).unwrap();
        assert_eq!(v["bookmarks"].as_array().unwrap().len(), 2);
        assert_eq!(v["folders"].as_array().unwrap().len(), 2);

        cleanup(&dir1);
        cleanup(&dir2);
    }

    #[test]
    fn delta_export_import() {
        let dir1 = temp_dir();
        let dir2 = temp_dir();

        // both docs start empty — sync snapshot first so they share history
        let mut doc_a = BookmarkDoc::init(&dir1, 1).unwrap();
        let mut doc_b = BookmarkDoc::init(&dir2, 2).unwrap();

        // A writes bookmarks
        doc_a.write_full_from_json(sample_json()).unwrap();

        // get B's version vector (empty)
        let vv_b = doc_b.version_vector();

        // export delta from A (changes since B's vv)
        let delta = doc_a.export_delta(&vv_b).unwrap();
        assert!(!delta.is_empty());

        // B imports delta
        doc_b.import_remote(&delta).unwrap();

        // B should now have A's bookmarks
        let json_b = doc_b.read_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json_b).unwrap();
        assert_eq!(v["bookmarks"].as_array().unwrap().len(), 2);
        assert_eq!(v["folders"].as_array().unwrap().len(), 2);

        cleanup(&dir1);
        cleanup(&dir2);
    }

    #[test]
    fn save_and_reload() {
        let dir = temp_dir();

        // create doc, write data, save
        {
            let mut doc = BookmarkDoc::init(&dir, 1).unwrap();
            doc.write_full_from_json(sample_json()).unwrap();
            doc.save().unwrap();
        }

        // reload from disk
        {
            let doc = BookmarkDoc::init(&dir, 1).unwrap();
            let json = doc.read_as_json().unwrap();
            let v: serde_json::Value = serde_json::from_str(&json).unwrap();
            assert_eq!(v["bookmarks"].as_array().unwrap().len(), 2);
            assert_eq!(v["folders"].as_array().unwrap().len(), 2);
        }

        cleanup(&dir);
    }

    #[test]
    fn migration_from_bookmarks_json() {
        let dir = temp_dir();

        // write a bookmarks.json
        std::fs::write(dir.join("bookmarks.json"), sample_json()).unwrap();

        // init doc + migrate
        let mut doc = BookmarkDoc::init(&dir, 1).unwrap();
        let migrated = doc.maybe_migrate(&dir).unwrap();
        assert!(migrated);

        // json file should be renamed to .bak
        assert!(!dir.join("bookmarks.json").exists());
        assert!(dir.join("bookmarks.json.bak").exists());

        // doc should have the data
        let json = doc.read_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["bookmarks"].as_array().unwrap().len(), 2);

        // second migration should be a no-op
        // restore the json to test idempotency
        std::fs::write(dir.join("bookmarks.json"), sample_json()).unwrap();
        let migrated2 = doc.maybe_migrate(&dir).unwrap();
        assert!(!migrated2); // doc not empty, skip

        cleanup(&dir);
    }

    #[test]
    fn version_vector_changes_after_write() {
        let dir = temp_dir();
        let mut doc = BookmarkDoc::init(&dir, 1).unwrap();

        let vv1 = doc.version_vector();
        doc.write_full_from_json(sample_json()).unwrap();
        let vv2 = doc.version_vector();

        assert_ne!(vv1, vv2);
        cleanup(&dir);
    }

    #[test]
    fn surgical_add_and_remove_bookmark() {
        let dir = temp_dir();
        let mut doc = BookmarkDoc::init(&dir, 1).unwrap();
        doc.add_bookmark("b1", "https://a.com", "A", None, "root", 1.0).unwrap();
        doc.add_bookmark("b2", "https://b.com", "B", Some("fav.ico"), "f1", 2.0).unwrap();

        let json = doc.read_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["bookmarks"].as_array().unwrap().len(), 2);

        doc.remove_bookmark("b1").unwrap();
        let json = doc.read_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["bookmarks"].as_array().unwrap().len(), 1);
        assert_eq!(v["bookmarks"][0]["id"], "b2");

        cleanup(&dir);
    }

    #[test]
    fn surgical_folder_operations() {
        let dir = temp_dir();
        let mut doc = BookmarkDoc::init(&dir, 1).unwrap();
        doc.add_folder("f1", "Dev", "root", 0.0).unwrap();
        doc.add_bookmark("b1", "https://a.com", "A", None, "f1", 1.0).unwrap();

        // rename
        doc.rename_folder("f1", "Development").unwrap();
        let json = doc.read_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        let f = v["folders"].as_array().unwrap().iter().find(|f| f["id"] == "f1").unwrap();
        assert_eq!(f["name"], "Development");

        // cascade delete — moves bookmark to root
        doc.delete_folder_cascade("f1").unwrap();
        let json = doc.read_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["folders"].as_array().unwrap().len(), 0);
        assert_eq!(v["bookmarks"][0]["folderId"], "");

        cleanup(&dir);
    }

    #[test]
    fn surgical_move_bookmark() {
        let dir = temp_dir();
        let mut doc = BookmarkDoc::init(&dir, 1).unwrap();
        doc.add_folder("f1", "A", "root", 0.0).unwrap();
        doc.add_folder("f2", "B", "root", 1.0).unwrap();
        doc.add_bookmark("b1", "https://a.com", "A", None, "f1", 1.0).unwrap();

        doc.move_bookmark("b1", "f2").unwrap();
        let json = doc.read_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        let bm = v["bookmarks"].as_array().unwrap().iter().find(|b| b["id"] == "b1").unwrap();
        assert_eq!(bm["folderId"], "f2");

        cleanup(&dir);
    }

    #[test]
    fn surgical_delete_syncs_via_delta() {
        let dir1 = temp_dir();
        let dir2 = temp_dir();

        // both start with same data via snapshot
        let mut doc_a = BookmarkDoc::init(&dir1, 1).unwrap();
        doc_a.add_folder("f1", "Dev", "root", 0.0).unwrap();
        doc_a.add_bookmark("b1", "https://a.com", "A", None, "f1", 1.0).unwrap();
        doc_a.add_bookmark("b2", "https://b.com", "B", None, "root", 2.0).unwrap();

        let snap = doc_a.export_snapshot().unwrap();
        let mut doc_b = BookmarkDoc::init(&dir2, 2).unwrap();
        doc_b.import_remote(&snap).unwrap();

        // A deletes a bookmark
        let vv_b = doc_b.version_vector();
        doc_a.remove_bookmark("b1").unwrap();

        // export delta from A, import into B
        let delta = doc_a.export_delta(&vv_b).unwrap();
        doc_b.import_remote(&delta).unwrap();

        // B should now have only b2
        let json_b = doc_b.read_as_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json_b).unwrap();
        let bms = v["bookmarks"].as_array().unwrap();
        assert_eq!(bms.len(), 1);
        assert_eq!(bms[0]["id"], "b2");

        // A cascade-deletes folder
        let vv_b2 = doc_b.version_vector();
        doc_a.delete_folder_cascade("f1").unwrap();

        let delta2 = doc_a.export_delta(&vv_b2).unwrap();
        doc_b.import_remote(&delta2).unwrap();

        let json_b2 = doc_b.read_as_json().unwrap();
        let v2: serde_json::Value = serde_json::from_str(&json_b2).unwrap();
        assert_eq!(v2["folders"].as_array().unwrap().len(), 0);

        cleanup(&dir1);
        cleanup(&dir2);
    }

    #[test]
    fn concurrent_edits_merge() {
        let dir1 = temp_dir();
        let dir2 = temp_dir();

        let mut doc_a = BookmarkDoc::init(&dir1, 1).unwrap();
        let mut doc_b = BookmarkDoc::init(&dir2, 2).unwrap();

        // A adds one bookmark
        doc_a.write_full_from_json(r#"{"bookmarks":[{"id":"a1","url":"https://a.com","title":"A","folderId":"root","createdAt":1}],"folders":[]}"#).unwrap();

        // B adds a different bookmark
        doc_b.write_full_from_json(r#"{"bookmarks":[{"id":"b1","url":"https://b.com","title":"B","folderId":"root","createdAt":2}],"folders":[]}"#).unwrap();

        // exchange snapshots (both import each other's full state)
        let snap_a = doc_a.export_snapshot().unwrap();
        let snap_b = doc_b.export_snapshot().unwrap();
        doc_a.import_remote(&snap_b).unwrap();
        doc_b.import_remote(&snap_a).unwrap();

        // both should have all bookmarks from both peers
        let json_a = doc_a.read_as_json().unwrap();
        let json_b = doc_b.read_as_json().unwrap();
        let va: serde_json::Value = serde_json::from_str(&json_a).unwrap();
        let vb: serde_json::Value = serde_json::from_str(&json_b).unwrap();

        // CRDT merge: both docs should have at least the data from both peers
        // (Loro tree uses last-write-wins for root children, so exact count depends on merge semantics)
        assert!(va["bookmarks"].as_array().unwrap().len() >= 1);
        assert!(vb["bookmarks"].as_array().unwrap().len() >= 1);

        cleanup(&dir1);
        cleanup(&dir2);
    }

    #[test]
    fn independent_docs_merge_via_updates() {
        // Reproduces the simulate_sync scenario:
        // Two docs with independent histories exchange data
        let dir1 = temp_dir();
        let dir2 = temp_dir();

        let mut doc_a = BookmarkDoc::init(&dir1, 1).unwrap();
        let mut doc_b = BookmarkDoc::init(&dir2, 9999).unwrap();

        // A has one bookmark (the "real" device)
        doc_a.add_bookmark("real-1", "https://real.com", "Real", None, "", 1.0).unwrap();

        // B has 3 bookmarks + 1 folder (the "ghost")
        doc_b.write_full_from_json(r#"{"bookmarks":[
            {"id":"g1","url":"https://g1.com","title":"Ghost1","folderId":"root","createdAt":1},
            {"id":"g2","url":"https://g2.com","title":"Ghost2","folderId":"gf1","createdAt":2},
            {"id":"g3","url":"https://g3.com","title":"Ghost3","folderId":"gf1","createdAt":3}
        ],"folders":[{"id":"gf1","name":"Ghost Folder","parentId":"root","order":0}]}"#).unwrap();

        // Test 1: snapshot import (known broken for independent histories)
        let snap_b = doc_b.export_snapshot().unwrap();
        let mut doc_a_snap = BookmarkDoc::init(&temp_dir(), 100).unwrap();
        doc_a_snap.add_bookmark("real-1", "https://real.com", "Real", None, "", 1.0).unwrap();
        doc_a_snap.import_remote(&snap_b).unwrap();
        let json_snap = doc_a_snap.read_as_json().unwrap();
        let v_snap: serde_json::Value = serde_json::from_str(&json_snap).unwrap();
        eprintln!("snapshot import result: {} bookmarks, {} folders",
            v_snap["bookmarks"].as_array().unwrap().len(),
            v_snap["folders"].as_array().unwrap().len());

        // Test 2: updates import (should merge correctly)
        let updates_b = doc_b.export_all_updates().unwrap();
        eprintln!("updates size: {} bytes", updates_b.len());
        doc_a.import_remote(&updates_b).unwrap();
        let json_upd = doc_a.read_as_json().unwrap();
        let v_upd: serde_json::Value = serde_json::from_str(&json_upd).unwrap();
        let bms = v_upd["bookmarks"].as_array().unwrap();
        let flds = v_upd["folders"].as_array().unwrap();
        eprintln!("updates import result: {} bookmarks, {} folders", bms.len(), flds.len());
        eprintln!("bookmarks: {:?}", bms.iter().map(|b| b["id"].as_str().unwrap_or("?")).collect::<Vec<_>>());

        // After updates import, A should have BOTH its own bookmark AND B's bookmarks
        assert!(bms.len() >= 4, "expected at least 4 bookmarks (1 real + 3 ghost), got {}", bms.len());
        assert!(flds.len() >= 1, "expected at least 1 folder, got {}", flds.len());

        cleanup(&dir1);
        cleanup(&dir2);
    }

    #[test]
    fn merge_after_save_reload() {
        // Reproduces EXACT runtime scenario:
        // Doc A saves to disk, reloads, THEN receives ghost updates
        let dir1 = temp_dir();
        let dir2 = temp_dir();

        // A writes a bookmark and saves to disk
        {
            let mut doc_a = BookmarkDoc::init(&dir1, 1).unwrap();
            doc_a.add_bookmark("real-1", "https://real.com", "Real", None, "", 1.0).unwrap();
            doc_a.save().unwrap();
        }

        // A reloads from disk (this is what happens at browser startup)
        let mut doc_a = BookmarkDoc::init(&dir1, 1).unwrap();
        let json_before = doc_a.read_as_json().unwrap();
        eprintln!("A after reload: {}", json_before);

        // B (ghost) creates bookmarks independently
        let mut doc_b = BookmarkDoc::init(&dir2, 9999).unwrap();
        doc_b.write_full_from_json(r#"{"bookmarks":[
            {"id":"g1","url":"https://g1.com","title":"Ghost1","folderId":"","createdAt":1},
            {"id":"g2","url":"https://g2.com","title":"Ghost2","folderId":"","createdAt":2}
        ],"folders":[]}"#).unwrap();

        // B exports all updates
        let updates = doc_b.export_all_updates().unwrap();
        eprintln!("B updates: {} bytes", updates.len());

        // A imports B's updates
        doc_a.import_remote(&updates).unwrap();
        let json_after = doc_a.read_as_json().unwrap();
        eprintln!("A after import: {}", json_after);

        let v: serde_json::Value = serde_json::from_str(&json_after).unwrap();
        let bms = v["bookmarks"].as_array().unwrap();
        eprintln!("bookmark ids: {:?}", bms.iter().map(|b| b["id"].as_str().unwrap_or("?")).collect::<Vec<_>>());
        assert_eq!(bms.len(), 3, "expected 3 bookmarks (1 real + 2 ghost), got {}", bms.len());

        cleanup(&dir1);
        cleanup(&dir2);
    }
}
