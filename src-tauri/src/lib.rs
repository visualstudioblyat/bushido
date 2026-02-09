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
async fn create_tab(app: tauri::AppHandle, id: String, url: String, sidebar_w: f64, top_offset: f64, https_only: bool, ad_blocker: bool, cookie_auto_reject: bool) -> Result<(), String> {
    let window = app.get_window("main").ok_or("no main window")?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let content_w = (size.width as f64 / scale) - sidebar_w;
    let content_h = (size.height as f64 / scale) - top_offset;

    // internal pages — handled by React, no webview needed
    if url.starts_with("bushido://") {
        return Ok(());
    }

    // https upgrade (conditional on https_only setting)
    let final_url = if url.starts_with("https://") {
        url.clone()
    } else if url.starts_with("http://") {
        if https_only { url.replacen("http://", "https://", 1) } else { url.clone() }
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
    let nav_https_only = https_only;
    let nav_ad_blocker = ad_blocker;
    let load_ad_blocker = ad_blocker;
    let load_cookie_reject = cookie_auto_reject;

    let mut builder = WebviewBuilder::new(&id, webview_url)
        .auto_resize()
        .on_navigation(move |url| {
            let url_str = url.to_string();

            // block http (only when https-only mode is enabled)
            if nav_https_only && url_str.starts_with("http://") {
                return false;
            }

            // skip ad blocking for whitelisted sites or when ad blocker is off
            if nav_ad_blocker && !whitelisted_for_nav {
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
            // intercept video detection from child webview
            if title.starts_with("__BUSHIDO_VIDEO__:") {
                let has_video = &title[18..] == "1";
                let _ = app_title2.emit_to("main", "tab-has-video", serde_json::json!({
                    "id": tab_id_title2,
                    "hasVideo": has_video
                }));
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
                // blockers only if enabled and not whitelisted
                if load_ad_blocker && !whitelisted_for_load {
                    let _ = wv.eval(&inject_content);
                }
                if load_cookie_reject && !whitelisted_for_load {
                    let _ = wv.eval(&inject_cookie);
                }
            }
        });

    // shortcut bridge always injected
    builder = builder.initialization_script(&shortcut_script);

    // only inject blocker scripts if enabled and not whitelisted
    if ad_blocker && !site_whitelisted {
        builder = builder.initialization_script(&content_script);
    }
    if cookie_auto_reject && !site_whitelisted {
        builder = builder.initialization_script(&cookie_script);
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
async fn detect_video(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        let js = r#"(function(){var videos=document.querySelectorAll('video');var has=false;videos.forEach(function(v){if(v.readyState>=2||v.src||v.querySelector('source'))has=true});var saved=document.title;document.title='__BUSHIDO_VIDEO__:'+(has?'1':'0');setTimeout(function(){document.title=saved},50)})()"#;
        wv.eval(js).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_reader(app: tauri::AppHandle, id: String, font_size: u32, font: String, theme: String, line_width: u32) -> Result<(), String> {
    let fs = font_size.clamp(12, 28);
    let lw = line_width.clamp(600, 900);
    let font_family = if font == "serif" {
        "Georgia,'Times New Roman',serif"
    } else {
        "-apple-system,system-ui,sans-serif"
    };
    let (bg, text, link) = match theme.as_str() {
        "light" => ("#fafafa", "#1a1a1a", "#4f46e5"),
        "sepia" => ("#f4ecd8", "#433422", "#8b5e3c"),
        _ => ("#09090b", "#d4d4d8", "#818cf8"),
    };
    let css = format!(
        "#__bushido_reader{{position:fixed;inset:0;z-index:999999;background:{bg};color:{text};overflow-y:auto;padding:48px 24px;font-family:{font_family};font-size:{fs}px;line-height:1.7}}.bushido-reader-content{{max-width:{lw}px;margin:0 auto}}.bushido-reader-content h1{{font-size:2em;margin-bottom:.5em;line-height:1.2}}.bushido-reader-content img{{max-width:100%;height:auto;border-radius:8px;margin:16px 0}}.bushido-reader-content a{{color:{link}}}.bushido-reader-content p{{margin-bottom:1em}}"
    );
    let js = format!(
        r#"(function(){{if(document.getElementById('__bushido_reader')){{document.getElementById('__bushido_reader').remove();var s=document.getElementById('__bushido_reader_style');if(s)s.remove();document.querySelectorAll('[data-bushido-hidden]').forEach(function(el){{el.style.display=el.dataset.bushidoOrigDisplay||'';delete el.dataset.bushidoHidden;delete el.dataset.bushidoOrigDisplay}});return}}var article=document.querySelector('article')||document.querySelector('[role="main"]')||document.querySelector('main');if(!article){{var candidates=document.querySelectorAll('div,section');var best=null,bestLen=0;candidates.forEach(function(el){{var text=el.innerText||'';if(text.length>bestLen){{bestLen=text.length;best=el}}}});article=best}}if(!article)return;var title=document.title;var content=article.innerHTML;Array.from(document.body.children).forEach(function(el){{if(el.id==='__bushido_reader')return;el.dataset.bushidoOrigDisplay=el.style.display;el.dataset.bushidoHidden='true';el.style.display='none'}});var reader=document.createElement('div');reader.id='__bushido_reader';reader.innerHTML='<div class="bushido-reader-content"><h1>'+title+'</h1>'+content+'</div>';document.body.appendChild(reader);var style=document.createElement('style');style.id='__bushido_reader_style';style.textContent=`{css}`;document.head.appendChild(style)}})()"#
    );
    if let Some(wv) = app.get_webview(&id) {
        wv.eval(&js).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_pip(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        let js = r#"(function(){if(document.pictureInPictureElement){document.exitPictureInPicture();return}var existing=document.getElementById('__bushido_pip_host');if(existing){existing.remove();return}var v=document.querySelector('video');if(!v)return;v.removeAttribute('disablePictureInPicture');v.removeAttribute('disablepictureinpicture');var host=document.createElement('div');host.id='__bushido_pip_host';host.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;pointer-events:none';var shadow=host.attachShadow({mode:'closed'});var btn=document.createElement('div');btn.innerHTML='<svg width="18" height="18" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-right:6px"><rect x="1" y="2.5" width="14" height="11" rx="1.5" stroke="white" stroke-width="1.3"/><rect x="8" y="7" width="6" height="5" rx="1" fill="white" opacity="0.4" stroke="white" stroke-width="1"/></svg>Picture in Picture';btn.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.9);color:#fff;padding:14px 24px;border-radius:10px;cursor:pointer;font:600 15px system-ui;box-shadow:0 8px 32px rgba(0,0,0,0.6);pointer-events:auto;display:flex;align-items:center;border:1px solid rgba(255,255,255,0.15);backdrop-filter:blur(12px);transition:background 0.15s';btn.onmouseenter=function(){btn.style.background='rgba(99,102,241,0.9)'};btn.onmouseleave=function(){btn.style.background='rgba(0,0,0,0.9)'};btn.onclick=function(e){e.stopPropagation();v.requestPictureInPicture().then(function(){host.remove()}).catch(function(){btn.innerHTML='PiP not available';btn.style.background='rgba(239,68,68,0.9)';setTimeout(function(){host.remove()},2000)})};shadow.appendChild(btn);document.documentElement.appendChild(host)})()"#;
        wv.eval(js).map_err(|e| e.to_string())?;
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

fn settings_path(app: &tauri::AppHandle) -> PathBuf { data_dir(app).join("settings.json") }
fn history_path(app: &tauri::AppHandle) -> PathBuf { data_dir(app).join("history.json") }
fn bookmarks_path(app: &tauri::AppHandle) -> PathBuf { data_dir(app).join("bookmarks.json") }

#[tauri::command]
async fn save_settings(app: tauri::AppHandle, data: String) -> Result<(), String> {
    fs::write(settings_path(&app), data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_settings(app: tauri::AppHandle) -> Result<String, String> {
    let p = settings_path(&app);
    if p.exists() { fs::read_to_string(&p).map_err(|e| e.to_string()) } else { Ok("{}".into()) }
}

#[tauri::command]
async fn save_history(app: tauri::AppHandle, data: String) -> Result<(), String> {
    fs::write(history_path(&app), data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_history(app: tauri::AppHandle) -> Result<String, String> {
    let p = history_path(&app);
    if p.exists() { fs::read_to_string(&p).map_err(|e| e.to_string()) } else { Ok("[]".into()) }
}

#[tauri::command]
async fn save_bookmarks(app: tauri::AppHandle, data: String) -> Result<(), String> {
    fs::write(bookmarks_path(&app), data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_bookmarks(app: tauri::AppHandle) -> Result<String, String> {
    let p = bookmarks_path(&app);
    if p.exists() { fs::read_to_string(&p).map_err(|e| e.to_string()) } else { Ok(r#"{"bookmarks":[],"folders":[]}"#.into()) }
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
        .plugin(tauri_plugin_opener::init())
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
            .with_shortcuts([
                "ctrl+shift+b",
                "ctrl+k",
                "ctrl+shift+r",
                "ctrl+t",
                "ctrl+w",
                "ctrl+l",
                "ctrl+f",
                "ctrl+d",
                "ctrl+h",
            ]).unwrap()
            .with_handler(|app, shortcut, event| {
                use tauri_plugin_global_shortcut::ShortcutState;
                if event.state != ShortcutState::Pressed { return; }
                let s = shortcut.to_string().to_lowercase();
                let action = if s.contains("shift") && s.contains('b') { "toggle-compact" }
                    else if s.contains("shift") && s.contains('r') { "reader-mode" }
                    else if s.contains('k') { "command-palette" }
                    else if s.contains('t') { "new-tab" }
                    else if s.contains('w') { "close-tab" }
                    else if s.contains('l') { "focus-url" }
                    else if s.contains('f') { "find" }
                    else if s.contains('d') { "bookmark" }
                    else if s.contains('h') { "history" }
                    else { return; };
                if let Some(win) = app.get_webview("main") {
                    let js = format!("window.__bushidoGlobalShortcut && window.__bushidoGlobalShortcut('{}')", action);
                    let _ = win.eval(&js);
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
            detect_video,
            toggle_reader,
            toggle_pip,
            resize_webviews,
            find_in_page,
            minimize_window,
            maximize_window,
            close_window,
            save_session,
            load_session,
            save_settings,
            load_settings,
            save_history,
            load_history,
            save_bookmarks,
            load_bookmarks,
            toggle_whitelist,
            get_whitelist,
            is_whitelisted
        ])
        .run(tauri::generate_context!())
        .expect("error while running bushido");
}
