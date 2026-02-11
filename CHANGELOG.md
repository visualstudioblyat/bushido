# Bushido — Changelog

---

## v0.8.2

**2026-02-10**

v0.8.1 added the security settings page, but the underlying security implementation had gaps that production browsers (Firefox, Brave, Chromium) had already solved. v0.8.2 closes those gaps — informed by deep research into Firefox's `privacy.resistFingerprinting`, WebView2 COM safety patterns, and Chromium's `Sec-Fetch-*` header behavior.

The headline: a panic in any COM callback could crash the entire browser with a 0xc0000005 access violation. Every other change is important, but that one was a real defect.

### Security

- **COM callback safety** — all 5 COM event handlers (DownloadStarting, GetCookiesCompleted, WebResourceRequested, WebMessageReceived, ProcessFailed) wrapped in `std::panic::catch_unwind` + `AssertUnwindSafe`. A panic in any callback now returns gracefully instead of crossing the Rust/C++ FFI boundary into undefined behavior. This was the most critical fix — a malformed URL, unexpected null pointer, or edge case in the download handler would previously kill the process instantly.
- **Env var injection prevention** — `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` now cleared with `remove_var()` before `set_var()`. Previously, another process running before Bushido could pre-populate this with `--remote-debugging-port=9222` and remotely control every tab.
- **Dangerous URI scheme blocking** — `ms-msdt:`, `search-ms:`, `ms-officecmd:`, `ms-word:`, `ms-excel:`, `ms-powerpoint:`, `ms-cxh:`, `ms-cxh-full:` added to the scheme blocklist. `ms-msdt:` is the Follina exploit (CVE-2022-30190) — a link on any page could trigger Windows diagnostics with arbitrary PowerShell execution.
- **Accept-Language normalization** — set to `en-US,en;q=0.9` at the COM level on every outgoing request. Previously the JS spoof said `en-US` but the actual HTTP header leaked the real system locale — servers could see the mismatch.

### Changed

- **Stopped stripping Sec-Fetch-\* headers** — research confirmed Chromium's network stack overwrites `Sec-Fetch-Dest`, `Sec-Fetch-Mode`, `Sec-Fetch-Site`, and `Sec-Fetch-User` after the `WebResourceRequested` handler runs. Stripping them was a no-op that wasted CPU on the hottest path in the browser. Removed the loop entirely.
- **Smarter hardwareConcurrency spoof** — was hardcoded to 4, now uses Firefox's RFP logic: returns 8 if real core count >= 8, else 4. Maintains a larger anonymity set while giving web apps enough workers for real work. The old value of 4 was a known Bushido/Brave signature.
- **Per-session canvas noise** — replaced static `d[i] ^ 1` XOR (same noise every time, hashable by trackers) with a per-session PRNG seed. Deterministic within a session (consistent for pages that check twice), unique across sessions (useless for cross-session tracking). Uses a linear congruential generator seeded from `Math.random()` at script injection time.
- **performance.now() clamped** — clamped to 16.67ms intervals (60fps frame boundary) with random jitter of 0–5 additional frames. Prevents Spectre-class timing attacks and high-resolution clock fingerprinting. Matches Firefox RFP's approach.

### Added

- **5 new fingerprint vectors blocked** (total now 23):
  - `speechSynthesis.getVoices()` → empty array (prevents TTS voice fingerprinting — high entropy)
  - `navigator.mediaDevices.enumerateDevices()` → empty array (prevents camera/mic hardware ID leaking)
  - `navigator.storage.estimate()` → fixed 1GB quota, 0 usage (prevents disk usage pattern fingerprinting)
  - `navigator.webdriver` → false (anti-automation detection flag)
  - `performance.memory` → fixed values (Chrome-only heap size fingerprint)
- **toString hardening** — all spoofed prototype methods (canvas, WebGL, AudioContext, performance.now) now return `function () { [native code] }` from `.toString()` and `.toLocaleString()`. Prevents detection by fingerprinting libraries that check whether browser APIs have been monkey-patched.

---

## v0.8.1

**2026-02-10**

v0.8.0 added web panels, but the WebView2 hardening settings (DevTools, autofill, password save, status bar) were all-or-nothing — hardcoded on or off for every tab. Power users want DevTools. Privacy users want autofill disabled. v0.8.1 puts all 7 hardening options into the Settings page where you can toggle each one individually. All default to OFF so nothing breaks out of the box.

### Added

- **Security Settings section** — 7 toggleable WebView2 hardening options in Settings → Security. Each one is OFF by default (power-user friendly). Paranoid users can flip them on:
  - **Disable DevTools** — `SetAreDevToolsEnabled(false)` on the WebView2 COM layer. Prevents F12 / Inspect Element in tabs.
  - **Disable status bar** — `SetIsStatusBarEnabled(false)`. Hides the URL preview on link hover.
  - **Disable autofill** — `SetIsGeneralAutofillEnabled(false)` via `ICoreWebView2Settings4`. Prevents form auto-completion.
  - **Disable password autosave** — `SetIsPasswordAutosaveEnabled(false)`. Browser won't offer to save passwords.
  - **Block service workers** — JS injection that rejects `navigator.serviceWorker.register()`. Prevents SW-based tracker bypass (breaks PWAs).
  - **Block font enumeration** — JS injection that stubs `document.fonts.check()`. Prevents sites from detecting installed fonts.
  - **Spoof CPU core count** — JS injection that reports `navigator.hardwareConcurrency` as 4. Reduces fingerprint surface.
- **Reload banner** — when any security toggle changes, a banner appears: "Reload all tabs to apply changes" with a Reload button. Clicking it destroys and recreates every webview with the new settings. Settings are per-webview (applied at creation time), so existing tabs need a reload to pick up changes.
- **Crash recovery** — `ProcessFailed` COM handler detects renderer crashes, emits `tab-crashed` to React. Crashed tabs show a red "!" badge in the sidebar. Click to destroy and recreate the webview with the same URL.
- **Error boundary** — `react-error-boundary` wraps the entire app. Render errors show fallback UI with "Try again" instead of a white screen.
- **Global rejection handler** — `window.onunhandledrejection` catches fire-and-forget `invoke()` failures. Logs to console instead of silently breaking.

### Security

- **Host objects disabled** — `SetAreHostObjectsAllowed(false)` on every child webview. Prevents pages from accessing projected Rust methods.
- **Always-on header stripping** — `WebResourceRequested` runs for ALL tabs (even with ad blocker off). Strips `Sec-CH-UA-*` (10 variants), `Sec-Fetch-*` (4), `X-Client-Data`, `X-Requested-With`. Referer normalized to origin only.
- **BROWSER_ARGS** — `--disable-quic --site-per-process --origin-agent-cluster=true --disable-dns-prefetch --disable-background-networking --enable-features=ThirdPartyStoragePartitioning,PartitionedCookies --disable-features=UserAgentClientHint`.
- **Process priority** — Rust process boosted to `ABOVE_NORMAL_PRIORITY_CLASS` for UI responsiveness during heavy filtering.
- **Max 50 tabs** — enforced at the top of `create_tab`. Prevents resource exhaustion.

### Changed

- **Settings sections reorganized** — "Privacy" and "Security" are now separate sections. Privacy covers HTTPS-only, ad blocker, cookie rejection, clear-on-exit. Security covers the 7 WebView2 hardening toggles.
- **`WebResourceRequested` restructured** — moved outside the `if block_enabled` gate. Header stripping runs unconditionally; adblock check is conditional inside. Disabling ad blocker no longer disables privacy header stripping.

---

## v0.8.0

**2026-02-10**

Vivaldi and Opera have sidebar panels. Edge has them too. They're all the same — a tiny webview pinned to the side so you can keep Spotify or Discord open without burning a tab. Bushido does the same thing, but panels get a mobile user agent by default so sites serve mobile layouts at 350px instead of cramming desktop into a phone-width column.

Click "+" in the panel row to pick from presets (Spotify, Discord, WhatsApp, YouTube Music, X) or paste any URL. Click the favicon to toggle. Right-click to remove. Panels persist across restarts. Only one open at a time — it slides between the sidebar and your content area.

### Added

- **Web Panels** — persistent sidebar webviews that survive tab switches. Pin any site as a side panel, toggle with one click. 350px fixed width, positioned between sidebar and content area. Session save/restore included.
- **Mobile UA on panels** — panel webviews get a Chrome Android user agent via `WebviewBuilder::user_agent()`. Sites serve mobile-friendly layouts instead of trying to cram a desktop page into 350px. Regular tabs are unaffected.
- **Panel site picker** — "+" button opens a dropdown with 6 presets and a custom URL input. No more cloning the current tab URL — you pick what goes in the panel.
- **`PanelState` isolation** — panels tracked in a separate `HashSet<String>` so `layout_webviews` doesn't hide them at (-9999, -9999) every time the tab layout recalculates.

### Security

- **URL scheme blocklist** — `javascript:`, `data:`, `file:`, `vbscript:`, `blob:` schemes now blocked in `create_tab`, `navigate_tab`, and the `on_navigation` callback. Defense-in-depth with a React-side `sanitizePanelUrl()` that validates before any `invoke` call.
- **Panel URL sanitization** — strips control characters, rejects dangerous schemes, validates via `URL()` parse. Blocks `bushido://` URLs from being opened as panels (no webview for internal pages).

### Changed

- **`create_tab` takes `is_panel` param** — controls whether the webview gets mobile UA. All 8 call sites updated. Session restore passes `isPanel: true` for restored panels.

---

## v0.7.0

**2026-02-10**

Every browser tab you open is a separate process talking to the main UI. Until now, those tabs communicated back to Bushido's core by flickering `document.title` — a hack that worked but leaked IPC traffic to every script on the page, raced with real title updates, and capped message size at ~1024 characters. v0.7.0 rips all of that out and replaces it with WebView2's native `postMessage` channel. Zero title flicker, zero race conditions, zero spoofing surface. The title bar is just a title bar again.

Also: split view got a full rewrite. The old version was two panes. The new one is a recursive tree — split horizontally or vertically, up to 4 panes, drag dividers to resize. And there's a media player bar in the sidebar now.

### Added

- **Split View v2** (`Ctrl+\`) — tree-based pane layout. Split any pane horizontally or vertically, up to 4 panes. Drag dividers to resize (min 15% per pane). Session restore preserves your layout. `syncLayout()` replaces all legacy `switch_tab`/`resize_webviews` calls with a single flat-rect layout pass.
- **Media Controls** — sidebar mini player bar. Detects audio/video playing in any tab, shows title + play/pause + mute buttons. Click the bar to switch to that tab. Persists across tab switches. Polling-based detection (1.5s) because YouTube's video element doesn't fire standard events in WebView2 initialization scripts.

### Security

- **postMessage IPC migration** — all child-to-Rust communication (`shortcut_bridge.js`, `media_listener.js`, `detect_video`) migrated from `document.title` encoding to `window.chrome.webview.postMessage`. Registered a `WebMessageReceivedEventHandler` in the WebView2 COM layer alongside the existing download handler. Messages use a `__bushido` JSON namespace with server-side whitelist validation. Eliminates title flicker, race conditions, length limits, and spoofing vectors (Security.txt §6.1).
- **Title sanitization** — `on_document_title_changed` now strips `<` and `>` from all tab titles before emitting to React. Prevents stored XSS via malicious `<title>` tags (§5.1).
- **find_in_page hardening** — added `\n`/`\r` escaping to search queries. Prevents string context breakout in the `window.find()` eval (§3.1).
- **Guard variable hardening** — all 4 injection scripts (`shortcut_bridge.js`, `media_listener.js`, `content_blocker.js`, `cookie_blocker.js`) now use `Object.defineProperty(configurable: false)`. Malicious pages can no longer delete or override the guard to re-inject listeners (§3.2).
- **Download path traversal fix** — `Path::file_name()` extracts only the basename before deduplication. Filenames containing `../` can no longer write outside the download directory (§5.2).
- **Media title sanitization** — React-side tag stripping on `tab-media-state` event payload, matching the pattern used for tab titles.

### Changed

- **`on_document_title_changed` is clean** — no more `__BUSHIDO_MEDIA__`, `__BUSHIDO_VIDEO__`, or `__BUSHIDO_SHORTCUT__` prefix interception. Title handler is a straight pass-through with sanitization.
- **Dead code removed** — `app_title2`, `tab_id_title2` clones, sequence counters, URL encoding/decoding for title IPC — all gone.

---

## v0.6.1

**2026-02-10**

### Added

- **Split View** (`Ctrl+\`) — two tabs side-by-side, 50/50. Right-click any tab → "split with this tab", or press the shortcut and it picks the most recently used tab. Click the split tab in the sidebar to swap panes. Navigate to an internal page or press `Ctrl+\` again to exit. Each workspace has its own split state, and it persists across restarts.

### Changed

- **Tab suspender skips split tab** — the tab showing in the right pane won't get suspended while it's visible.
- **Opening a new tab exits split** — keeps it simple, you're starting a new task.

---

## v0.6.0

**2026-02-10**

Chrome and Edge ship with basic ad blockers that catch maybe 30% of what you'd want blocked. Firefox relies on uBlock Origin — which still works, but Manifest V3 has been tightening what extensions can do. Bushido now runs a real content blocking engine at the WebView2 COM level — 140,000+ filter rules from EasyList and EasyPrivacy, sub-millisecond matching, and it intercepts requests before the browser even starts the connection. No extension, no flag to enable, no way for page JavaScript to bypass it.

### Added

- **adblock-rust engine** — production-grade content blocking compiled from EasyList + EasyPrivacy (~140k rules). First startup compiles the filter lists in ~400ms and caches the binary to disk. Every startup after that loads in ~5ms. Median per-request matching is 0.041ms — you won't notice it.
- **WebView2 COM-level network blocking** — all sub-resource requests (scripts, images, iframes, XHR, fetch, CSS, fonts, websockets) are intercepted via `WebResourceRequestedEventHandler` before the connection is established. This is unbypassable — page JavaScript can't override it the way it can with fetch/XHR monkey-patching. The old JS injection approach caught maybe 60% of trackers. This catches everything EasyList knows about.
- **Blocked count from Rust** — the shield badge count now comes directly from the COM handler via atomic counter, not from JS title encoding. More accurate, no race conditions, works even when JS is slow to load.

### Changed

- **Content script stripped to cosmetic-only** — all the JavaScript network interception is gone. The page script now only handles things that have to happen in the page: hiding ad containers with CSS, WebRTC leak prevention, fingerprint resistance, and privacy headers. Everything else moved to the native layer where it can't be bypassed.
- **Blocking engine replaced** — the old hardcoded domain list (~250 entries) is gone. The new engine compiles the full EasyList and EasyPrivacy rulesets into an optimized binary format with wildcard matching, resource type filtering, and exception rules. Not even close to the same thing.

### Removed

- `{{BLOCKED_DOMAINS_SET}}` template replacement — no more injecting domain lists into JS
- `__BUSHIDO_BLOCKED__:` title encoding for blocked counts — replaced by Rust-side atomic counter
- All JS-level network interception (fetch override, XHR override, setAttribute override, sendBeacon override, Image.src override, Script.src override, Iframe.src override)

---

## v0.5.2

**2026-02-10**

Chrome has parallel downloading behind a flag (`chrome://flags/#enable-parallel-downloading`), but it's off by default and most people don't know it exists. Even when enabled, it's a simplified implementation — no crash recovery, no manifest persistence, no cookie-aware resumption. Close Chrome mid-download and your progress is gone. IDM ($25) solves all of this but it's a separate app with a browser extension. Bushido does it natively.

### Added

- **Parallel chunked downloads** — large files (>1MB) split into up to 6 simultaneous segments. Each one grabs its own byte range and writes to the file at the exact offset using `seek_write`. Saturates your bandwidth the way IDM does, except it's built into the browser. No extensions, no separate app, no $25 license fee.
- **Dynamic segment splitting** — when a fast segment finishes early, the orchestrator finds the segment with the most bytes remaining and splits it at the midpoint. New worker picks up the second half. IDM does this too. Zero idle connections means zero wasted bandwidth.
- **Cookie extraction for authenticated downloads** — bushido grabs all cookies for that URL via `ICoreWebView2_2::CookieManager` and passes them to reqwest. Downloading from Google Drive, Dropbox, or anything behind a login actually works. Third-party download managers like IDM and FDM solve this with browser extensions, but that's another thing to install and keep updated. Bushido doesn't need an extension — it is the browser, so cookies are right there.
- **Segment count badge** — download panel shows "6x" (or however many active connections) next to the speed while a chunked download is running. You can see it working.
- **Retry failed downloads** — failed downloads get a retry button right in the panel. Click it and it restarts from scratch.

### Changed

- **Download manifests are v2** — manifests now store per-segment progress and cookies. `#[serde(default)]` on the new fields so v1 manifests still load fine. Pause a chunked download, close the browser, reopen — each segment resumes from where it left off. Most browsers lose your progress if you close mid-download.
- **Small files stay single-stream** — if the server doesn't support Range headers, or the file is under 1MB, it falls back to a single connection. No unnecessary overhead for small stuff.

---

## v0.5.1

**2026-02-10**

Every major browser ships a download manager, but they're all basically the same — a progress bar, a single connection, and a prayer that your connection holds. Close the browser mid-download? Start over. Bushido's download engine is built from scratch in Rust with pause/resume that actually persists to disk, crash recovery via manifest files, and a UI that stays out of your way.

### Added

- **Download Manager** — bushido intercepts every download via WebView2's `DownloadStarting` COM event. Suppresses the default browser UI, routes it through our own Rust engine. Pause, resume, cancel, open file, open folder. Progress bar, speed readout, ETA. Manifest files (`.part.json`) persist progress to disk so downloads survive crashes — Edge and Chrome don't do this, if the browser closes mid-download you start over. Range header support means paused downloads pick up where they left off, not from byte zero. Filename deduplication handles the `report.pdf` → `report (1).pdf` thing automatically.
- **Download panel** — slide-over panel in the sidebar. Shows all active, paused, completed, and failed downloads. Badge on the download button shows active count. No separate page, no popup that disappears when you click away.
- **Download location setting** — pick your download folder in settings. Optional "ask every time" toggle.

---

## v0.5.0

**2026-02-09**

### Added

- **New Tab Page** — `bushido://newtab` is a real page now. Clock, greeting that knows what time of day it is, search bar, top sites grid. All React-rendered, no webview spawned. Toggle any of it off in settings.
- **Command Palette** (`Ctrl+K`) — type to search your tabs, bookmarks, history, or pick from 7 actions. Fuzzy matching, arrow keys, enter to go. Shows recent stuff when you haven't typed anything yet.
- **Reader Mode** (`Ctrl+Shift+R`) — strips pages down to just the text and images. Pick your font, theme (dark/light/sepia), line width. Click again to exit.
- **Picture-in-Picture** — bushido watches for videos on the page. When it finds one, PiP button shows up in the sidebar. One click, video pops out. Shadow DOM so sites can't block the button.
- **Tab Suspender** — tabs you haven't touched in 5 minutes get put to sleep. Webview destroyed, zzz badge on the tab. Click it and it comes back. Pinned tabs never sleep.
- **Settings** (`bushido://settings`) — gear icon in sidebar. Search engine, startup behavior, privacy toggles, download location, appearance, shortcuts reference, about. Saved to disk, loads before anything else on startup.
- **Search engine selector** — swap between Google, DuckDuckGo, Brave, Bing, or drop in your own URL. Works in the URL bar and the NTP search.
- **Clear data on exit** — toggle in privacy settings. When enabled, clears browsing data when you close the browser.

### Changed

- **Settings aren't fake anymore** — every toggle does what it says. Turn off ad blocker? Content scripts stop injecting. Turn off HTTPS-only? HTTP works again. Set startup to "new tab"? Session doesn't restore. All of it flows through to Rust.
- **Settings load first** — `Promise.all` grabs settings and session in parallel, but settings get applied before any tabs are created. No more race condition.
- **Compact mode stays in sync** — flip it in settings, `Ctrl+Shift+B` knows. Flip it with the shortcut, settings knows. They're the same state now.
- **Suspend timeout is configurable** — was hardcoded to 5 minutes, now reads from settings. Set it to 30 or turn it off entirely.

### Security

- **CSP locked down** — strict policy in tauri.conf.json. Separate `devCsp` so Vite HMR still works during dev.
- **Killed `tauri-plugin-shell`** — replaced with `tauri-plugin-opener`. The old one had a CVE (CVE-2025-31477).
- **Nuked `eval_tab`** — used to let the frontend run arbitrary JS on any webview. Replaced with 3 named commands (`detect_video`, `toggle_reader`, `toggle_pip`). That's it, nothing else gets evaled.
- **Title sanitization** — HTML tags get stripped from tab titles. No more `<script>` in your tab name.

---

## v0.4.0

**2026-02-09**

### Changed

- **Killed the toolbar** — everything lives in the sidebar now. Nav buttons, URL bar, shield, bookmarks. Zen-style vertical layout. Webview gets the full height, titlebar is just the page title + window controls.
- **Sidebar is 300px** — was 260. URL bar is 38px tall, flat and transparent. Search icon instead of a lock. No inset shadows, no glow rings.
- **Nav buttons are ghost-style** — no background or border, just icons. Back/forward sit together, reload pushed right. Matches everything else in the sidebar.
- **Nuked every `transition: all`** — 26 of them. Each one now lists only the properties that actually change. Browser doesn't have to watch everything anymore.

### Added

- **Top sites grid** — click the URL bar and your 8 most-visited sites pop up in a 4×2 grid with favicons. Frecency-ranked. Falls back to defaults (Google, YouTube, GitHub, etc.) if you're fresh.
- **Extensions panel** — little icon in the URL bar opens a Zen-style dropdown. Quick actions row (bookmark, screenshot, reader, share), extensions grid with the shield blocker, "+" button. "Manage" link fades in on hover.
- **History** (`Ctrl+H`) — slide-over panel with search, date grouping, clear by range.
- **Bookmarks** (`Ctrl+D`) — star in sidebar header, collapsible section, right-click to remove.
- **Frecency suggestions** — type in the URL bar and get ranked results from history + bookmarks. Arrow keys to navigate.

### Removed

- `Toolbar.tsx` — absorbed into Sidebar
- Tab search input — URL bar filters tabs when focused now
- "TABS" / "pinned" section labels and count badges
- `--toolbar-height` CSS variable

---

## v0.3.1

**2026-02-08**

### Changed

- **Sidebar virtualization** — tab list only renders what's visible now. Doesn't matter if you have 10 tabs or 200, the sidebar stays fast. Scroll is smooth because we're not asking React to paint 200 DOM nodes.
- **Memoized everything that matters** — derived state, tree building, filtered lists, callback props. Components don't re-render unless their actual data changed. Toolbar doesn't flinch when the sidebar updates.
- **Progress bar runs on the GPU now** — was animating `width` and `left` which triggers layout reflow every frame. Switched to `transform: translateX() scaleX()`. Composited, no jank.
- **Event listener cleanup actually works** — Tauri's `listen()` returns a promise. Old code pushed unlisten functions after resolve, so if the component unmounted fast enough they'd leak. Fixed.
- **Vite builds are tighter** — target `esnext` instead of es2021, manual chunks split React and Tauri into separate bundles

### Added

- **Live changelog on the landing page** — release notes page fetches `CHANGELOG.md` straight from this repo at runtime. One source of truth, no manual sync, no redeploy needed to update.

---

## v0.3.0

**2026-02-08** | [Compare](https://github.com/visualstudioblyat/bushido/compare/84a9d35...d4e31de)

### Added

- **Compact Mode** (`Ctrl+Shift+B`) — sidebar collapses to a peek strip, hover left edge to reveal. Toolbar auto-hides. Works even when a webpage has focus.
- **Workspaces** — colored dot switcher, `Ctrl+1-9` to jump, drag tabs between workspaces. Right-click to rename, recolor, delete.
- **Tab Search** — filter by title or URL
- **Tree Tabs** — nest tabs, collapse/expand branches, "open child tab" in context menu
- **Shield Whitelist** — click shield to disable blocking per-site, persisted to disk

### Theme

- Spring easing micro-interactions on tabs, buttons, pinned items
- Frosted glass context menus with `backdrop-filter: blur(24px)`
- Breathing glow on active tab indicator
- Rounded window corners, inset light borders, layered shadows
- Scrollbar thumb hidden until hover

### Changed

- Sidebar layout is now absolute-positioned with a flex spacer — no native resize calls on toggle
- Session format upgraded to workspace-aware (backwards compatible)
- Ad blocker conditionally injected per whitelist

---

## v0.2.0

**2026-02-08**

### Added

- Ad & tracker blocking (~1000 domains)
- Content blocker — fetch/XHR override, CSS hiding, DOM mutation observer
- Cookie banner auto-rejection (8+ frameworks)
- HTTPS-only mode
- Shield badge with blocked count
- Privacy headers, WebRTC leak prevention

---

## v0.1.0

**2026-02-07**

### Added

- Tauri v2 + React/TypeScript shell
- Tab management, pinning, drag reorder, context menus
- Sidebar, toolbar, URL bar, find in page
- Session save/restore
- Custom app icon
