# Bushido — Changelog

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
