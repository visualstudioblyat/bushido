import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Sidebar from "./components/Sidebar";
import WebviewPanel from "./components/WebviewPanel";
import FindBar from "./components/FindBar";
import HistoryPanel from "./components/HistoryPanel";
import DownloadPanel from "./components/DownloadPanel";
import NewTabPage from "./components/NewTabPage";
import SettingsPage from "./components/SettingsPage";
import CommandPalette from "./components/CommandPalette";
import SplitOverlay from "./components/SplitOverlay";
import { Tab, Workspace, SessionData, HistoryEntry, BookmarkData, FrecencyResult, BushidoSettings, DEFAULT_SETTINGS, DownloadItem, PaneRect, DividerInfo, WebPanel } from "./types";
import { allLeafIds, insertPane, removePane, computeRects, computeDividers, updateRatio, hasLeaf } from "./splitLayout";

const NTP_URL = "bushido://newtab";
const SETTINGS_URL = "bushido://settings";
const NEW_TAB_URL = NTP_URL;
const DEFAULT_WS_COLOR = "#6366f1";
const WS_COLORS = ["#6366f1", "#f43f5e", "#22c55e", "#f59e0b", "#06b6d4", "#a855f7", "#ec4899", "#14b8a6"];
const PANEL_W = 350;

// generate short ids
let tabCounter = Date.now();
const genId = (prefix = "tab") => `${prefix}-${++tabCounter}`;

let wsCounter = 0;
const genWsId = () => `ws-${++wsCounter}`;

function sanitizePanelUrl(input: string): string | null {
  const trimmed = input.trim().replace(/[\x00-\x1f\x7f]/g, "");
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const blocked = ["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "bushido:"];
  if (blocked.some(s => lower.startsWith(s))) return null;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (["javascript:", "data:", "file:"].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function frecencyScore(visitCount: number, lastVisitMs: number): number {
  const ageHours = (Date.now() - lastVisitMs) / 3_600_000;
  const w = ageHours < 4 ? 100 : ageHours < 24 ? 70 : ageHours < 72 ? 50 : ageHours < 336 ? 30 : 10;
  return visitCount * w;
}

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [bookmarkData, setBookmarkData] = useState<BookmarkData>({ bookmarks: [], folders: [] });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [urlQuery, setUrlQuery] = useState("");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [readerTabs, setReaderTabs] = useState<Set<string>>(new Set());
  const [readerSettings, setReaderSettings] = useState({ fontSize: 18, font: "serif" as "serif" | "sans", theme: "dark" as "dark" | "light" | "sepia", lineWidth: 680 });
  const [hasVideo, setHasVideo] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [settings, setSettings] = useState<BushidoSettings>({ ...DEFAULT_SETTINGS });
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [panels, setPanels] = useState<WebPanel[]>([]);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const urlBarRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);
  const settingsLoaded = useRef(false);
  const settingsRef = useRef(settings);
  const historyLoaded = useRef(false);
  const bookmarksLoaded = useRef(false);

  settingsRef.current = settings;

  const secArgs = useCallback((sr: BushidoSettings) => ({
    disableDevTools: sr.disableDevTools, disableStatusBar: sr.disableStatusBar,
    disableAutofill: sr.disableAutofill, disablePasswordSave: sr.disablePasswordSave,
    blockServiceWorkers: sr.blockServiceWorkers, blockFontEnum: sr.blockFontEnumeration,
    spoofHwConcurrency: sr.spoofHardwareConcurrency,
  }), []);

  // derived state (memoized to avoid recomputing on every render)
  const activeWs = useMemo(() => workspaces.find(w => w.id === activeWorkspaceId), [workspaces, activeWorkspaceId]);
  const activeTab = activeWs?.activeTabId || "";
  const paneLayout = activeWs?.paneLayout;
  const paneTabIds = useMemo(() => paneLayout ? allLeafIds(paneLayout) : [], [paneLayout]);
  const currentWsTabs = useMemo(() => tabs.filter(t => t.workspaceId === activeWorkspaceId), [tabs, activeWorkspaceId]);
  const sidebarW = compactMode ? 3 : sidebarOpen ? 300 : 54;
  const panelW = activePanelId && !compactMode ? PANEL_W : 0;
  const layoutOffset = sidebarW + panelW;
  const topOffset = 40;
  const pinnedTabs = useMemo(() => currentWsTabs.filter(t => t.pinned), [currentWsTabs]);
  const regularTabs = useMemo(() => currentWsTabs.filter(t => !t.pinned), [currentWsTabs]);

  // media mini player — find any tab with media state (prefer playing over paused)
  const playingTab = useMemo(() =>
    tabs.find(t => t.mediaState === "playing") || tabs.find(t => t.mediaState === "paused"),
  [tabs]);

  // clear loading after a delay since webview2 child events are unreliable
  const clearLoading = useCallback((tabId: string, ms = 2000) => {
    setTimeout(() => {
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, loading: false } : t));
    }, ms);
  }, []);

  // single function to position all pane webviews — replaces all switch_tab/resize_webviews calls
  const syncLayout = useCallback((ws?: Workspace, allTabs?: Tab[]) => {
    const w = ws || activeWs;
    if (!w) return;
    const cw = window.innerWidth - layoutOffset;
    const ch = window.innerHeight - topOffset;
    const rect = { x: 0, y: 0, w: cw, h: ch };

    let panes: PaneRect[];
    if (w.paneLayout) {
      panes = computeRects(w.paneLayout, rect);
    } else {
      const t = (allTabs || tabs).find(t => t.id === w.activeTabId);
      if (!t || t.url.startsWith("bushido://")) panes = [];
      else panes = [{ tabId: w.activeTabId, ...rect }];
    }

    invoke("layout_webviews", { panes, focusedTabId: w.activeTabId, sidebarW: layoutOffset, topOffset });
  }, [activeWs, tabs, layoutOffset, topOffset]);

  // restore session or create first tab
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // load settings first so create_tab can use them, then load session
    Promise.all([
      invoke<string>("load_settings"),
      invoke<string>("load_session"),
    ]).then(([settingsJson, json]) => {
      let s = { ...DEFAULT_SETTINGS };
      try {
        const p = JSON.parse(settingsJson);
        if (p && typeof p === "object") s = { ...s, ...p };
      } catch {}
      setSettings(s);
      settingsLoaded.current = true;

      const sa = { disableDevTools: s.disableDevTools, disableStatusBar: s.disableStatusBar, disableAutofill: s.disableAutofill, disablePasswordSave: s.disablePasswordSave, blockServiceWorkers: s.blockServiceWorkers, blockFontEnum: s.blockFontEnumeration, spoofHwConcurrency: s.spoofHardwareConcurrency };
      const tabArgs = { httpsOnly: s.httpsOnly, adBlocker: s.adBlocker, cookieAutoReject: s.cookieAutoReject, isPanel: false, ...sa };

      // helper: open a fresh NTP (no session restore)
      const openFreshNtp = () => {
        const wsId = genWsId();
        const id = genId();
        const ws: Workspace = { id: wsId, name: "Home", color: DEFAULT_WS_COLOR, activeTabId: id };
        const tab: Tab = { id, url: NTP_URL, title: "New Tab", loading: false, workspaceId: wsId, lastActiveAt: Date.now() };
        setWorkspaces([ws]);
        setTabs([tab]);
        setActiveWorkspaceId(wsId);
        setCompactMode(s.compactMode);
      };

      // if onStartup is "newtab", skip session restore
      if (s.onStartup === "newtab") {
        openFreshNtp();
        return;
      }

      let parsed: any = null;
      try { parsed = JSON.parse(json); } catch {}

      // detect session format
      if (parsed && parsed.workspaces && Array.isArray(parsed.workspaces)) {
        // new workspace format
        const session = parsed as SessionData;
        const restoredWs: Workspace[] = session.workspaces.map(w => {
          const num = parseInt(w.id.replace("ws-", ""), 10);
          if (num >= wsCounter) wsCounter = num;
          return { id: w.id, name: w.name, color: w.color, activeTabId: w.activeTabId, paneLayout: w.paneLayout };
        });

        // build ID remap: old stored ID → new ID (or reuse if stored)
        const idMap: Record<string, string> = {};
        const restoredTabs: Tab[] = session.tabs.map(st => {
          // reuse stored ID if available, otherwise generate new
          const id = (st as any).id || genId();
          // keep tabCounter ahead
          const num = parseInt(id.replace("tab-", ""), 10);
          if (!isNaN(num) && num >= tabCounter) tabCounter = num;
          idMap[(st as any).id || ""] = id;
          const isInternal = st.url.startsWith("bushido://");
          const isSuspended = st.suspended || false;
          return { id, url: st.url, title: (st.title || "Tab").replace(/<[^>]*>/g, ""), loading: !isInternal && !isSuspended, pinned: st.pinned, workspaceId: st.workspaceId, parentId: st.parentId, suspended: isSuspended, lastActiveAt: Date.now() };
        });

        // remap workspace references
        const tabIdSet = new Set(restoredTabs.map(t => t.id));
        restoredWs.forEach(ws => {
          // fix activeTabId
          if (!tabIdSet.has(ws.activeTabId)) {
            const wsTabs = restoredTabs.filter(t => t.workspaceId === ws.id);
            ws.activeTabId = wsTabs[0]?.id || "";
          }
          // paneLayout references are valid if tab IDs were stored — validate leaves
          if (ws.paneLayout) {
            const leafIds = allLeafIds(ws.paneLayout);
            if (!leafIds.every(id => tabIdSet.has(id))) {
              ws.paneLayout = undefined; // stale layout, drop it
            }
          }
        });

        const restoredCompact = session.compactMode || false;
        setWorkspaces(restoredWs);
        setTabs(restoredTabs);
        setActiveWorkspaceId(session.activeWorkspaceId);
        setCompactMode(restoredCompact);

        // create webviews for all restored tabs
        const restoredSidebarW = restoredCompact ? 3 : 300;
        const restoredTopOffset = 40;
        const firstActiveWs = restoredWs.find(w => w.id === session.activeWorkspaceId);
        restoredTabs.forEach(t => {
          if (!t.url.startsWith("bushido://") && !t.suspended) {
            invoke("create_tab", { id: t.id, url: t.url, sidebarW: restoredSidebarW, topOffset: restoredTopOffset, ...tabArgs });
            clearLoading(t.id);
          }
        });
        if (firstActiveWs?.activeTabId) {
          const activeRestoredTab = restoredTabs.find(t => t.id === firstActiveWs.activeTabId);
          if (activeRestoredTab?.url?.startsWith("bushido://")) {
            invoke("layout_webviews", { panes: [], focusedTabId: "__none__", sidebarW: restoredSidebarW, topOffset: restoredTopOffset });
          } else {
            // compute pane rects from restored layout
            const cw = window.innerWidth - restoredSidebarW;
            const ch = window.innerHeight - restoredTopOffset;
            const rect = { x: 0, y: 0, w: cw, h: ch };
            const panes = firstActiveWs.paneLayout
              ? computeRects(firstActiveWs.paneLayout, rect)
              : [{ tabId: firstActiveWs.activeTabId, x: 0, y: 0, w: cw, h: ch }];
            invoke("layout_webviews", { panes, focusedTabId: firstActiveWs.activeTabId, sidebarW: restoredSidebarW, topOffset: restoredTopOffset });
          }
        }

        // restore web panels
        if (session.panels?.length) {
          setPanels(session.panels);
          const panelArgs = { ...tabArgs, isPanel: true };
          session.panels.forEach(p => {
            invoke("create_tab", { id: p.id, url: p.url, sidebarW: restoredSidebarW, topOffset: restoredTopOffset, ...panelArgs })
              .then(() => invoke("register_panel", { id: p.id }))
              .then(() => invoke("position_panel", { id: p.id, x: -9999, y: 0, w: PANEL_W, h: 0 }));
          });
        }
      } else {
        // old flat array format or empty — migrate to workspace format
        let saved: { url: string; title: string; pinned?: boolean }[] = [];
        if (Array.isArray(parsed)) {
          saved = parsed;
        }

        const wsId = genWsId();
        const ws: Workspace = { id: wsId, name: "Home", color: DEFAULT_WS_COLOR, activeTabId: "" };

        if (saved.length > 0) {
          const restored: Tab[] = saved.map(st => {
            const id = genId();
            return { id, url: st.url, title: (st.title || "Tab").replace(/<[^>]*>/g, ""), loading: true, pinned: st.pinned, workspaceId: wsId };
          });
          ws.activeTabId = restored[0].id;
          setWorkspaces([ws]);
          setTabs(restored);
          setActiveWorkspaceId(wsId);

          restored.forEach(t => {
            invoke("create_tab", { id: t.id, url: t.url, sidebarW: 300, topOffset: 40, ...tabArgs });
            clearLoading(t.id);
          });
          invoke("layout_webviews", { panes: [{ tabId: restored[0].id, x: 0, y: 0, w: window.innerWidth - 300, h: window.innerHeight - 40 }], focusedTabId: restored[0].id, sidebarW: 300, topOffset: 40 });
        } else {
          openFreshNtp();
        }
      }
    });
  }, []);

  // save session when tabs/workspaces change (debounced)
  useEffect(() => {
    if (!initialized.current || tabs.length === 0) return;
    const t = setTimeout(() => {
      const session: SessionData = {
        workspaces: workspaces.map(w => ({ id: w.id, name: w.name, color: w.color, activeTabId: w.activeTabId, paneLayout: w.paneLayout })),
        tabs: tabs.map(tab => ({ id: tab.id, url: tab.url, title: tab.title, pinned: tab.pinned, workspaceId: tab.workspaceId, parentId: tab.parentId, suspended: tab.suspended })),
        activeWorkspaceId,
        compactMode,
        panels: panels.map(p => ({ id: p.id, url: p.url, title: p.title, favicon: p.favicon })),
      };
      invoke("save_session", { tabs: JSON.stringify(session) });
    }, 1000);
    return () => clearTimeout(t);
  }, [tabs, workspaces, activeWorkspaceId, compactMode, panels]);

  // load history + bookmarks on init
  useEffect(() => {
    invoke<string>("load_history").then(json => {
      try { const p = JSON.parse(json); if (Array.isArray(p)) setHistoryEntries(p); } catch {}
      historyLoaded.current = true;
    });
  }, []);

  useEffect(() => {
    invoke<string>("load_bookmarks").then(json => {
      try { const p = JSON.parse(json); if (p?.bookmarks) setBookmarkData(p); } catch {}
      bookmarksLoaded.current = true;
    });
  }, []);

  // settings are loaded in the init effect above (before session restore)

  // save history debounced
  useEffect(() => {
    if (!historyLoaded.current) return;
    const t = setTimeout(() => invoke("save_history", { data: JSON.stringify(historyEntries) }), 2000);
    return () => clearTimeout(t);
  }, [historyEntries]);

  // save bookmarks debounced
  useEffect(() => {
    if (!bookmarksLoaded.current) return;
    const t = setTimeout(() => invoke("save_bookmarks", { data: JSON.stringify(bookmarkData) }), 1000);
    return () => clearTimeout(t);
  }, [bookmarkData]);

  // save settings debounced
  useEffect(() => {
    if (!settingsLoaded.current) return;
    const t = setTimeout(() => invoke("save_settings", { data: JSON.stringify(settings) }), 500);
    return () => clearTimeout(t);
  }, [settings]);

  // record history from navigation events
  const recordHistory = useCallback((url: string, title: string, favicon?: string) => {
    if (!historyLoaded.current || url.startsWith("bushido://") || !url.startsWith("http")) return;
    const now = Date.now();
    setHistoryEntries(prev => {
      const idx = prev.findIndex(h => h.url === url);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], title: title || updated[idx].title, favicon: favicon || updated[idx].favicon, lastVisitAt: now, visitCount: updated[idx].visitCount + 1 };
        return updated;
      }
      const next = [{ url, title, favicon, visitCount: 1, lastVisitAt: now }, ...prev];
      if (next.length > 10000) next.length = 10000;
      return next;
    });
  }, []);

  // listen for webview events from rust
  useEffect(() => {
    const promises = [
      listen<{ id: string; url: string }>("tab-url-changed", (e) => {
        let favicon: string | undefined;
        let domain = "";
        try {
          const host = new URL(e.payload.url).hostname;
          if (host) favicon = `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
          domain = host;
        } catch {}
        setTabs(prev => prev.map(t => t.id === e.payload.id ? { ...t, url: e.payload.url, favicon } : t));
        setPanels(prev => prev.map(p => p.id === e.payload.id ? { ...p, url: e.payload.url, favicon } : p));
        recordHistory(e.payload.url, "", favicon);
        if (domain) {
          invoke<boolean>("is_whitelisted", { domain }).then(wl => {
            setTabs(prev => prev.map(t => t.id === e.payload.id ? { ...t, whitelisted: wl } : t));
          });
        }
      }),
      listen<{ id: string; title: string }>("tab-title-changed", (e) => {
        const clean = e.payload.title.replace(/<[^>]*>/g, "");
        setTabs(prev => {
          const tab = prev.find(t => t.id === e.payload.id);
          if (tab) {
            setHistoryEntries(hp => hp.map(h => h.url === tab.url ? { ...h, title: clean } : h));
          }
          return prev.map(t => t.id === e.payload.id ? { ...t, title: clean, loading: false } : t);
        });
        setPanels(prev => prev.map(p => p.id === e.payload.id ? { ...p, title: clean } : p));
      }),
      listen<{ id: string; loading: boolean }>("tab-loading", (e) => {
        setTabs(prev => prev.map(t => t.id === e.payload.id ? { ...t, loading: e.payload.loading } : t));
      }),
      listen<{ id: string; count: number }>("tab-blocked-count", (e) => {
        setTabs(prev => prev.map(t =>
          t.id === e.payload.id ? { ...t, blockedCount: e.payload.count } : t
        ));
      }),
      listen<{ id: string; hasVideo: boolean }>("tab-has-video", (e) => {
        setHasVideo(e.payload.hasVideo);
      }),
      listen<{ id: string; state: string; title: string }>("tab-media-state", (e) => {
        setTabs(prev => prev.map(t =>
          t.id === e.payload.id
            ? { ...t, mediaState: e.payload.state === "ended" ? undefined : e.payload.state as "playing" | "paused", mediaTitle: e.payload.title.replace(/<[^>]*>/g, "") }
            : t
        ));
      }),
      listen<{ id: string }>("tab-crashed", (e) => {
        setTabs(prev => prev.map(t =>
          t.id === e.payload.id ? { ...t, crashed: true, loading: false } : t
        ));
      }),
      // download events
      listen<{ url: string; suggestedFilename: string; cookies?: string }>("download-intercepted", (e) => {
        const dir = settingsRef.current.downloadLocation || "";
        invoke("start_download", { url: e.payload.url, filename: e.payload.suggestedFilename, downloadDir: dir, cookies: e.payload.cookies || null });
        setDownloadsOpen(true);
      }),
      listen<DownloadItem>("download-started", (e) => {
        setDownloads(prev => {
          if (prev.find(d => d.id === e.payload.id)) return prev;
          return [e.payload, ...prev];
        });
      }),
      listen<DownloadItem>("download-progress", (e) => {
        setDownloads(prev => prev.map(d => d.id === e.payload.id ? e.payload : d));
      }),
      listen<DownloadItem>("download-complete", (e) => {
        setDownloads(prev => prev.map(d => d.id === e.payload.id ? e.payload : d));
      }),
      listen<DownloadItem>("download-failed", (e) => {
        setDownloads(prev => prev.map(d => d.id === e.payload.id ? e.payload : d));
      }),
      listen<{ id: string }>("download-cancelled", (e) => {
        setDownloads(prev => prev.filter(d => d.id !== e.payload.id));
      }),
    ];

    // load existing downloads on init
    invoke<DownloadItem[]>("get_downloads").then(items => {
      if (items.length > 0) setDownloads(items);
    }).catch(() => {});

    return () => { promises.forEach(p => p.then(u => u())); };
  }, []);

  // panel positioning
  const positionActivePanel = useCallback(() => {
    if (!activePanelId || compactMode) return;
    const h = window.innerHeight - topOffset;
    invoke("position_panel", { id: activePanelId, x: sidebarW, y: topOffset, w: PANEL_W, h });
  }, [activePanelId, sidebarW, topOffset, compactMode]);

  // resize webviews when sidebar/topOffset changes
  // delay so CSS transition (300ms) completes before native resize (blocks compositor)
  useEffect(() => {
    if (!activeTab) return;
    const t = setTimeout(() => { syncLayout(); positionActivePanel(); }, 320);
    return () => clearTimeout(t);
  }, [sidebarW, topOffset, paneLayout, positionActivePanel]);

  useEffect(() => {
    if (!activeTab) return;
    const handler = () => { syncLayout(); positionActivePanel(); };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [activeTab, paneLayout, syncLayout, positionActivePanel]);

  // reposition active panel when it changes
  useEffect(() => {
    positionActivePanel();
  }, [positionActivePanel]);

  // hide panel webview when entering compact mode
  useEffect(() => {
    if (compactMode && activePanelId) {
      invoke("position_panel", { id: activePanelId, x: -9999, y: 0, w: PANEL_W, h: 0 });
    }
  }, [compactMode]);

  // sync compactMode setting ↔ state
  useEffect(() => {
    if (!settingsLoaded.current) return;
    if (settings.compactMode !== compactMode) {
      setCompactMode(settings.compactMode);
    }
  }, [settings.compactMode]);

  // tab suspender — check every 60s, suspend tabs after configured timeout
  useEffect(() => {
    if (settings.suspendTimeout === 0) return; // disabled
    const timeoutMs = settings.suspendTimeout * 60 * 1000;
    const interval = setInterval(() => {
      const now = Date.now();
      setTabs(prev => {
        let changed = false;
        const next = prev.map(t => {
          if (t.id === activeTab || paneTabIds.includes(t.id)) return t;
          if (t.pinned) return t;
          if (t.suspended) return t;
          if (t.url.startsWith("bushido://")) return t;
          const lastActive = t.lastActiveAt || 0;
          if (now - lastActive > timeoutMs) {
            invoke("close_tab", { id: t.id });
            changed = true;
            return { ...t, suspended: true, loading: false };
          }
          return t;
        });
        return changed ? next : prev;
      });
    }, 60_000);
    return () => clearInterval(interval);
  }, [activeTab, paneTabIds, settings.suspendTimeout]);

  // --- workspace operations ---

  const switchWorkspace = useCallback((wsId: string) => {
    setActiveWorkspaceId(wsId);
    setWorkspaces(prev => {
      const ws = prev.find(w => w.id === wsId);
      if (ws?.activeTabId) syncLayout(ws);
      return prev;
    });
  }, [syncLayout]);

  const addWorkspace = useCallback(() => {
    const wsId = genWsId();
    const tabId = genId();
    const colorIdx = workspaces.length % WS_COLORS.length;
    const ws: Workspace = { id: wsId, name: `Space ${workspaces.length + 1}`, color: WS_COLORS[colorIdx], activeTabId: tabId };
    const tab: Tab = { id: tabId, url: NEW_TAB_URL, title: "New Tab", loading: true, workspaceId: wsId };

    setWorkspaces(prev => [...prev, ws]);
    setTabs(prev => [...prev, tab]);
    setActiveWorkspaceId(wsId);
    const sr = settingsRef.current;
    invoke("create_tab", { id: tabId, url: NEW_TAB_URL, sidebarW: layoutOffset, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, ...secArgs(sr) });
    clearLoading(tabId);
  }, [workspaces.length, clearLoading, layoutOffset, topOffset]);

  const deleteWorkspace = useCallback((wsId: string) => {
    // can't delete last workspace
    if (workspaces.length <= 1) return;

    // close all webviews in this workspace
    const wsTabs = tabs.filter(t => t.workspaceId === wsId);
    wsTabs.forEach(t => invoke("close_tab", { id: t.id }));

    setTabs(prev => prev.filter(t => t.workspaceId !== wsId));
    setWorkspaces(prev => {
      const next = prev.filter(w => w.id !== wsId);
      if (activeWorkspaceId === wsId && next.length > 0) {
        const newActive = next[0];
        setActiveWorkspaceId(newActive.id);
        if (newActive.activeTabId) syncLayout(newActive);
      }
      return next;
    });
  }, [workspaces.length, tabs, activeWorkspaceId, syncLayout]);

  const renameWorkspace = useCallback((wsId: string, name: string) => {
    setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, name } : w));
  }, []);

  const recolorWorkspace = useCallback((wsId: string, color: string) => {
    setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, color } : w));
  }, []);

  const moveTabToWorkspace = useCallback((tabId: string, targetWsId: string) => {
    setTabs(prev => {
      const tab = prev.find(t => t.id === tabId);
      if (!tab) return prev;
      const sourceWsId = tab.workspaceId;
      const next = prev.map(t => t.id === tabId ? { ...t, workspaceId: targetWsId, parentId: undefined } : t);

      // if moved tab was active in source workspace, switch to adjacent
      setWorkspaces(wsList => wsList.map(w => {
        if (w.id === sourceWsId && w.activeTabId === tabId) {
          const remaining = next.filter(t => t.workspaceId === sourceWsId);
          const newActiveId = remaining.length > 0 ? remaining[0].id : "";
          // remove from pane layout if present
          let newLayout = w.paneLayout;
          if (newLayout && hasLeaf(newLayout, tabId)) {
            newLayout = removePane(newLayout, tabId) || undefined;
          }
          const updated = { ...w, activeTabId: newActiveId, paneLayout: newLayout };
          if (sourceWsId === activeWorkspaceId && newActiveId) syncLayout(updated, next);
          return updated;
        }
        if (w.id === targetWsId) {
          return { ...w, activeTabId: tabId };
        }
        return w;
      }));

      return next;
    });
  }, [activeWorkspaceId, syncLayout]);

  // --- tab operations (workspace-aware) ---

  const addTab = useCallback((url = NEW_TAB_URL, parentId?: string) => {
    const id = genId();
    const isInternal = url.startsWith("bushido://");
    const title = url === SETTINGS_URL ? "Settings" : "New Tab";
    const tab: Tab = { id, url, title, loading: !isInternal, workspaceId: activeWorkspaceId, parentId, lastActiveAt: Date.now() };
    setTabs(prev => [...prev, tab]);
    setWorkspaces(prev => prev.map(w => w.id === activeWorkspaceId ? { ...w, activeTabId: id, paneLayout: undefined } : w));
    if (!isInternal) {
      const sr = settingsRef.current;
      const cw = window.innerWidth - layoutOffset;
      const ch = window.innerHeight - topOffset;
      invoke("create_tab", { id, url, sidebarW: layoutOffset, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, ...secArgs(sr) }).then(() => {
        invoke("layout_webviews", { panes: [{ tabId: id, x: 0, y: 0, w: cw, h: ch }], focusedTabId: id, sidebarW: layoutOffset, topOffset });
      });
      clearLoading(id);
    } else {
      // hide all webviews since internal pages are React-rendered
      invoke("layout_webviews", { panes: [], focusedTabId: "__none__", sidebarW: layoutOffset, topOffset });
    }
  }, [activeWorkspaceId, clearLoading, layoutOffset, topOffset]);

  const closeTab = useCallback((id: string) => {
    invoke("close_tab", { id });
    setTabs(prev => {
      const tab = prev.find(t => t.id === id);
      if (!tab) return prev;
      const wsId = tab.workspaceId;
      const wsTabs = prev.filter(t => t.workspaceId === wsId);
      const next = prev.filter(t => t.id !== id).map(t =>
        t.parentId === id ? { ...t, parentId: tab.parentId } : t
      );

      if (wsTabs.length <= 1) {
        const newId = genId();
        const newTab: Tab = { id: newId, url: NTP_URL, title: "New Tab", loading: false, workspaceId: wsId, lastActiveAt: Date.now() };
        invoke("layout_webviews", { panes: [], focusedTabId: "__none__", sidebarW: layoutOffset, topOffset });
        setWorkspaces(ws => ws.map(w => w.id === wsId ? { ...w, activeTabId: newId, paneLayout: undefined } : w));
        return [...next, newTab];
      }

      setWorkspaces(ws => ws.map(w => {
        if (w.id !== wsId) return w;

        // tab was in a pane layout
        if (w.paneLayout && hasLeaf(w.paneLayout, id)) {
          const newLayout = removePane(w.paneLayout, id);
          // removePane returns null if ≤1 leaf remains → exit split
          const newActive = w.activeTabId === id
            ? (newLayout ? allLeafIds(newLayout).find(lid => lid !== id) || "" : allLeafIds(w.paneLayout).find(lid => lid !== id) || "")
            : w.activeTabId;
          const updated = { ...w, activeTabId: newActive, paneLayout: newLayout || undefined };
          if (wsId === activeWorkspaceId) syncLayout(updated, next);
          return updated;
        }

        // closed the active tab (no split) → switch to adjacent
        if (w.activeTabId === id) {
          const wsTabsInNext = next.filter(t => t.workspaceId === wsId);
          const oldIdx = wsTabs.findIndex(t => t.id === id);
          const newActive = wsTabsInNext[Math.min(oldIdx, wsTabsInNext.length - 1)];
          const updated = { ...w, activeTabId: newActive?.id || "" };
          if (wsId === activeWorkspaceId) syncLayout(updated, next);
          return updated;
        }

        return w;
      }));

      return next;
    });
  }, [activeWorkspaceId, layoutOffset, topOffset, syncLayout]);

  const selectTab = useCallback((id: string) => {
    const targetTab = tabs.find(t => t.id === id);
    const ws = workspaces.find(w => w.id === activeWorkspaceId);
    const isInternal = targetTab?.url === NTP_URL || targetTab?.url === SETTINGS_URL;

    setTabs(prev => prev.map(t => t.id === id ? { ...t, lastActiveAt: Date.now() } : t));

    // if tab is already in a pane, just change focus (no layout change)
    if (ws?.paneLayout && hasLeaf(ws.paneLayout, id) && !isInternal) {
      const updated = { ...ws, activeTabId: id };
      setWorkspaces(prev => prev.map(w => w.id === activeWorkspaceId ? updated : w));
      syncLayout(updated);
      return;
    }

    // internal pages exit split
    const newLayout = isInternal ? undefined : ws?.paneLayout;
    const updated = { ...ws!, activeTabId: id, paneLayout: newLayout };
    setWorkspaces(prev => prev.map(w => w.id === activeWorkspaceId ? updated : w));

    if (targetTab?.crashed) {
      // recreate crashed webview
      const sr = settingsRef.current;
      invoke("close_tab", { id }).then(() =>
        invoke("create_tab", { id, url: targetTab.url, sidebarW: layoutOffset, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, ...secArgs(sr) })
      ).then(() => syncLayout(updated));
      clearLoading(id);
      setTabs(prev => prev.map(t => t.id === id ? { ...t, crashed: false, loading: true, lastActiveAt: Date.now() } : t));
    } else if (targetTab?.suspended) {
      const sr = settingsRef.current;
      invoke("create_tab", { id, url: targetTab.url, sidebarW: layoutOffset, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, ...secArgs(sr) }).then(() => {
        syncLayout(updated);
      });
      clearLoading(id);
      setTabs(prev => prev.map(t => t.id === id ? { ...t, suspended: false, loading: true, lastActiveAt: Date.now() } : t));
    } else if (isInternal) {
      invoke("layout_webviews", { panes: [], focusedTabId: "__none__", sidebarW: layoutOffset, topOffset });
    } else {
      syncLayout(updated);
    }
  }, [activeWorkspaceId, tabs, workspaces, layoutOffset, topOffset, clearLoading, syncLayout]);

  const pinTab = useCallback((id: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, pinned: !t.pinned } : t));
  }, []);

  const toggleCollapse = useCallback((id: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, collapsed: !t.collapsed } : t));
  }, []);

  const reorderTabs = useCallback((from: number, to: number) => {
    setTabs(prev => {
      const wsTabs = prev.filter(t => t.workspaceId === activeWorkspaceId && !t.pinned);
      const otherTabs = prev.filter(t => t.workspaceId !== activeWorkspaceId || t.pinned);
      const item = wsTabs[from];
      if (!item) return prev;
      wsTabs.splice(from, 1);
      wsTabs.splice(to, 0, item);
      // rebuild: pinned first within ws, then unpinned, then other ws tabs
      const wsPinned = prev.filter(t => t.workspaceId === activeWorkspaceId && t.pinned);
      return [...wsPinned, ...wsTabs, ...otherTabs.filter(t => t.workspaceId !== activeWorkspaceId)];
    });
  }, [activeWorkspaceId]);

  const getSearchUrl = useCallback((query: string) => {
    const q = encodeURIComponent(query);
    switch (settings.searchEngine) {
      case "duckduckgo": return `https://duckduckgo.com/?q=${q}`;
      case "brave": return `https://search.brave.com/search?q=${q}`;
      case "bing": return `https://www.bing.com/search?q=${q}`;
      case "custom": return settings.customSearchUrl ? settings.customSearchUrl.replace("%s", q) : `https://www.google.com/search?q=${q}`;
      default: return `https://www.google.com/search?q=${q}`;
    }
  }, [settings.searchEngine, settings.customSearchUrl]);

  const navigate = useCallback((url: string) => {
    if (!activeTab) return;
    let finalUrl = url;
    if (!/^https?:\/\//i.test(url)) {
      if (/\.\w{2,}/.test(url)) {
        finalUrl = "https://" + url;
      } else {
        finalUrl = getSearchUrl(url);
      }
    }
    const currentTab = tabs.find(t => t.id === activeTab);
    setTabs(prev => prev.map(t => t.id === activeTab ? { ...t, url: finalUrl, loading: true, blockedCount: 0 } : t));
    if (currentTab?.url?.startsWith("bushido://") || currentTab?.suspended) {
      const sr = settingsRef.current;
      invoke("create_tab", { id: activeTab, url: finalUrl, sidebarW: layoutOffset, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, ...secArgs(sr) }).then(() => {
        // directly position — syncLayout would read stale tab URL from state
        const cw = window.innerWidth - layoutOffset;
        const ch = window.innerHeight - topOffset;
        invoke("layout_webviews", { panes: [{ tabId: activeTab, x: 0, y: 0, w: cw, h: ch }], focusedTabId: activeTab, sidebarW: layoutOffset, topOffset });
      });
      if (currentTab?.suspended) {
        setTabs(prev => prev.map(t => t.id === activeTab ? { ...t, suspended: false } : t));
      }
    } else {
      invoke("navigate_tab", { id: activeTab, url: finalUrl });
    }
    clearLoading(activeTab, 3000);
  }, [activeTab, tabs, clearLoading, layoutOffset, topOffset, syncLayout]);

  // split view — toggle or split with a specific tab, optional side
  const toggleSplit = useCallback((targetId?: string, side: "left" | "right" | "top" | "bottom" = "right") => {
    const ws = workspaces.find(w => w.id === activeWorkspaceId);
    if (!ws) return;

    // already split → exit
    if (ws.paneLayout) {
      const updated = { ...ws, paneLayout: undefined };
      setWorkspaces(prev => prev.map(w => w.id === activeWorkspaceId ? updated : w));
      syncLayout(updated);
      return;
    }

    // find a tab to split with
    const wsTabs = tabs.filter(t => t.workspaceId === activeWorkspaceId && !t.url.startsWith("bushido://") && !t.suspended);
    let splitWith = targetId;
    if (!splitWith) {
      const candidates = wsTabs.filter(t => t.id !== ws.activeTabId).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0));
      splitWith = candidates[0]?.id;
    }
    if (!splitWith || splitWith === ws.activeTabId) return;

    // can't split if active tab is internal
    const activeT = tabs.find(t => t.id === ws.activeTabId);
    if (activeT?.url.startsWith("bushido://")) return;

    const newLayout = insertPane(null, ws.activeTabId, splitWith, side);
    if (!newLayout) return;
    const updated = { ...ws, paneLayout: newLayout };
    setWorkspaces(prev => prev.map(w => w.id === activeWorkspaceId ? updated : w));
    syncLayout(updated);
  }, [workspaces, activeWorkspaceId, tabs, syncLayout]);

  // --- divider drag ---
  const [draggingDiv, setDraggingDiv] = useState<number | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  // compute dividers from current layout
  const dividers = useMemo((): DividerInfo[] => {
    if (!paneLayout) return [];
    const cw = window.innerWidth - layoutOffset;
    const ch = window.innerHeight - topOffset;
    return computeDividers(paneLayout, { x: 0, y: 0, w: cw, h: ch });
  }, [paneLayout, layoutOffset, topOffset]);

  const onDividerDown = useCallback((idx: number, e: React.MouseEvent) => {
    e.preventDefault();
    setDraggingDiv(idx);
    const div = dividers[idx];
    if (!div) return;
    let lastPos = div.dir === "row" ? e.clientX : e.clientY;
    const dimension = div.dir === "row" ? window.innerWidth - layoutOffset : window.innerHeight - topOffset;
    let rafId = 0;
    let pendingDelta = 0;
    let currentLayout = workspaces.find(w => w.id === activeWorkspaceId)?.paneLayout;
    if (!currentLayout) return;

    // hide webviews so mousemove fires over the whole area (native webviews steal pointer)
    invoke("layout_webviews", { panes: [], focusedTabId: "__none__", sidebarW: layoutOffset, topOffset });

    const tick = () => {
      rafId = 0;
      if (!currentLayout || pendingDelta === 0) return;
      currentLayout = updateRatio(currentLayout, div.path, div.childIdx, pendingDelta);
      pendingDelta = 0;
    };

    const onMove = (me: MouseEvent) => {
      const currentPos = div.dir === "row" ? me.clientX : me.clientY;
      pendingDelta += (currentPos - lastPos) / dimension;
      lastPos = currentPos;
      if (!rafId) rafId = requestAnimationFrame(tick);
    };

    const onUp = () => {
      if (rafId) cancelAnimationFrame(rafId);
      setDraggingDiv(null);
      if (currentLayout) {
        const finalLayout = currentLayout;
        setWorkspaces(prev => prev.map(w =>
          w.id === activeWorkspaceId ? { ...w, paneLayout: finalLayout } : w
        ));
        // show webviews at final positions
        const cw = window.innerWidth - layoutOffset;
        const ch = window.innerHeight - topOffset;
        const panes = computeRects(finalLayout, { x: 0, y: 0, w: cw, h: ch });
        const focusId = workspaces.find(w => w.id === activeWorkspaceId)?.activeTabId || "";
        invoke("layout_webviews", { panes, focusedTabId: focusId, sidebarW: layoutOffset, topOffset });
      }
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [dividers, workspaces, activeWorkspaceId, layoutOffset, topOffset]);

  // drag-to-split not feasible — WebView2 child windows are native OS windows that
  // intercept all mouse/drag events. Use context menu "split with this tab" or Ctrl+\ instead.

  const current = useMemo(() => tabs.find(t => t.id === activeTab), [tabs, activeTab]);
  const showNtp = current?.url === NTP_URL;
  const showSettings = current?.url === SETTINGS_URL;
  const showInternalPage = showNtp || showSettings;

  const toggleWhitelist = useCallback(() => {
    if (!activeTab) return;
    const tab = tabs.find(t => t.id === activeTab);
    if (!tab) return;
    let domain = "";
    try { domain = new URL(tab.url).hostname; } catch {}
    if (!domain) return;
    invoke<boolean>("toggle_whitelist", { domain }).then(whitelisted => {
      setTabs(prev => prev.map(t => t.id === activeTab ? { ...t, whitelisted } : t));
      invoke("reload_tab", { id: activeTab });
    });
  }, [activeTab, tabs]);

  // --- bookmark operations ---

  const addBookmark = useCallback((url: string, title: string, favicon?: string, folderId = "") => {
    const id = `bm-${Date.now()}`;
    setBookmarkData(prev => ({
      ...prev,
      bookmarks: [...prev.bookmarks, { id, url, title, favicon, folderId, createdAt: Date.now() }],
    }));
  }, []);

  const removeBookmark = useCallback((id: string) => {
    setBookmarkData(prev => ({
      ...prev,
      bookmarks: prev.bookmarks.filter(b => b.id !== id),
    }));
  }, []);

  const bookmarkedUrls = useMemo(() => new Set(bookmarkData.bookmarks.map(b => b.url)), [bookmarkData.bookmarks]);

  const toggleBookmark = useCallback(() => {
    if (!current) return;
    const existing = bookmarkData.bookmarks.find(b => b.url === current.url);
    if (existing) removeBookmark(existing.id);
    else addBookmark(current.url, current.title, current.favicon);
  }, [current, bookmarkData.bookmarks, addBookmark, removeBookmark]);

  const clearHistory = useCallback((range: 'hour' | 'today' | 'all') => {
    if (range === 'all') { setHistoryEntries([]); return; }
    const cutoff = range === 'hour' ? Date.now() - 3600_000 : new Date().setHours(0, 0, 0, 0);
    setHistoryEntries(prev => prev.filter(h => h.lastVisitAt < cutoff));
  }, []);

  const selectBookmark = useCallback((url: string) => {
    if (!activeTab) return;
    navigate(url);
  }, [activeTab, navigate]);

  // top sites — 8 most frecent, deduplicated by domain, with defaults
  const topSites = useMemo((): FrecencyResult[] => {
    const domainMap = new Map<string, FrecencyResult>();
    for (const h of historyEntries) {
      let domain = "";
      try { domain = new URL(h.url).hostname; } catch { continue; }
      const score = frecencyScore(h.visitCount, h.lastVisitAt);
      const existing = domainMap.get(domain);
      if (!existing || score > existing.score) {
        domainMap.set(domain, { url: h.url, title: h.title || domain, favicon: h.favicon, score, type: 'history' });
      }
    }
    const sites = Array.from(domainMap.values()).sort((a, b) => b.score - a.score).slice(0, 8);
    // fill with defaults if history is sparse
    if (sites.length < 8) {
      const defaults: FrecencyResult[] = [
        { url: "https://www.google.com", title: "Google", favicon: "https://www.google.com/s2/favicons?domain=google.com&sz=32", score: 0, type: "history" },
        { url: "https://www.youtube.com", title: "YouTube", favicon: "https://www.google.com/s2/favicons?domain=youtube.com&sz=32", score: 0, type: "history" },
        { url: "https://github.com", title: "GitHub", favicon: "https://www.google.com/s2/favicons?domain=github.com&sz=32", score: 0, type: "history" },
        { url: "https://www.reddit.com", title: "Reddit", favicon: "https://www.google.com/s2/favicons?domain=reddit.com&sz=32", score: 0, type: "history" },
        { url: "https://en.wikipedia.org", title: "Wikipedia", favicon: "https://www.google.com/s2/favicons?domain=wikipedia.org&sz=32", score: 0, type: "history" },
        { url: "https://twitter.com", title: "X", favicon: "https://www.google.com/s2/favicons?domain=twitter.com&sz=32", score: 0, type: "history" },
      ];
      const existing = new Set(sites.map(s => { try { return new URL(s.url).hostname; } catch { return ""; } }));
      for (const d of defaults) {
        if (sites.length >= 8) break;
        const host = new URL(d.url).hostname;
        if (!existing.has(host)) { sites.push(d); existing.add(host); }
      }
    }
    return sites;
  }, [historyEntries]);

  // frecency suggestions for URL bar
  const suggestions = useMemo((): FrecencyResult[] => {
    if (!urlQuery || urlQuery.length < 2) return [];
    const q = urlQuery.toLowerCase();
    const map = new Map<string, FrecencyResult>();

    for (const h of historyEntries) {
      if (h.url.toLowerCase().includes(q) || h.title.toLowerCase().includes(q)) {
        map.set(h.url, { url: h.url, title: h.title, favicon: h.favicon, score: frecencyScore(h.visitCount, h.lastVisitAt), type: 'history' });
      }
    }
    for (const b of bookmarkData.bookmarks) {
      if (b.url.toLowerCase().includes(q) || b.title.toLowerCase().includes(q)) {
        const s = frecencyScore(1, b.createdAt) + 200;
        const existing = map.get(b.url);
        if (!existing || s > existing.score) map.set(b.url, { url: b.url, title: b.title, favicon: b.favicon, score: s, type: 'bookmark' });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.score - a.score).slice(0, 8);
  }, [urlQuery, historyEntries, bookmarkData.bookmarks]);

  const onSuggestionSelect = useCallback((url: string) => {
    navigate(url);
    setUrlQuery("");
  }, [navigate]);

  const onUrlInputChange = useCallback((query: string) => {
    setUrlQuery(query);
  }, []);

  const toggleHistory = useCallback(() => setHistoryOpen(p => !p), []);

  // --- reader mode ---
  const toggleReader = useCallback(() => {
    if (!activeTab) return;
    const tab = tabs.find(t => t.id === activeTab);
    if (!tab || tab.url.startsWith("bushido://") || tab.suspended) return;

    invoke("toggle_reader", {
      id: activeTab,
      fontSize: readerSettings.fontSize,
      font: readerSettings.font,
      theme: readerSettings.theme,
      lineWidth: readerSettings.lineWidth,
    });

    setReaderTabs(prev => {
      const next = new Set(prev);
      if (next.has(activeTab)) next.delete(activeTab);
      else next.add(activeTab);
      return next;
    });
  }, [activeTab, tabs, readerSettings]);

  const updateReaderSettings = useCallback((update: Partial<typeof readerSettings>) => {
    setReaderSettings(prev => ({ ...prev, ...update }));
  }, []);

  // --- picture in picture ---
  const togglePip = useCallback(() => {
    if (!activeTab) return;
    invoke("toggle_pip", { id: activeTab });
  }, [activeTab]);

  // detect videos on current page
  useEffect(() => {
    if (!activeTab) return;
    const tab = tabs.find(t => t.id === activeTab);
    if (!tab || tab.url.startsWith("bushido://") || tab.suspended) {
      setHasVideo(false);
      setPipActive(false);
      return;
    }
    const detectVideo = () => {
      invoke("detect_video", { id: activeTab });
    };
    // poll every 3s for up to 30s — YouTube/video sites load lazily
    const interval = setInterval(detectVideo, 3000);
    const stop = setTimeout(() => clearInterval(interval), 30000);
    return () => { clearInterval(interval); clearTimeout(stop); };
  }, [activeTab, current?.url]);

  const onOpenSettings = useCallback(() => {
    const existing = tabs.find(t => t.url === SETTINGS_URL);
    if (existing) {
      selectTab(existing.id);
      return;
    }
    addTab(SETTINGS_URL);
  }, [tabs, selectTab, addTab]);

  const executeAction = useCallback((action: string) => {
    switch (action) {
      case "action-new-tab": addTab(); break;
      case "action-close-tab": closeTab(activeTab); break;
      case "action-toggle-compact": setCompactMode(p => { const next = !p; setSettings(s => ({ ...s, compactMode: next })); return next; }); break;
      case "action-toggle-sidebar": setSidebarOpen(p => !p); break;
      case "action-settings": onOpenSettings(); break;
      case "action-reader-mode": toggleReader(); break;
      case "action-clear-history": clearHistory("all"); break;
      case "action-history": setHistoryOpen(true); break;
      case "action-bookmark": toggleBookmark(); break;
    }
  }, [addTab, closeTab, activeTab, clearHistory, toggleBookmark, onOpenSettings, toggleReader]);

  // keyboard shortcuts (works when React UI has focus)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "t") { e.preventDefault(); addTab(); }
      if (ctrl && e.key === "w") { e.preventDefault(); closeTab(activeTab); }
      if (ctrl && e.key === "l") { e.preventDefault(); urlBarRef.current?.focus(); urlBarRef.current?.select(); }
      if (ctrl && e.shiftKey && e.key === "B") { e.preventDefault(); setCompactMode(p => { const next = !p; setSettings(s => ({ ...s, compactMode: next })); return next; }); }
      if (ctrl && e.key === "b" && !e.shiftKey) { e.preventDefault(); setSidebarOpen(p => !p); }
      if (ctrl && e.key === "f") { e.preventDefault(); setFindOpen(true); }
      if (ctrl && e.key === "k") { e.preventDefault(); setCmdOpen(p => !p); }
      if (ctrl && e.shiftKey && e.key === "R") { e.preventDefault(); toggleReader(); }
      if (ctrl && e.key === "d" && !e.shiftKey) { e.preventDefault(); toggleBookmark(); }
      if (ctrl && e.key === "h" && !e.shiftKey) { e.preventDefault(); setHistoryOpen(p => !p); }
      // Ctrl+Tab cycles tabs within current workspace
      if (ctrl && e.key === "Tab") {
        e.preventDefault();
        const wsTabs = currentWsTabs;
        if (wsTabs.length === 0) return;
        const idx = wsTabs.findIndex(t => t.id === activeTab);
        const next = e.shiftKey
          ? (idx - 1 + wsTabs.length) % wsTabs.length
          : (idx + 1) % wsTabs.length;
        selectTab(wsTabs[next].id);
      }
      // Ctrl+1-9 switches workspaces
      if (ctrl && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < workspaces.length) switchWorkspace(workspaces[idx].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [addTab, closeTab, activeTab, currentWsTabs, workspaces, selectTab, switchWorkspace, toggleBookmark, toggleReader]);

  // global shortcut bridge: Rust eval() calls this directly on the main webview
  // also handles child webview shortcuts forwarded via title encoding → global-shortcut event
  useEffect(() => {
    (window as any).__bushidoGlobalShortcut = (action: string) => {
      switch (action) {
        case "toggle-compact": setCompactMode(p => { const next = !p; setSettings(s => ({ ...s, compactMode: next })); return next; }); break;
        case "toggle-sidebar": setSidebarOpen(p => !p); break;
        case "bookmark": toggleBookmark(); break;
        case "history": setHistoryOpen(p => !p); break;
        case "new-tab": addTab(); break;
        case "close-tab": closeTab(activeTab); break;
        case "focus-url": urlBarRef.current?.focus(); urlBarRef.current?.select(); break;
        case "find": setFindOpen(true); break;
        case "command-palette": setCmdOpen(p => !p); break;
        case "reader-mode": toggleReader(); break;
        case "split-view": toggleSplit(); break;
      }
    };
    return () => { delete (window as any).__bushidoGlobalShortcut; };
  }, [toggleBookmark, addTab, closeTab, activeTab, toggleSplit]);

  // listen for child webview shortcut bridge events
  useEffect(() => {
    const p = listen<string>("global-shortcut", (e) => {
      const fn = (window as any).__bushidoGlobalShortcut;
      if (fn) fn(e.payload);
    });
    return () => { p.then(u => u()); };
  }, []);

  // stable callbacks for child components (prevents re-renders from new arrow refs)
  const toggleSidebar = useCallback(() => setSidebarOpen(p => !p), []);
  const addChildTab = useCallback((parentId: string) => addTab(NEW_TAB_URL, parentId), [addTab]);
  const goBack = useCallback(() => invoke("go_back", { id: activeTab }), [activeTab]);
  const goForward = useCallback(() => invoke("go_forward", { id: activeTab }), [activeTab]);
  const goReload = useCallback(() => invoke("reload_tab", { id: activeTab }), [activeTab]);
  const closeFindBar = useCallback(() => setFindOpen(false), []);

  // download callbacks
  const pauseDownload = useCallback((id: string) => invoke("pause_download", { id }), []);
  const resumeDownload = useCallback((id: string) => invoke("resume_download", { id }), []);
  const cancelDownload = useCallback((id: string) => invoke("cancel_download", { id }), []);
  const openDownload = useCallback((id: string) => invoke("open_download", { id }), []);
  const openDownloadFolder = useCallback((id: string) => invoke("open_download_folder", { id }), []);
  const retryDownload = useCallback((id: string) => {
    const dl = downloads.find(d => d.id === id);
    if (!dl) return;
    cancelDownload(id);
    const dir = settingsRef.current.downloadLocation || "";
    invoke("start_download", { url: dl.url, filename: dl.fileName, downloadDir: dir, cookies: null });
  }, [downloads, cancelDownload]);
  const clearCompletedDownloads = useCallback(() => {
    setDownloads(prev => prev.filter(d => d.state !== "completed"));
  }, []);
  const toggleDownloads = useCallback(() => setDownloadsOpen(p => !p), []);
  const activeDownloadCount = useMemo(() => downloads.filter(d => d.state === "downloading").length, [downloads]);

  // media controls
  const mediaPlayPause = useCallback(() => {
    if (playingTab) invoke("media_play_pause", { id: playingTab.id });
  }, [playingTab]);
  const mediaMute = useCallback(() => {
    if (playingTab) invoke("media_mute", { id: playingTab.id });
  }, [playingTab]);

  const togglePanel = useCallback((panelId: string) => {
    if (activePanelId === panelId) {
      invoke("position_panel", { id: panelId, x: -9999, y: 0, w: PANEL_W, h: 0 });
      setActivePanelId(null);
    } else {
      if (activePanelId) {
        invoke("position_panel", { id: activePanelId, x: -9999, y: 0, w: PANEL_W, h: 0 });
      }
      setActivePanelId(panelId);
    }
  }, [activePanelId]);

  const addPanel = useCallback((rawUrl: string) => {
    const url = sanitizePanelUrl(rawUrl);
    if (!url) return;
    if (panels.some(p => p.url === url)) return;
    const id = genId("panel");
    let favicon: string | undefined;
    try { favicon = `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`; } catch {}
    setPanels(prev => [...prev, { id, url, title: url, favicon }]);
    const sr = settingsRef.current;
    invoke("create_tab", { id, url, sidebarW, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: true, ...secArgs(sr) })
      .then(() => invoke("register_panel", { id }));
    setActivePanelId(id);
  }, [sidebarW, topOffset, panels]);

  const removePanel = useCallback((panelId: string) => {
    invoke("unregister_panel", { id: panelId }).then(() => invoke("close_tab", { id: panelId }));
    setPanels(prev => prev.filter(p => p.id !== panelId));
    if (activePanelId === panelId) setActivePanelId(null);
  }, [activePanelId]);

  const reloadAllTabs = useCallback(() => {
    const sr = settingsRef.current;
    const base = { httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, ...secArgs(sr) };
    tabs.forEach(t => {
      if (t.url.startsWith("bushido://") || t.suspended) return;
      invoke("close_tab", { id: t.id }).then(() => {
        invoke("create_tab", { id: t.id, url: t.url, sidebarW: layoutOffset, topOffset, isPanel: false, ...base });
      });
    });
    panels.forEach(p => {
      invoke("close_tab", { id: p.id }).then(() => {
        invoke("create_tab", { id: p.id, url: p.url, sidebarW: layoutOffset, topOffset, isPanel: true, ...base })
          .then(() => invoke("register_panel", { id: p.id }));
      });
    });
    setTimeout(() => {
      const ws = workspaces.find(w => w.id === activeWorkspaceId);
      if (ws) syncLayout(ws);
    }, 500);
  }, [tabs, panels, layoutOffset, topOffset, secArgs, workspaces, activeWorkspaceId, syncLayout]);

  const updateSettings = useCallback((patch: Partial<BushidoSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      // sync compactMode toggle from settings to app state
      if ("compactMode" in patch && patch.compactMode !== compactMode) {
        setCompactMode(patch.compactMode!);
      }
      return next;
    });
  }, [compactMode]);
  const minimizeWindow = useCallback(() => invoke("minimize_window"), []);
  const maximizeWindow = useCallback(() => invoke("maximize_window"), []);
  const closeWindow = useCallback(() => invoke("close_window"), []);

  return (
    <div className="browser">
      {cmdOpen && (
        <CommandPalette
          tabs={tabs}
          bookmarks={bookmarkData.bookmarks}
          history={historyEntries}
          sidebarW={sidebarW}
          onSelectTab={(id) => { selectTab(id); setCmdOpen(false); }}
          onNavigate={(url) => { navigate(url); setCmdOpen(false); }}
          onAction={(action) => { executeAction(action); setCmdOpen(false); }}
          onClose={() => setCmdOpen(false)}
        />
      )}
      <div className="titlebar" data-tauri-drag-region>
        <div className="titlebar-title">{current?.title || "Bushido"}</div>
        <div className="titlebar-controls">
          <button className="win-btn" onClick={minimizeWindow} title="Minimize">
            <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
          </button>
          <button className="win-btn" onClick={maximizeWindow} title="Maximize">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1"/></svg>
          </button>
          <button className="win-btn win-close" onClick={closeWindow} title="Close">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
        </div>
      </div>

      <div className="browser-body">
        <Sidebar
          tabs={regularTabs}
          pinnedTabs={pinnedTabs}
          activeTab={activeTab}
          open={sidebarOpen}
          compact={compactMode}
          onSelect={selectTab}
          onClose={closeTab}
          onPin={pinTab}
          onNew={addTab}
          onReorder={reorderTabs}
          onToggle={toggleSidebar}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSwitchWorkspace={switchWorkspace}
          onAddWorkspace={addWorkspace}
          onDeleteWorkspace={deleteWorkspace}
          onRenameWorkspace={renameWorkspace}
          onRecolorWorkspace={recolorWorkspace}
          onToggleCollapse={toggleCollapse}
          onAddChildTab={addChildTab}
          onMoveTabToWorkspace={moveTabToWorkspace}
          bookmarks={bookmarkData.bookmarks}
          bookmarkFolders={bookmarkData.folders}
          onSelectBookmark={selectBookmark}
          onRemoveBookmark={removeBookmark}
          onToggleHistory={toggleHistory}
          onBack={goBack}
          onForward={goForward}
          onReload={goReload}
          url={current?.url || ""}
          onNavigate={navigate}
          loading={current?.loading || false}
          inputRef={urlBarRef}
          blockedCount={current?.blockedCount || 0}
          whitelisted={current?.whitelisted || false}
          onToggleWhitelist={toggleWhitelist}
          suggestions={suggestions}
          topSites={topSites}
          onSuggestionSelect={onSuggestionSelect}
          onInputChange={onUrlInputChange}
          isBookmarked={current ? bookmarkedUrls.has(current.url) : false}
          onToggleBookmark={toggleBookmark}
          onToggleReader={toggleReader}
          isReaderActive={readerTabs.has(activeTab)}
          readerSettings={readerSettings}
          onUpdateReaderSettings={updateReaderSettings}
          hasVideo={hasVideo}
          pipActive={pipActive}
          onTogglePip={togglePip}
          onOpenSettings={onOpenSettings}
          activeDownloadCount={activeDownloadCount}
          onToggleDownloads={toggleDownloads}
          paneTabIds={paneTabIds}
          onSplitWith={toggleSplit}
          playingTab={playingTab}
          onMediaPlayPause={mediaPlayPause}
          onMediaMute={mediaMute}
          panels={panels}
          activePanelId={activePanelId}
          onTogglePanel={togglePanel}
          onAddPanel={addPanel}
          onRemovePanel={removePanel}
        />
        {historyOpen && (
          <HistoryPanel
            history={historyEntries}
            onSelect={(url: string) => { selectBookmark(url); setHistoryOpen(false); }}
            onClose={toggleHistory}
            onClear={clearHistory}
          />
        )}
        {downloadsOpen && (
          <DownloadPanel
            downloads={downloads}
            onPause={pauseDownload}
            onResume={resumeDownload}
            onCancel={cancelDownload}
            onOpen={openDownload}
            onOpenFolder={openDownloadFolder}
            onClearCompleted={clearCompletedDownloads}
            onClose={toggleDownloads}
            onRetry={retryDownload}
          />
        )}
        <div className={`sidebar-spacer ${compactMode ? "compact" : sidebarOpen ? "" : "collapsed"}`} />
        {panelW > 0 && <div style={{ width: panelW, flexShrink: 0 }} />}
        <div className="main" ref={mainRef}>
          {findOpen && activeTab && !showInternalPage && (
            <FindBar tabId={activeTab} onClose={closeFindBar} />
          )}
          {showNtp ? (
            <NewTabPage
              topSites={settings.showTopSites ? topSites : []}
              onNavigate={navigate}
              onSelectSite={(url) => navigate(url)}
              showClock={settings.showClock}
              showGreeting={settings.showGreeting}
            />
          ) : showSettings ? (
            <SettingsPage
              settings={settings}
              onUpdate={updateSettings}
              onReloadAllTabs={reloadAllTabs}
            />
          ) : (
            <WebviewPanel />
          )}
          {dividers.length > 0 && (
            <SplitOverlay
              dividers={dividers}
              draggingDiv={draggingDiv}
              onDividerDown={onDividerDown}
            />
          )}
        </div>
      </div>
    </div>
  );
}
