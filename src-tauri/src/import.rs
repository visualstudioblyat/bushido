use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct BrowserInfo {
    pub name: String,
    pub has_bookmarks: bool,
    pub has_history: bool,
}

#[derive(Serialize)]
pub struct ImportedBookmark {
    pub title: String,
    pub url: String,
    pub folder: String,
}

#[derive(Serialize)]
pub struct ImportedHistory {
    pub title: String,
    pub url: String,
    pub visit_count: i64,
    pub last_visit: i64,
}

// Chrome/Edge bookmarks JSON structure
#[derive(Deserialize)]
struct ChromeBookmarks {
    roots: ChromeRoots,
}

#[derive(Deserialize)]
struct ChromeRoots {
    bookmark_bar: ChromeNode,
    other: ChromeNode,
}

#[derive(Deserialize)]
struct ChromeNode {
    #[serde(default)]
    name: String,
    #[serde(rename = "type")]
    node_type: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    children: Vec<ChromeNode>,
}

fn local_app_data() -> Option<PathBuf> {
    std::env::var("LOCALAPPDATA").ok().map(PathBuf::from)
}

fn app_data() -> Option<PathBuf> {
    std::env::var("APPDATA").ok().map(PathBuf::from)
}

fn chrome_profile_dir() -> Option<PathBuf> {
    local_app_data().map(|p| p.join("Google").join("Chrome").join("User Data").join("Default"))
}

fn edge_profile_dir() -> Option<PathBuf> {
    local_app_data().map(|p| p.join("Microsoft").join("Edge").join("User Data").join("Default"))
}

fn firefox_profile_dir() -> Option<PathBuf> {
    let profiles_dir = app_data()?.join("Mozilla").join("Firefox").join("Profiles");
    if !profiles_dir.exists() { return None; }
    // find the default-release profile (or any profile)
    fs::read_dir(&profiles_dir).ok()?.filter_map(|e| e.ok()).find_map(|entry| {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".default-release") || name.ends_with(".default") {
            Some(entry.path())
        } else {
            None
        }
    })
}

#[tauri::command]
pub async fn detect_browsers() -> Result<Vec<BrowserInfo>, String> {
    let mut browsers = Vec::new();

    if let Some(dir) = chrome_profile_dir() {
        if dir.exists() {
            browsers.push(BrowserInfo {
                name: "Chrome".into(),
                has_bookmarks: dir.join("Bookmarks").exists(),
                has_history: dir.join("History").exists(),
            });
        }
    }

    if let Some(dir) = edge_profile_dir() {
        if dir.exists() {
            browsers.push(BrowserInfo {
                name: "Edge".into(),
                has_bookmarks: dir.join("Bookmarks").exists(),
                has_history: dir.join("History").exists(),
            });
        }
    }

    if let Some(dir) = firefox_profile_dir() {
        let places = dir.join("places.sqlite");
        browsers.push(BrowserInfo {
            name: "Firefox".into(),
            has_bookmarks: places.exists(),
            has_history: places.exists(),
        });
    }

    Ok(browsers)
}

fn walk_chrome_bookmarks(node: &ChromeNode, folder: &str, out: &mut Vec<ImportedBookmark>) {
    if node.node_type == "url" && !node.url.is_empty() {
        out.push(ImportedBookmark {
            title: node.name.clone(),
            url: node.url.clone(),
            folder: folder.to_string(),
        });
    } else if node.node_type == "folder" {
        let folder_name = if folder.is_empty() { node.name.clone() } else { format!("{}/{}", folder, node.name) };
        for child in &node.children {
            walk_chrome_bookmarks(child, &folder_name, out);
        }
    }
}

fn import_chromium_bookmarks(profile_dir: &PathBuf) -> Result<Vec<ImportedBookmark>, String> {
    let path = profile_dir.join("Bookmarks");
    let data = fs::read_to_string(&path).map_err(|e| format!("Failed to read bookmarks: {}", e))?;
    let parsed: ChromeBookmarks = serde_json::from_str(&data).map_err(|e| format!("Failed to parse bookmarks: {}", e))?;
    let mut bookmarks = Vec::new();
    walk_chrome_bookmarks(&parsed.roots.bookmark_bar, "Bookmarks Bar", &mut bookmarks);
    walk_chrome_bookmarks(&parsed.roots.other, "Other Bookmarks", &mut bookmarks);
    Ok(bookmarks)
}

fn import_chromium_history(profile_dir: &PathBuf) -> Result<Vec<ImportedHistory>, String> {
    let src = profile_dir.join("History");
    // copy to temp — the file is locked by the running browser
    let tmp = std::env::temp_dir().join(format!("bushido_import_{}.sqlite", std::process::id()));
    fs::copy(&src, &tmp).map_err(|e| format!("Failed to copy history db: {}", e))?;

    let conn = rusqlite::Connection::open_with_flags(&tmp, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open history db: {}", e))?;

    let mut stmt = conn.prepare(
        "SELECT url, title, visit_count, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 5000"
    ).map_err(|e| format!("Failed to query history: {}", e))?;

    let rows = stmt.query_map([], |row| {
        // Chrome stores time as microseconds since 1601-01-01, convert to unix ms
        let chrome_time: i64 = row.get(3)?;
        let unix_ms = (chrome_time / 1000) - 11_644_473_600_000;
        Ok(ImportedHistory {
            url: row.get(0)?,
            title: row.get::<_, String>(1).unwrap_or_default(),
            visit_count: row.get(2)?,
            last_visit: unix_ms,
        })
    }).map_err(|e| format!("Failed to read history rows: {}", e))?;

    let history: Vec<ImportedHistory> = rows.filter_map(|r| r.ok()).collect();
    let _ = fs::remove_file(&tmp);
    Ok(history)
}

fn import_firefox_bookmarks(profile_dir: &PathBuf) -> Result<Vec<ImportedBookmark>, String> {
    let src = profile_dir.join("places.sqlite");
    let tmp = std::env::temp_dir().join(format!("bushido_ff_import_{}.sqlite", std::process::id()));
    fs::copy(&src, &tmp).map_err(|e| format!("Failed to copy places.sqlite: {}", e))?;

    let conn = rusqlite::Connection::open_with_flags(&tmp, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open places.sqlite: {}", e))?;

    let mut stmt = conn.prepare(
        "SELECT b.title, p.url, COALESCE(parent.title, '') as folder \
         FROM moz_bookmarks b \
         JOIN moz_places p ON b.fk = p.id \
         LEFT JOIN moz_bookmarks parent ON b.parent = parent.id \
         WHERE b.type = 1 AND p.url NOT LIKE 'place:%'"
    ).map_err(|e| format!("Failed to query bookmarks: {}", e))?;

    let rows = stmt.query_map([], |row| {
        Ok(ImportedBookmark {
            title: row.get::<_, String>(0).unwrap_or_default(),
            url: row.get(1)?,
            folder: row.get::<_, String>(2).unwrap_or_default(),
        })
    }).map_err(|e| format!("Failed to read bookmark rows: {}", e))?;

    let bookmarks: Vec<ImportedBookmark> = rows.filter_map(|r| r.ok()).collect();
    let _ = fs::remove_file(&tmp);
    Ok(bookmarks)
}

fn import_firefox_history(profile_dir: &PathBuf) -> Result<Vec<ImportedHistory>, String> {
    let src = profile_dir.join("places.sqlite");
    let tmp = std::env::temp_dir().join(format!("bushido_ff_hist_{}.sqlite", std::process::id()));
    fs::copy(&src, &tmp).map_err(|e| format!("Failed to copy places.sqlite: {}", e))?;

    let conn = rusqlite::Connection::open_with_flags(&tmp, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open places.sqlite: {}", e))?;

    let mut stmt = conn.prepare(
        "SELECT url, title, visit_count, last_visit_date FROM moz_places \
         WHERE visit_count > 0 ORDER BY last_visit_date DESC LIMIT 5000"
    ).map_err(|e| format!("Failed to query history: {}", e))?;

    let rows = stmt.query_map([], |row| {
        // Firefox stores time as microseconds since unix epoch
        let ff_time: i64 = row.get::<_, i64>(3).unwrap_or(0);
        Ok(ImportedHistory {
            url: row.get(0)?,
            title: row.get::<_, String>(1).unwrap_or_default(),
            visit_count: row.get(2)?,
            last_visit: ff_time / 1000, // convert to ms
        })
    }).map_err(|e| format!("Failed to read history rows: {}", e))?;

    let history: Vec<ImportedHistory> = rows.filter_map(|r| r.ok()).collect();
    let _ = fs::remove_file(&tmp);
    Ok(history)
}

#[tauri::command]
pub async fn import_bookmarks(browser: String) -> Result<Vec<ImportedBookmark>, String> {
    match browser.as_str() {
        "Chrome" => {
            let dir = chrome_profile_dir().ok_or("Chrome profile not found")?;
            import_chromium_bookmarks(&dir)
        }
        "Edge" => {
            let dir = edge_profile_dir().ok_or("Edge profile not found")?;
            import_chromium_bookmarks(&dir)
        }
        "Firefox" => {
            let dir = firefox_profile_dir().ok_or("Firefox profile not found")?;
            import_firefox_bookmarks(&dir)
        }
        _ => Err(format!("Unknown browser: {}", browser)),
    }
}

#[tauri::command]
pub async fn import_history(browser: String) -> Result<Vec<ImportedHistory>, String> {
    match browser.as_str() {
        "Chrome" => {
            let dir = chrome_profile_dir().ok_or("Chrome profile not found")?;
            import_chromium_history(&dir)
        }
        "Edge" => {
            let dir = edge_profile_dir().ok_or("Edge profile not found")?;
            import_chromium_history(&dir)
        }
        "Firefox" => {
            let dir = firefox_profile_dir().ok_or("Firefox profile not found")?;
            import_firefox_history(&dir)
        }
        _ => Err(format!("Unknown browser: {}", browser)),
    }
}
