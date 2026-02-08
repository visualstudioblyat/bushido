mod blocker;

use tauri::{Manager, WebviewUrl, Emitter};
use tauri::webview::WebviewBuilder;
use std::sync::Mutex;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

struct WebviewState {
    tabs: Mutex<HashMap<String, bool>>,
}

struct BlockerState {
    content_script: String,
    cookie_script: String,
    shortcut_script: String,
    blocked_domains: HashSet<String>,
}

struct WhitelistState {
    sites: Mutex<HashSet<String>>,
}

#[tauri::command]
async fn create_tab(app: tauri::AppHandle, id: String, url: String, sidebar_w: f64, top_offset: f64) -> Result<(), String> {
    let window = app.get_window("main").ok_or("no main window")?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let content_w = (size.width as f64 / scale) - sidebar_w;
    let content_h = (size.height as f64 / scale) - top_offset;

    // https upgrade
    let final_url = if url.starts_with("https://") {
        url.clone()
    } else if url.starts_with("http://") {
        url.replacen("http://", "https://", 1)
    } else {
        format!("https://{}", url)
    };
    let webview_url = WebviewUrl::External(
        final_url.parse().map_err(|e: url::ParseError| e.to_string())?
    );

    let bs = app.state::<BlockerState>();
    let content_script = bs.content_script.clone();
    let cookie_script = bs.cookie_script.clone();
    let shortcut_script = bs.shortcut_script.clone();
    let blocked_domains = bs.blocked_domains.clone();

    // check if this site is whitelisted
    let ws = app.state::<WhitelistState>();
    let whitelist_sites = ws.sites.lock().unwrap().clone();
    let site_domain = url::Url::parse(&final_url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_lowercase()))
        .unwrap_or_default();
    let site_whitelisted = whitelist_sites.contains(&site_domain);

    let tab_id_nav = id.clone();
    let tab_id_title = id.clone();
    let tab_id_title2 = id.clone();
    let tab_id_load = id.clone();
    let tab_id_track = id.clone();
    let app_nav = app.clone();
    let app_title = app.clone();
    let app_title2 = app.clone();
    let app_load = app.clone();
    let inject_content = content_script.clone();
    let inject_cookie = cookie_script.clone();
    let inject_shortcut = shortcut_script.clone();
    let whitelisted_for_nav = site_whitelisted;
    let whitelisted_for_load = site_whitelisted;

    let mut builder = WebviewBuilder::new(&id, webview_url)
        .auto_resize()
        .on_navigation(move |url| {
            let url_str = url.to_string();

            // block http (https-only mode)
            if url_str.starts_with("http://") {
                return false;
            }

            // skip ad blocking for whitelisted sites
            if !whitelisted_for_nav {
                if let Some(host) = url.host_str() {
                    let h = host.to_lowercase();
                    let mut d = h.as_str();
                    loop {
                        if blocked_domains.contains(d) {
                            return false;
                        }
                        match d.find('.') {
                            Some(idx) => d = &d[idx + 1..],
                            None => break,
                        }
                    }
                }
            }

            let _ = app_nav.emit_to("main", "tab-url-changed", serde_json::json!({
                "id": tab_id_nav,
                "url": url_str
            }));
            true
        })
        .on_document_title_changed(move |_wv, title| {
            // intercept blocked count reports from injected js
            if title.starts_with("__BUSHIDO_BLOCKED__:") {
                if let Ok(count) = title[20..].parse::<u32>() {
                    let _ = app_title2.emit_to("main", "tab-blocked-count", serde_json::json!({
                        "id": tab_id_title2,
                        "count": count
                    }));
                }
                return;
            }
            // intercept keyboard shortcuts from child webview
            if title.starts_with("__BUSHIDO_SHORTCUT__:") {
                let rest = &title[21..];
                let action = rest.split(':').next().unwrap_or(rest);
                let _ = app_title2.emit_to("main", "global-shortcut", action);
                return;
            }
            let _ = app_title.emit_to("main", "tab-title-changed", serde_json::json!({
                "id": tab_id_title,
                "title": title
            }));
        })
        .on_page_load(move |wv, payload| {
            let loading = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
            let _ = app_load.emit_to("main", "tab-loading", serde_json::json!({
                "id": tab_id_load,
                "loading": loading
            }));
            // re-inject on every page load
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                // shortcut bridge always injected
                let _ = wv.eval(&inject_shortcut);
                // blockers only if not whitelisted
                if !whitelisted_for_load {
                    let _ = wv.eval(&inject_content);
                    let _ = wv.eval(&inject_cookie);
                }
            }
        });

    // shortcut bridge always injected
    builder = builder.initialization_script(&shortcut_script);

    // only inject blocker scripts if not whitelisted
    if !site_whitelisted {
        builder = builder
            .initialization_script(&content_script)
            .initialization_script(&cookie_script);
    }

    window.add_child(
        builder,
        tauri::LogicalPosition::new(sidebar_w, top_offset),
        tauri::LogicalSize::new(content_w, content_h),
    ).map_err(|e| e.to_string())?;

    let state = app.state::<WebviewState>();
    state.tabs.lock().unwrap().insert(tab_id_track, true);

    Ok(())
}

#[tauri::command]
async fn close_tab(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        wv.close().map_err(|e| e.to_string())?;
    }
    let state = app.state::<WebviewState>();
    state.tabs.lock().unwrap().remove(&id);
    Ok(())
}

#[tauri::command]
async fn switch_tab(app: tauri::AppHandle, id: String, sidebar_w: f64, top_offset: f64) -> Result<(), String> {
    let state = app.state::<WebviewState>();
    let tabs = state.tabs.lock().unwrap().clone();

    for (tab_id, _) in &tabs {
        if let Some(wv) = app.get_webview(tab_id) {
            if tab_id == &id {
                let _ = wv.set_focus();
                let window = app.get_window("main").ok_or("no main window")?;
                let size = window.inner_size().map_err(|e| e.to_string())?;
                let scale = window.scale_factor().map_err(|e| e.to_string())?;
                let content_w = (size.width as f64 / scale) - sidebar_w;
                let content_h = (size.height as f64 / scale) - top_offset;
                let _ = wv.set_position(tauri::LogicalPosition::new(sidebar_w, top_offset));
                let _ = wv.set_size(tauri::LogicalSize::new(content_w, content_h));
            } else {
                let _ = wv.set_position(tauri::LogicalPosition::new(-9999.0, -9999.0));
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn navigate_tab(app: tauri::AppHandle, id: String, url: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        let parsed_url = if url.starts_with("https://") {
            url.parse().map_err(|e: url::ParseError| e.to_string())?
        } else if url.starts_with("http://") {
            url.replacen("http://", "https://", 1)
                .parse().map_err(|e: url::ParseError| e.to_string())?
        } else if url.contains('.') {
            format!("https://{}", url).parse().map_err(|e: url::ParseError| e.to_string())?
        } else {
            format!("https://www.google.com/search?q={}", urlencoding::encode(&url))
                .parse().map_err(|e: url::ParseError| e.to_string())?
        };
        wv.navigate(parsed_url).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn go_back(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        wv.eval("window.history.back()").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn go_forward(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        wv.eval("window.history.forward()").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn reload_tab(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        wv.eval("window.location.reload()").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn minimize_window(app: tauri::AppHandle) -> Result<(), String> {
    app.get_window("main").ok_or("no window")?.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
async fn maximize_window(app: tauri::AppHandle) -> Result<(), String> {
    let win = app.get_window("main").ok_or("no window")?;
    if win.is_maximized().unwrap_or(false) {
        win.unmaximize().map_err(|e| e.to_string())
    } else {
        win.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn close_window(app: tauri::AppHandle) -> Result<(), String> {
    app.get_window("main").ok_or("no window")?.close().map_err(|e| e.to_string())
}

#[tauri::command]
async fn find_in_page(app: tauri::AppHandle, id: String, query: String, forward: bool) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        if query.is_empty() {
            wv.eval("window.getSelection().removeAllRanges()").map_err(|e| e.to_string())?;
        } else {
            let dir = if forward { "false" } else { "true" };
            let js = format!(
                "window.find('{}', false, {}, true, false, false, false)",
                query.replace('\\', "\\\\").replace('\'', "\\'"),
                dir
            );
            wv.eval(&js).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn resize_webviews(app: tauri::AppHandle, active_id: String, sidebar_w: f64, top_offset: f64) -> Result<(), String> {
    let window = app.get_window("main").ok_or("no main window")?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let content_w = (size.width as f64 / scale) - sidebar_w;
    let content_h = (size.height as f64 / scale) - top_offset;

    let state = app.state::<WebviewState>();
    let tabs = state.tabs.lock().unwrap().clone();

    for (tab_id, _) in &tabs {
        if let Some(wv) = app.get_webview(tab_id) {
            if tab_id == &active_id {
                let _ = wv.set_position(tauri::LogicalPosition::new(sidebar_w, top_offset));
                let _ = wv.set_size(tauri::LogicalSize::new(content_w, content_h));
            } else {
                let _ = wv.set_position(tauri::LogicalPosition::new(-9999.0, -9999.0));
            }
        }
    }
    Ok(())
}

fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&dir);
    dir
}

fn session_path(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("session.json")
}

fn whitelist_path(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("whitelist.json")
}

fn load_whitelist(app: &tauri::AppHandle) -> HashSet<String> {
    let path = whitelist_path(app);
    if path.exists() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(sites) = serde_json::from_str::<Vec<String>>(&data) {
                return sites.into_iter().collect();
            }
        }
    }
    HashSet::new()
}

fn save_whitelist(app: &tauri::AppHandle, sites: &HashSet<String>) {
    let path = whitelist_path(app);
    let list: Vec<&String> = sites.iter().collect();
    if let Ok(json) = serde_json::to_string(&list) {
        let _ = fs::write(&path, json);
    }
}

#[tauri::command]
async fn toggle_whitelist(app: tauri::AppHandle, domain: String) -> Result<bool, String> {
    let ws = app.state::<WhitelistState>();
    let (whitelisted, snapshot) = {
        let mut sites = ws.sites.lock().unwrap();
        let wl = if sites.contains(&domain) {
            sites.remove(&domain);
            false
        } else {
            sites.insert(domain);
            true
        };
        (wl, sites.clone())
    };
    save_whitelist(&app, &snapshot);
    Ok(whitelisted)
}

#[tauri::command]
async fn get_whitelist(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let ws = app.state::<WhitelistState>();
    let sites = ws.sites.lock().unwrap();
    Ok(sites.iter().cloned().collect())
}

#[tauri::command]
async fn is_whitelisted(app: tauri::AppHandle, domain: String) -> Result<bool, String> {
    let ws = app.state::<WhitelistState>();
    let sites = ws.sites.lock().unwrap();
    Ok(sites.contains(&domain))
}

#[tauri::command]
async fn save_session(app: tauri::AppHandle, tabs: String) -> Result<(), String> {
    let path = session_path(&app);
    fs::write(&path, tabs).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_session(app: tauri::AppHandle) -> Result<String, String> {
    let path = session_path(&app);
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("[]".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let b = blocker::Blocker::new();
    let content_template = include_str!("content_blocker.js");
    let content_script = content_template.replace("{{BLOCKED_DOMAINS_SET}}", &b.to_js_set());
    let cookie_script = include_str!("cookie_blocker.js").to_string();
    let shortcut_script = include_str!("shortcut_bridge.js").to_string();
    let blocked_domains = b.domains_clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(WebviewState {
            tabs: Mutex::new(HashMap::new()),
        })
        .manage(BlockerState {
            content_script,
            cookie_script,
            shortcut_script,
            blocked_domains,
        })
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_shortcuts(["ctrl+shift+b"]).unwrap()
            .with_handler(|app, _shortcut, event| {
                use tauri_plugin_global_shortcut::ShortcutState;
                println!("[bushido] global shortcut event, state: {:?}", event.state);
                if event.state != ShortcutState::Pressed { return; }
                println!("[bushido] emitting toggle-compact");
                // directly eval JS on the main webview
                if let Some(win) = app.get_webview("main") {
                    let _ = win.eval("window.__bushidoGlobalShortcut && window.__bushidoGlobalShortcut('toggle-compact')");
                }
            })
            .build())
        .setup(|app| {
            let sites = load_whitelist(&app.handle());
            app.manage(WhitelistState {
                sites: Mutex::new(sites),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_tab,
            close_tab,
            switch_tab,
            navigate_tab,
            go_back,
            go_forward,
            reload_tab,
            resize_webviews,
            find_in_page,
            minimize_window,
            maximize_window,
            close_window,
            save_session,
            load_session,
            toggle_whitelist,
            get_whitelist,
            is_whitelisted
        ])
        .run(tauri::generate_context!())
        .expect("error while running bushido");
}
