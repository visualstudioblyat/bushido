<p align="center">
  <img src="logo.png" alt="Bushido Logo" width="128" height="128">
</p>

<h1 align="center">Bushido Browser</h1>

<p align="center">
  <strong>Browse with Discipline.</strong>
</p>

<p align="center">
  <a href="https://github.com/visualstudioblyat/bushido/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/visualstudioblyat/bushido?style=flat-square&color=6366f1"></a>
  <a href="https://github.com/visualstudioblyat/bushido/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/visualstudioblyat/bushido?style=flat-square&color=6366f1"></a>
  <a href="https://github.com/visualstudioblyat/bushido/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/visualstudioblyat/bushido?style=flat-square&color=6366f1"></a>
  <a href="https://github.com/visualstudioblyat/bushido/issues"><img alt="Issues" src="https://img.shields.io/github/issues/visualstudioblyat/bushido?style=flat-square&color=6366f1"></a>
</p>

<p align="center">
  Bushido is a privacy-first browser built on Tauri with native ad blocking, cookie banner rejection, and HTTPS-only mode — no extensions needed.
</p>

<p align="center">
  <a href="https://github.com/visualstudioblyat/bushido/releases">Download</a> •
  <a href="https://github.com/visualstudioblyat/bushido/issues">Report Bug</a> •
  <a href="https://github.com/visualstudioblyat/bushido/discussions">Feature Request</a>
</p>

---

## Why Bushido?

Google killed ad blockers with Manifest V3. Bushido doesn't care — blocking is built into the browser core, not an extension that can be neutered.

- **Native Ad & Tracker Blocking** — 140,000+ filter rules from EasyList and EasyPrivacy, matched in under 0.05ms per request. Blocking happens at the WebView2 network level before connections are established — page JavaScript can't bypass it.
- **Cookie Banner Rejection** — Automatically clicks "Reject All" on consent popups across 8+ frameworks. You never see them.
- **HTTPS-Only Mode** — All traffic upgraded to HTTPS. HTTP connections are refused.
- **Download Manager** — Parallel chunked downloads (up to 6 segments), crash recovery via manifest files, cookie-aware authenticated downloads. Pause, resume, retry. Built into the browser, no extension needed.
- **Zen-Style Vertical Sidebar** — Nav buttons, URL bar, workspaces, tabs — all in one vertical sidebar. Drag, pin, reorder, tree tabs. Session restore built in.
- **Command Palette** (`Ctrl+K`) — Fuzzy search tabs, bookmarks, history, and actions from one input.
- **Reader Mode** (`Ctrl+Shift+R`) — Strip pages to just text and images. Pick font, theme, line width.
- **Picture-in-Picture** — Video detection + one-click PiP. Shadow DOM button injection so sites can't block it.
- **Tab Suspender** — Inactive tabs auto-suspend after 5 minutes. Webview destroyed, memory freed, click to restore.
- **Minimal UI** — No bloat, no crypto wallets, no AI assistants, no sponsored tiles.

## Tech Stack

| Layer | Tech |
|-------|------|
| Binary Size: | ~6MB (utilizing system native webview).
| Shell | [Tauri v2](https://v2.tauri.app/) (Rust) |
| Frontend | React + TypeScript |
| Rendering | System WebView (WebView2 / WebKit) |
| Ad Blocking | adblock-rust engine + WebView2 COM interception |
| Downloads | Rust async + parallel chunked byte-range segments |

## Building from Source

```bash
# prerequisites: node.js, rust, tauri cli
npm install
npx tauri dev
```

For a production build:

```bash
npm run tauri build
```

The installer lands in `src-tauri/target/release/bundle/`.

## Contributing

Bushido is open source under the [MPL 2.0](LICENSE) license. Contributions welcome — open an issue or submit a PR.

## Roadmap

- [x] ~~Workspaces~~ — shipped in v0.3.0
- [x] ~~History & Bookmarks~~ — shipped in v0.4.0
- [x] ~~Command Palette, Reader Mode, PiP, Tab Suspender~~ — shipped in v0.5.0
- [x] ~~Download Manager with parallel chunks~~ — shipped in v0.5.2
- [x] ~~adblock-rust engine (EasyList + EasyPrivacy)~~ — shipped in v0.6.0
- [x] ~~Split View~~ — shipped in v0.6.1
- [ ] Web Panels — persistent sidebar webviews (ChatGPT, Slack, etc.)
- [ ] Boosts — per-site CSS/JS injection
- [ ] Fingerprint protection
- [ ] Custom themes
- [ ] Cross-platform builds (macOS, Linux)
