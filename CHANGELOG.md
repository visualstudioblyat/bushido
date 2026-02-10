# Bushido — Changelog

---

## v0.6.0

**2026-02-10**

Chrome and Edge ship with basic ad blockers that catch maybe 30% of what you'd want blocked. Firefox relies on uBlock Origin — which is great until Manifest V3 finishes gutting extension APIs. Bushido now runs a real content blocking engine at the WebView2 COM level — 140,000+ filter rules from EasyList and EasyPrivacy, sub-millisecond matching, and it intercepts requests before the browser even starts the connection. No extension, no flag to enable, no way for page JavaScript to bypass it.

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
