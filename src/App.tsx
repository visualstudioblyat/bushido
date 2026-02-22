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
import ScreenshotOverlay from "./components/ScreenshotOverlay";
import AnnotationEditor from "./components/AnnotationEditor";
import ShareMenu from "./components/ShareMenu";
import Onboarding from "./components/Onboarding";
import GlanceOverlay from "./components/GlanceOverlay";
import { Tab, Workspace, SessionData, HistoryEntry, BookmarkData, FrecencyResult, BushidoSettings, DEFAULT_SETTINGS, DownloadItem, PaneRect, DividerInfo, WebPanel, DropZone, PermissionRequest } from "./types";
import { allLeafIds, insertPane, removePane, computeRects, computeDividers, updateRatio, hasLeaf, detectDropZone } from "./splitLayout";
import { useTabStore } from "./store/tabStore";
import { useUiStore } from "./store/uiStore";
import { useDataStore } from "./store/dataStore";
import { useFeatureStore } from "./store/featureStore";
import { useVaultStore } from "./store/vaultStore";
import { useSyncStore } from "./store/syncStore";

// blocked URL schemes — defense-in-depth (Rust side also blocks these)
const BLOCKED_SCHEMES = ["javascript:", "data:", "file:", "vbscript:", "blob:", "ms-msdt:", "search-ms:", "ms-officecmd:"];
const isSafeUrl = (url: string) => !BLOCKED_SCHEMES.some(s => url.toLowerCase().startsWith(s));

// clamp a popup menu to viewport edges
function useClampedMenu(menuRef: React.RefObject<HTMLDivElement | null>, anchor: { x: number; y: number } | null) {
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  useEffect(() => {
    if (!anchor) return;
    setPos({ top: -9999, left: -9999 });
    requestAnimationFrame(() => {
      const el = menuRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pad = 8;
      const left = Math.max(pad, Math.min(anchor.x, window.innerWidth - rect.width - pad));
      const top = Math.max(pad, Math.min(anchor.y, window.innerHeight - rect.height - pad));
      setPos({ top, left });
    });
  }, [anchor, menuRef]);
  return pos;
}

interface PageCtxMenu {
  x: number; y: number;
  kind: "page" | "image" | "selection" | "audio" | "video";
  linkUri: string; sourceUri: string; selectionText: string;
  pageUri: string; isEditable: boolean; tabId: string;
}

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

const PERM_LABELS: Record<string, string> = {
  microphone: "microphone", camera: "camera", geolocation: "location",
  notifications: "notifications", othersensors: "sensors", clipboardread: "clipboard",
  filereadwrite: "file access", autoplay: "autoplay", midi: "MIDI devices",
  windowmanagement: "window management", unknown: "a permission",
};

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
  // --- Zustand stores ---
  const tabs = useTabStore(s => s.tabs);
  const setTabs = useTabStore(s => s.setTabs);
  const workspaces = useTabStore(s => s.workspaces);
  const setWorkspaces = useTabStore(s => s.setWorkspaces);
  const activeWorkspaceId = useTabStore(s => s.activeWorkspaceId);
  const setActiveWorkspaceId = useTabStore(s => s.setActiveWorkspaceId);

  const sidebarOpen = useUiStore(s => s.sidebarOpen);
  const setSidebarOpen = useUiStore(s => s.setSidebarOpen);
  const compactMode = useUiStore(s => s.compactMode);
  const setCompactMode = useUiStore(s => s.setCompactMode);
  const findOpen = useUiStore(s => s.findOpen);
  const setFindOpen = useUiStore(s => s.setFindOpen);
  const historyOpen = useUiStore(s => s.historyOpen);
  const setHistoryOpen = useUiStore(s => s.setHistoryOpen);
  const cmdOpen = useUiStore(s => s.cmdOpen);
  const setCmdOpen = useUiStore(s => s.setCmdOpen);
  const downloadsOpen = useUiStore(s => s.downloadsOpen);
  const setDownloadsOpen = useUiStore(s => s.setDownloadsOpen);
  const showOnboarding = useUiStore(s => s.showOnboarding);
  const setShowOnboarding = useUiStore(s => s.setShowOnboarding);
  const urlQuery = useUiStore(s => s.urlQuery);
  const setUrlQuery = useUiStore(s => s.setUrlQuery);
  const pageCtx = useUiStore(s => s.pageCtx);
  const setPageCtx = useUiStore(s => s.setPageCtx);
  const errorToast = useUiStore(s => s.errorToast);
  const showError = useUiStore(s => s.showError);

  const historyEntries = useDataStore(s => s.historyEntries);
  const setHistoryEntries = useDataStore(s => s.setHistoryEntries);
  const bookmarkData = useDataStore(s => s.bookmarkData);
  const setBookmarkData = useDataStore(s => s.setBookmarkData);
  const downloads = useDataStore(s => s.downloads);
  const setDownloads = useDataStore(s => s.setDownloads);
  const settings = useDataStore(s => s.settings);
  const setSettings = useDataStore(s => s.setSettings);

  const screenshotPreview = useFeatureStore(s => s.screenshotPreview);
  const setScreenshotPreview = useFeatureStore(s => s.setScreenshotPreview);
  const annotationData = useFeatureStore(s => s.annotationData);
  const setAnnotationData = useFeatureStore(s => s.setAnnotationData);
  const shareOpen = useFeatureStore(s => s.shareOpen);
  const setShareOpen = useFeatureStore(s => s.setShareOpen);
  const readerTabs = useFeatureStore(s => s.readerTabs);
  const setReaderTabs = useFeatureStore(s => s.setReaderTabs);
  const readerSettings = useFeatureStore(s => s.readerSettings);
  const setReaderSettings = useFeatureStore(s => s.setReaderSettings);
  const hasVideo = useFeatureStore(s => s.hasVideo);
  const setHasVideo = useFeatureStore(s => s.setHasVideo);
  const pipActive = useFeatureStore(s => s.pipActive);
  const setPipActive = useFeatureStore(s => s.setPipActive);
  const panels = useFeatureStore(s => s.panels);
  const setPanels = useFeatureStore(s => s.setPanels);
  const activePanelId = useFeatureStore(s => s.activePanelId);
  const setActivePanelId = useFeatureStore(s => s.setActivePanelId);
  const glance = useFeatureStore(s => s.glance);
  const setGlance = useFeatureStore(s => s.setGlance);

  const vaultSavePrompt = useVaultStore(s => s.vaultSavePrompt);
  const setVaultSavePrompt = useVaultStore(s => s.setVaultSavePrompt);
  const vaultMasterModal = useVaultStore(s => s.vaultMasterModal);
  const setVaultMasterModal = useVaultStore(s => s.setVaultMasterModal);
  const vaultUnlocked = useVaultStore(s => s.vaultUnlocked);
  const setVaultUnlocked = useVaultStore(s => s.setVaultUnlocked);
  const permReq = useVaultStore(s => s.permReq);
  const setPermReq = useVaultStore(s => s.setPermReq);
  const permRemember = useVaultStore(s => s.permRemember);
  const setPermRemember = useVaultStore(s => s.setPermRemember);

  const syncToast = useSyncStore(s => s.syncToast);
  const setSyncToast = useSyncStore(s => s.setSyncToast);
  const syncTabReceived = useSyncStore(s => s.syncTabReceived);
  const setSyncTabReceived = useSyncStore(s => s.setSyncTabReceived);
  const syncPairedDevices = useSyncStore(s => s.syncPairedDevices);
  const setSyncPairedDevices = useSyncStore(s => s.setSyncPairedDevices);

  const vaultUnlockedRef = useRef(false);
  const vaultSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glanceRef = useRef<typeof glance>(null);
  const syncToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlBarRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);
  const settingsLoaded = useRef(false);
  const settingsRef = useRef(settings);
  const historyLoaded = useRef(false);
  const bookmarksLoaded = useRef(false);
  const bookmarkBulkRef = useRef(false);
  const prevSettingsRef = useRef<BushidoSettings | null>(null);
  const closedTabsRef = useRef<{url: string; title: string; workspaceId: string}[]>([]);
  const zoomRef = useRef<Record<string, number>>({});
  const pageCtxRef = useRef<HTMLDivElement>(null);
  const pageCtxPos = useClampedMenu(pageCtxRef, pageCtx);
  useEffect(() => {
    if (!pageCtx) return;
    requestAnimationFrame(() => {
      pageCtxRef.current?.querySelector<HTMLElement>(".ctx-item")?.focus();
    });
  }, [pageCtx]);

  settingsRef.current = settings;
  vaultUnlockedRef.current = vaultUnlocked;

  const secArgs = useCallback((sr: BushidoSettings) => ({
    disableDevTools: sr.disableDevTools, disableStatusBar: sr.disableStatusBar,
    disableAutofill: sr.disableAutofill, disablePasswordSave: sr.disablePasswordSave,
    blockServiceWorkers: sr.blockServiceWorkers, blockFontEnum: sr.blockFontEnumeration,
    spoofHwConcurrency: sr.spoofHardwareConcurrency,
  }), []);

  const applyTheme = useCallback((accent: string, mode: "dark" | "light") => {
    const root = document.documentElement;
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-soft", accent.replace(")", ", 0.1)").replace("rgb", "rgba").replace("#", ""));
    // derive soft/glow from hex
    const r = parseInt(accent.slice(1, 3), 16), g = parseInt(accent.slice(3, 5), 16), b = parseInt(accent.slice(5, 7), 16);
    if (!isNaN(r)) {
      root.style.setProperty("--accent-soft", `rgba(${r}, ${g}, ${b}, 0.1)`);
      root.style.setProperty("--accent-glow", `rgba(${r}, ${g}, ${b}, 0.15)`);
      root.style.setProperty("--accent-mesh-1", `rgba(${r}, ${g}, ${b}, 0.06)`);
      root.style.setProperty("--accent-mesh-2", `rgba(${r}, ${g}, ${b}, 0.04)`);
      root.style.setProperty("--accent-mesh-3", `rgba(${r}, ${g}, ${b}, 0.03)`);
    }
    if (mode === "light") root.classList.add("light");
    else root.classList.remove("light");
  }, []);

  // derived state (memoized to avoid recomputing on every render)
  const activeWs = useMemo(() => workspaces.find(w => w.id === activeWorkspaceId), [workspaces, activeWorkspaceId]);
  const activeTab = activeWs?.activeTabId || "";
  const paneLayout = activeWs?.paneLayout;
  const paneTabIds = useMemo(() => paneLayout ? allLeafIds(paneLayout) : [], [paneLayout]);
  const currentWsTabs = useMemo(() => tabs.filter(t => t.workspaceId === activeWorkspaceId), [tabs, activeWorkspaceId]);
  const sidebarW = compactMode ? 3 : sidebarOpen ? 300 : 54;
  const panelW = activePanelId && !compactMode ? PANEL_W : 0;
  const layoutOffset = sidebarW + panelW;
  const layoutOffsetRef = useRef(layoutOffset);
  layoutOffsetRef.current = layoutOffset;
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

      // apply saved theme
      applyTheme(s.accentColor || "#6366f1", s.themeMode || "dark");

      // apply bandwidth limit from settings
      if (s.bandwidthLimit) {
        invoke("set_bandwidth_limit", { limit: s.bandwidthLimit });
      }

      // if onboarding hasn't been completed, show it and skip session restore
      if (!s.onboardingComplete) {
        setShowOnboarding(true);
        // still set up a default workspace so the app has something after onboarding
        const wsId = genWsId();
        const id = genId();
        const ws: Workspace = { id: wsId, name: "Home", color: DEFAULT_WS_COLOR, activeTabId: id };
        const tab: Tab = { id, url: NTP_URL, title: "New Tab", loading: false, workspaceId: wsId, lastActiveAt: Date.now() };
        setWorkspaces([ws]);
        setTabs([tab]);
        setActiveWorkspaceId(wsId);
        return;
      }

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
          return { id, url: st.url, title: (st.title || "Tab").replace(/<[^>]*>/g, ""), loading: !isInternal && !isSuspended, pinned: st.pinned, workspaceId: st.workspaceId, parentId: st.parentId, suspended: isSuspended, memoryState: isSuspended ? "destroyed" as const : "active" as const, lastActiveAt: Date.now() };
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
            invoke("create_tab", { id: t.id, url: t.url, sidebarW: restoredSidebarW, topOffset: restoredTopOffset, profileName: t.workspaceId, ...tabArgs });
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
            invoke("create_tab", { id: t.id, url: t.url, sidebarW: 300, topOffset: 40, profileName: t.workspaceId, ...tabArgs });
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
      invoke("save_session", { tabs: JSON.stringify(session) }).catch(() => showError("Failed to save session"));
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
      try {
        const p = JSON.parse(json);
        if (p?.bookmarks) {
          // backfill order field for existing bookmarks that don't have it
          p.bookmarks = p.bookmarks.map((b: any, i: number) => ({ ...b, order: b.order ?? i }));
          if (p.folders) p.folders = p.folders.map((f: any, i: number) => ({ ...f, order: f.order ?? i }));
          setBookmarkData(p);
        }
      } catch {}
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

  // save bookmarks debounced (skip when sync enabled — surgical commands handle Loro persistence)
  useEffect(() => {
    if (!bookmarksLoaded.current) return;
    if (settings.syncEnabled && !bookmarkBulkRef.current) return;
    bookmarkBulkRef.current = false;
    const t = setTimeout(() => invoke("save_bookmarks", { data: JSON.stringify(bookmarkData) }), 1000);
    return () => clearTimeout(t);
  }, [bookmarkData, settings.syncEnabled]);

  // save settings debounced
  useEffect(() => {
    if (!settingsLoaded.current) return;
    const t = setTimeout(() => invoke("save_settings", { data: JSON.stringify(settings) }), 500);
    return () => clearTimeout(t);
  }, [settings]);

  // sync settings to CRDT — diff only changed keys (React optimization)
  useEffect(() => {
    if (!settingsLoaded.current || !settings.syncEnabled) return;
    const prev = prevSettingsRef.current;
    if (prev) {
      const keys = Object.keys(settings) as (keyof BushidoSettings)[];
      keys.forEach(key => {
        if (settings[key] !== prev[key]) {
          invoke("sync_write_setting", { key, value: JSON.stringify(settings[key]) }).catch(() => {});
        }
      });
    }
    prevSettingsRef.current = { ...settings };
  }, [settings]);

  // fetch paired devices for sidebar send-tab feature
  useEffect(() => {
    if (!settings.syncEnabled) { setSyncPairedDevices([]); return; }
    const fetch = () => {
      invoke<{ enabled: boolean; paired_devices: { device_id: string; name: string }[] }>("get_sync_status")
        .then(info => setSyncPairedDevices(info.paired_devices || []))
        .catch(() => {});
    };
    fetch();
    const unlisten = listen("pair-complete", fetch);
    return () => { unlisten.then(u => u()); };
  }, [settings.syncEnabled]);

  // sync open tabs every 30s
  useEffect(() => {
    if (!settings.syncEnabled) return;
    const sync = () => {
      const tabsForSync = tabs.filter(t => t.memoryState !== "destroyed")
        .map(t => ({ id: t.id, url: t.url, title: t.title, favicon: t.favicon }));
      invoke("sync_write_tabs", { tabs: JSON.stringify(tabsForSync) }).catch(() => {});
    };
    sync();
    const iv = setInterval(sync, 30000);
    return () => clearInterval(iv);
  }, [settings.syncEnabled, tabs]);

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
    // sync history to CRDT (fire-and-forget)
    if (settingsRef.current.syncEnabled) {
      invoke("sync_add_history", { url, title: title || "", favicon: favicon || null, timestamp: now }).catch(() => {});
    }
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
        // update glance URL if this is the glance webview
        if (glanceRef.current && e.payload.id === glanceRef.current.id) {
          glanceRef.current = { ...glanceRef.current, url: e.payload.url };
          setGlance(prev => prev && prev.id === e.payload.id ? { ...prev, url: e.payload.url } : prev);
        }
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
        // update glance title if this is the glance webview
        if (glanceRef.current && e.payload.id === glanceRef.current.id) {
          glanceRef.current = { ...glanceRef.current, title: clean };
          setGlance(prev => prev && prev.id === e.payload.id ? { ...prev, title: clean } : prev);
        }
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
        const routing = settingsRef.current.mimeRouting || [];
        invoke("start_download", { url: e.payload.url, filename: e.payload.suggestedFilename, downloadDir: dir, cookies: e.payload.cookies || null, mimeRouting: routing });
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
      // sync: reload bookmarks when remote changes arrive
      listen("sync-bookmarks-changed", () => {
        console.log("[sync] sync-bookmarks-changed event received, reloading...");
        invoke<string>("load_bookmarks").then(json => {
          console.log("[sync] load_bookmarks returned:", json?.substring(0, 300));
          try { const p = JSON.parse(json); if (p?.bookmarks) { console.log("[sync] setting bookmarkData:", p.bookmarks.length, "bookmarks,", p.folders.length, "folders"); setBookmarkData(p); } } catch (e) { console.error("[sync] parse error:", e); }
        }).catch(e => console.error("[sync] load_bookmarks failed:", e));
      }),
      // sync: activity indicator
      listen<string>("sync-activity", (e) => {
        const state = e.payload as "syncing" | "success" | "error";
        setSyncToast(state);
        if (syncToastTimer.current) clearTimeout(syncToastTimer.current);
        if (state !== "syncing") {
          syncToastTimer.current = setTimeout(() => setSyncToast(null), 2500);
        }
      }),
      // sync: merge remote history
      listen("sync-history-changed", () => {
        // history is additive from CRDT — no merge needed, local state is source of truth
        // remote entries appear on next full reload from load_history
      }),
      // sync: apply remote settings
      listen("sync-settings-changed", () => {
        // reload settings from disk to pick up remotely-synced keys
        invoke<string>("load_settings").then(json => {
          try {
            const remote = JSON.parse(json);
            setSettings(prev => {
              const merged = { ...prev };
              // only apply universal (non-device-local) keys
              const deviceLocal = new Set(["compactMode", "suspendTimeout", "downloadLocation", "askDownloadLocation", "onStartup", "syncDeviceName", "syncEnabled", "onboardingComplete"]);
              for (const key of Object.keys(remote)) {
                if (!deviceLocal.has(key) && remote[key] !== undefined) {
                  (merged as any)[key] = remote[key];
                }
              }
              return merged;
            });
          } catch {}
        }).catch(() => {});
      }),
      // sync: tab received from another device
      listen<{ from_device: string; url: string; title: string }>("tab-received", (e) => {
        setSyncTabReceived(e.payload);
        setTimeout(() => setSyncTabReceived(null), 8000);
      }),
      // page context menu (right-click on web content)
      listen<any>("webview-context-menu", (e) => {
        const p = e.payload;
        setPageCtx({
          x: p.x + layoutOffsetRef.current,
          y: p.y + topOffset,
          kind: p.kind,
          linkUri: p.linkUri || "",
          sourceUri: p.sourceUri || "",
          selectionText: p.selectionText || "",
          pageUri: p.pageUri || "",
          isEditable: !!p.isEditable,
          tabId: p.id,
        });
      }),
      // permission prompt from webview
      listen<PermissionRequest>("permission-requested", (e) => {
        setPermReq(e.payload);
        setPermRemember(true);
      }),
      // vault save prompt from autofill script
      // glance: ephemeral link preview
      listen<{ url: string; sourceTabId: string }>("glance-request", (e) => {
        if (glanceRef.current) return; // already showing a glance
        const glanceId = `glance-${Date.now()}`;
        const g = { id: glanceId, url: e.payload.url, title: e.payload.url, sourceTabId: e.payload.sourceTabId };
        glanceRef.current = g;
        setGlance(g);
        setTabs(prev => {
          const src = prev.find(t => t.id === e.payload.sourceTabId);
          invoke("open_glance", { url: e.payload.url, glanceId, sidebarW: layoutOffsetRef.current, topOffset, profileName: src?.workspaceId });
          return prev;
        });
        // hide tab webviews so overlay is visible
        invoke("layout_webviews", { panes: [], focusedTabId: "__none__", sidebarW: layoutOffsetRef.current, topOffset });
      }),
      listen<{ domain: string; username: string; password: string }>("vault-save-prompt", (e) => {
        setVaultSavePrompt(e.payload);
        if (vaultSaveTimer.current) clearTimeout(vaultSaveTimer.current);
        vaultSaveTimer.current = setTimeout(() => setVaultSavePrompt(null), 30000);
      }),
      // vault unlock needed — page has login form but vault is locked
      listen<{ domain: string; tabId: string }>("vault-unlock-needed", () => {
        if (!vaultUnlockedRef.current) {
          setVaultMasterModal("unlock");
        }
      }),
      // popup / window.open from webview — open in same workspace
      listen<{ sourceTabId: string; url: string }>("new-window-requested", (e) => {
        const id = genId();
        setTabs(prev => {
          const sourceTab = prev.find(t => t.id === e.payload.sourceTabId);
          const wsId = sourceTab?.workspaceId || "ws-1";
          const tab: Tab = { id, url: e.payload.url, title: "Loading...", loading: true, workspaceId: wsId, lastActiveAt: Date.now() };
          const sr = settingsRef.current;
          invoke("create_tab", { id, url: e.payload.url, sidebarW: layoutOffsetRef.current, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, profileName: wsId, ...secArgs(sr) });
          setWorkspaces(ws => ws.map(w => w.id === wsId ? { ...w, activeTabId: id } : w));
          return [...prev, tab];
        });
      }),
    ];

    // load existing downloads on init
    invoke<DownloadItem[]>("get_downloads").then(items => {
      if (items.length > 0) setDownloads(items);
    }).catch(() => {});

    // check vault lock state
    invoke<boolean>("vault_is_unlocked").then(setVaultUnlocked).catch(() => {});

    return () => { promises.forEach(p => p.then(u => u())); };
  }, []);

  // EcoQoS + memory priority: low-power mode when window hidden/minimized
  useEffect(() => {
    const onVisChange = () => {
      invoke("set_power_mode", { low: document.hidden }).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisChange);
    return () => document.removeEventListener("visibilitychange", onVisChange);
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

  // hide webviews when vault unlock modal is showing (native windows cover React overlays)
  // push webviews down when save banner is showing
  useEffect(() => {
    if (vaultMasterModal) {
      invoke("layout_webviews", { panes: [], focusedTabId: activeTab || "__none__", sidebarW: 0, topOffset: 0 });
    } else if (vaultSavePrompt) {
      // push webview down 30px to reveal save banner below titlebar
      const ws = workspaces.find(w => w.id === activeWorkspaceId);
      if (!ws?.activeTabId) return;
      const t = tabs.find(tab => tab.id === ws.activeTabId);
      if (!t || t.url.startsWith("bushido://")) return;
      const bannerH = 36;
      const cw = window.innerWidth - layoutOffset;
      const ch = window.innerHeight - topOffset - bannerH;
      const panes = [{ tabId: ws.activeTabId, x: 0, y: bannerH, w: cw, h: ch }];
      invoke("layout_webviews", { panes, focusedTabId: ws.activeTabId, sidebarW: layoutOffset, topOffset });
    } else {
      syncLayout();
    }
  }, [vaultMasterModal, vaultSavePrompt]);

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

  // smart tab lifecycle — 3-tier: active → suspended (TrySuspend) → destroyed
  useEffect(() => {
    if (settings.suspendTimeout === 0) return; // disabled
    const destroyMs = settings.suspendTimeout * 60 * 1000;
    const suspendMs = Math.min(destroyMs * 0.4, 120_000); // 40% of destroy time, max 2min

    const interval = setInterval(() => {
      const now = Date.now();
      setTabs(prev => {
        let changed = false;
        const next = prev.map(t => {
          if (t.id === activeTab || paneTabIds.includes(t.id)) return t;
          if (t.pinned || t.url.startsWith("bushido://")) return t;
          if (t.memoryState === "destroyed") return t;
          if (t.mediaState === "playing") return t;

          const idle = now - (t.lastActiveAt || 0);
          const state = t.memoryState || "active";

          // tier 2: destroy webview (full page reload on restore)
          if (idle > destroyMs) {
            invoke("close_tab", { id: t.id });
            changed = true;
            return { ...t, memoryState: "destroyed" as const, suspended: true, loading: false };
          }

          // tier 1: TrySuspend (instant resume, no reload)
          if (idle > suspendMs && state === "active") {
            invoke("suspend_tab", { id: t.id });
            changed = true;
            return { ...t, memoryState: "suspended" as const };
          }

          return t;
        });
        return changed ? next : prev;
      });
    }, 15_000);
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
    invoke("create_tab", { id: tabId, url: NEW_TAB_URL, sidebarW: layoutOffset, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, profileName: wsId, ...secArgs(sr) });
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

  const clearWorkspaceData = useCallback((wsId: string) => {
    // find any active webview tab in this workspace to get a handle
    const wsTab = tabs.find(t => t.workspaceId === wsId && !t.url.startsWith("bushido://") && t.memoryState !== "destroyed");
    if (wsTab) {
      invoke("clear_workspace_data", { tabId: wsTab.id }).catch(() => {});
    }
  }, [tabs]);

  const moveTabToWorkspace = useCallback((tabId: string, targetWsId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab || tab.workspaceId === targetWsId) return;

    // profile isolation: moving tab means different cookie jar — confirm with user
    if (!window.confirm("Moving this tab will reload it in a different session. You may be logged out. Continue?")) return;

    const savedUrl = tab.url;
    const sourceWsId = tab.workspaceId;

    // close old webview (profile is locked at creation time)
    if (!savedUrl.startsWith("bushido://")) {
      invoke("close_tab", { id: tabId });
    }

    // create new tab in target workspace with correct profile
    const newId = genId();
    setTabs(prev => {
      const without = prev.filter(t => t.id !== tabId);
      return [...without, { id: newId, url: savedUrl, title: tab.title, loading: true, workspaceId: targetWsId, lastActiveAt: Date.now() } as Tab];
    });

    setWorkspaces(wsList => wsList.map(w => {
      if (w.id === sourceWsId && w.activeTabId === tabId) {
        const remaining = tabs.filter(t => t.workspaceId === sourceWsId && t.id !== tabId);
        const newActiveId = remaining.length > 0 ? remaining[0].id : "";
        let newLayout = w.paneLayout;
        if (newLayout && hasLeaf(newLayout, tabId)) {
          newLayout = removePane(newLayout, tabId) || undefined;
        }
        const updated = { ...w, activeTabId: newActiveId, paneLayout: newLayout };
        if (sourceWsId === activeWorkspaceId && newActiveId) syncLayout(updated);
        return updated;
      }
      if (w.id === targetWsId) return { ...w, activeTabId: newId };
      return w;
    }));

    // create webview in target workspace's profile
    if (!savedUrl.startsWith("bushido://")) {
      const sr = settingsRef.current;
      invoke("create_tab", { id: newId, url: savedUrl, sidebarW: layoutOffset, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, profileName: targetWsId, ...secArgs(sr) });
    }
  }, [tabs, activeWorkspaceId, syncLayout, layoutOffset, topOffset]);

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
      invoke("create_tab", { id, url, sidebarW: layoutOffset, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, profileName: activeWorkspaceId, ...secArgs(sr) }).then(() => {
        invoke("layout_webviews", { panes: [{ tabId: id, x: 0, y: 0, w: cw, h: ch }], focusedTabId: id, sidebarW: layoutOffset, topOffset });
      }).catch(() => {
        useUiStore.getState().showError("Failed to create tab");
        setTabs(prev => prev.filter(t => t.id !== id));
      });
      clearLoading(id);
    } else {
      // hide all webviews since internal pages are React-rendered
      invoke("layout_webviews", { panes: [], focusedTabId: "__none__", sidebarW: layoutOffset, topOffset });
    }
  }, [activeWorkspaceId, clearLoading, layoutOffset, topOffset]);

  const closeTab = useCallback((id: string) => {
    // if source tab of glance is being closed, close glance too
    if (glanceRef.current?.sourceTabId === id) {
      invoke("close_glance", { glanceId: glanceRef.current.id }).catch(() => {});
      glanceRef.current = null;
      setGlance(null);
    }
    invoke("close_tab", { id });
    setTabs(prev => {
      const tab = prev.find(t => t.id === id);
      if (!tab) return prev;
      if (!tab.url.startsWith("bushido://")) {
        closedTabsRef.current.push({ url: tab.url, title: tab.title, workspaceId: tab.workspaceId });
        if (closedTabsRef.current.length > 20) closedTabsRef.current.shift();
      }
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
        invoke("create_tab", { id, url: targetTab.url, sidebarW: layoutOffset, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, profileName: targetTab.workspaceId, ...secArgs(sr) })
      ).then(() => syncLayout(updated));
      clearLoading(id);
      setTabs(prev => prev.map(t => t.id === id ? { ...t, crashed: false, loading: true, lastActiveAt: Date.now() } : t));
    } else if (targetTab?.memoryState === "suspended") {
      // instant resume — no page reload needed
      invoke("resume_tab", { id });
      setTabs(prev => prev.map(t => t.id === id ? { ...t, memoryState: "active" as const, lastActiveAt: Date.now() } : t));
      syncLayout(updated);
    } else if (targetTab?.suspended || targetTab?.memoryState === "destroyed") {
      // full recreate — page reload required
      const sr = settingsRef.current;
      invoke("create_tab", { id, url: targetTab.url, sidebarW: layoutOffset, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, profileName: targetTab.workspaceId, ...secArgs(sr) }).then(() => {
        syncLayout(updated);
      });
      clearLoading(id);
      setTabs(prev => prev.map(t => t.id === id ? { ...t, suspended: false, memoryState: "active" as const, loading: true, lastActiveAt: Date.now() } : t));
    } else if (isInternal) {
      invoke("layout_webviews", { panes: [], focusedTabId: "__none__", sidebarW: layoutOffset, topOffset });
    } else {
      syncLayout(updated);
    }
  }, [activeWorkspaceId, tabs, workspaces, layoutOffset, topOffset, clearLoading, syncLayout]);

  const pinTab = useCallback((id: string) => {
    setTabs(prev => {
      const tab = prev.find(t => t.id === id);
      const willPin = tab ? !tab.pinned : true;
      invoke("set_tab_pinned", { id, pinned: willPin }).catch(() => {});
      return prev.map(t => t.id === id ? { ...t, pinned: willPin } : t);
    });
  }, []);

  const closeGlance = useCallback(() => {
    const g = glanceRef.current;
    if (!g) return;
    invoke("close_glance", { glanceId: g.id });
    glanceRef.current = null;
    setGlance(null);
    syncLayout();
  }, [syncLayout]);

  const expandGlance = useCallback(() => {
    const g = glanceRef.current;
    if (!g) return;
    invoke("promote_glance", { glanceId: g.id });
    // add as a real tab in React state — use glance_id as tab id (matches webview label)
    const newTab: Tab = {
      id: g.id, url: g.url, title: g.title,
      loading: false, workspaceId: activeWorkspaceId, lastActiveAt: Date.now()
    };
    setTabs(prev => [...prev, newTab]);
    setWorkspaces(prev => prev.map(w => w.id === activeWorkspaceId ? { ...w, activeTabId: g.id, paneLayout: undefined } : w));
    glanceRef.current = null;
    setGlance(null);
    // syncLayout will be called by the workspace/tab update effects
    setTimeout(() => syncLayout(), 50);
  }, [activeWorkspaceId, syncLayout]);

  const splitGlance = useCallback(() => {
    const g = glanceRef.current;
    if (!g) return;
    invoke("close_glance", { glanceId: g.id });
    glanceRef.current = null;
    setGlance(null);
    // open URL as a new tab (addTab will handle layout)
    addTab(g.url);
  }, [addTab]);

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
    if (currentTab?.url?.startsWith("bushido://") || currentTab?.suspended || currentTab?.memoryState === "destroyed" || currentTab?.memoryState === "suspended") {
      const sr = settingsRef.current;
      invoke("create_tab", { id: activeTab, url: finalUrl, sidebarW: layoutOffset, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, profileName: currentTab?.workspaceId, ...secArgs(sr) }).then(() => {
        // directly position — syncLayout would read stale tab URL from state
        const cw = window.innerWidth - layoutOffset;
        const ch = window.innerHeight - topOffset;
        invoke("layout_webviews", { panes: [{ tabId: activeTab, x: 0, y: 0, w: cw, h: ch }], focusedTabId: activeTab, sidebarW: layoutOffset, topOffset });
      });
      if (currentTab?.suspended || currentTab?.memoryState === "destroyed" || currentTab?.memoryState === "suspended") {
        setTabs(prev => prev.map(t => t.id === activeTab ? { ...t, suspended: false, memoryState: "active" as const } : t));
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
    const wsTabs = tabs.filter(t => t.workspaceId === activeWorkspaceId && !t.url.startsWith("bushido://") && !t.suspended && t.memoryState !== "destroyed");
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
  const draggingDiv = useUiStore(s => s.draggingDiv);
  const setDraggingDiv = useUiStore(s => s.setDraggingDiv);
  const mainRef = useRef<HTMLDivElement>(null);

  // --- drag-to-split ---
  const dropZone = useUiStore(s => s.dropZone);
  const setDropZone = useUiStore(s => s.setDropZone);
  const dragOverContent = useUiStore(s => s.dragOverContent);
  const setDragOverContent = useUiStore(s => s.setDragOverContent);
  const dropRaf = useRef(0);

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

  // drag-to-split: mouse-based fake drag (HTML5 drag events don't work over WebView2 areas).
  // Same pattern as divider drag: mousedown → mousemove on document → mouseup.
  // Sidebar already applies 5px threshold before calling this.
  const onTabSplitDrag = useCallback((tabId: string) => {
    // immediately hide webviews and show overlay
    invoke("layout_webviews", { panes: [], focusedTabId: "__none__", sidebarW: layoutOffset, topOffset });
    setDragOverContent(true);

    const onMove = (e: MouseEvent) => {
      // RAF-gated zone detection
      if (dropRaf.current) return;
      dropRaf.current = requestAnimationFrame(() => {
        dropRaf.current = 0;
        if (!mainRef.current) return;
        const rect = mainRef.current.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
          setDropZone(null);
          return;
        }
        const ws = workspaces.find(w => w.id === activeWorkspaceId);
        const zone = detectDropZone(
          ws?.paneLayout || undefined,
          ws?.activeTabId || "",
          { x: 0, y: 0, w: rect.width, h: rect.height },
          e.clientX - rect.left,
          e.clientY - rect.top
        );
        setDropZone(zone);
      });
    };

    const onUp = (e: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (dropRaf.current) { cancelAnimationFrame(dropRaf.current); dropRaf.current = 0; }

      const currentDropZone = dropZoneRef.current;
      setDragOverContent(false);
      setDropZone(null);

      const tab = tabs.find(t => t.id === tabId);
      if (tab && !tab.url.startsWith("bushido://") && currentDropZone) {
        const ws = workspaces.find(w => w.id === activeWorkspaceId);
        if (ws) {
          if (tabId === currentDropZone.anchorTabId) { syncLayout(); return; }
          let base = ws.paneLayout || null;
          if (base && hasLeaf(base, tabId)) base = removePane(base, tabId);
          const newLayout = insertPane(base, currentDropZone.anchorTabId, tabId, currentDropZone.side);
          if (newLayout) {
            const updated = { ...ws, paneLayout: newLayout };
            setWorkspaces(prev => prev.map(w => w.id === activeWorkspaceId ? updated : w));
            syncLayout(updated);
            return;
          }
        }
      }
      syncLayout();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [layoutOffset, topOffset, workspaces, activeWorkspaceId, tabs, syncLayout]);

  const dropZoneRef = useRef<DropZone | null>(null);
  useEffect(() => { dropZoneRef.current = dropZone; }, [dropZone]);

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
    const createdAt = Date.now();
    setBookmarkData(prev => {
      const order = prev.bookmarks.filter(b => b.folderId === folderId).length;
      return { ...prev, bookmarks: [...prev.bookmarks, { id, url, title, favicon, folderId, createdAt, order }] };
    });
    invoke("sync_add_bookmark", { id, url, title, favicon: favicon || null, folderId, createdAt }).catch(() => {});
  }, []);

  const removeBookmark = useCallback((id: string) => {
    setBookmarkData(prev => ({
      ...prev,
      bookmarks: prev.bookmarks.filter(b => b.id !== id),
    }));
    invoke("sync_remove_bookmark", { id }).catch(() => {});
  }, []);

  const addBookmarkFolder = useCallback((name: string, parentId = "root"): string => {
    const id = `bmf-${Date.now()}`;
    setBookmarkData(prev => ({
      ...prev,
      folders: [...prev.folders, { id, name, parentId, order: prev.folders.length }],
    }));
    invoke("sync_add_folder", { id, name, parentId, order: 0 }).catch(() => {});
    return id;
  }, []);

  const renameBookmarkFolder = useCallback((folderId: string, name: string) => {
    setBookmarkData(prev => ({
      ...prev,
      folders: prev.folders.map(f => f.id === folderId ? { ...f, name } : f),
    }));
    invoke("sync_rename_folder", { id: folderId, name }).catch(() => {});
  }, []);

  const deleteBookmarkFolder = useCallback((folderId: string) => {
    setBookmarkData(prev => ({
      ...prev,
      folders: prev.folders.filter(f => f.id !== folderId),
      bookmarks: prev.bookmarks.map(b => b.folderId === folderId ? { ...b, folderId: "" } : b),
    }));
    invoke("sync_remove_folder", { id: folderId }).catch(() => {});
  }, []);

  const moveBookmarkToFolder = useCallback((bookmarkId: string, folderId: string) => {
    setBookmarkData(prev => ({
      ...prev,
      bookmarks: prev.bookmarks.map(b => b.id === bookmarkId ? { ...b, folderId } : b),
    }));
    invoke("sync_move_bookmark", { id: bookmarkId, folderId }).catch(() => {});
  }, []);

  const reorderBookmarks = useCallback((bookmarkId: string, targetId: string, position: "before" | "after") => {
    setBookmarkData(prev => {
      const bm = prev.bookmarks.find(b => b.id === bookmarkId);
      const target = prev.bookmarks.find(b => b.id === targetId);
      if (!bm || !target) return prev;
      const targetFolder = target.folderId;
      const inFolder = prev.bookmarks
        .filter(b => b.folderId === targetFolder && b.id !== bookmarkId)
        .sort((a, b) => a.order - b.order);
      const targetIdx = inFolder.findIndex(b => b.id === targetId);
      const insertIdx = position === "before" ? targetIdx : targetIdx + 1;
      inFolder.splice(insertIdx, 0, { ...bm, folderId: targetFolder });
      const reordered = inFolder.map((b, i) => ({ ...b, order: i }));
      const others = prev.bookmarks.filter(b => b.folderId !== targetFolder && b.id !== bookmarkId);
      return { ...prev, bookmarks: [...others, ...reordered] };
    });
  }, []);

  const reorderFolders = useCallback((folderId: string, targetFolderId: string, position: "before" | "after") => {
    setBookmarkData(prev => {
      const folder = prev.folders.find(f => f.id === folderId);
      if (!folder) return prev;
      const folders = prev.folders.filter(f => f.id !== folderId).sort((a, b) => a.order - b.order);
      const targetIdx = folders.findIndex(f => f.id === targetFolderId);
      const insertIdx = position === "before" ? targetIdx : targetIdx + 1;
      folders.splice(insertIdx, 0, folder);
      return { ...prev, folders: folders.map((f, i) => ({ ...f, order: i })) };
    });
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
    if (!tab || tab.url.startsWith("bushido://") || tab.suspended || tab.memoryState === "suspended" || tab.memoryState === "destroyed") return;

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
    if (!tab || tab.url.startsWith("bushido://") || tab.suspended || tab.memoryState === "suspended" || tab.memoryState === "destroyed") {
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

  // Screenshot: capture viewport while webview is on-screen, then hide + open overlay
  const openScreenshot = useCallback(async () => {
    if (!activeTab) return;
    try {
      const b64: string = await invoke("capture_visible", { id: activeTab });
      // Hide webviews so React overlay is visible
      invoke("layout_webviews", { panes: [], focusedTabId: activeTab, sidebarW: 0, topOffset: 0 });
      setScreenshotPreview(b64);
    } catch (e: any) {
      // If capture fails, still open overlay with empty preview
      invoke("layout_webviews", { panes: [], focusedTabId: activeTab || "__none__", sidebarW: 0, topOffset: 0 });
      setScreenshotPreview("");
    }
  }, [activeTab]);

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
      case "action-screenshot": openScreenshot(); break;
    }
  }, [addTab, closeTab, activeTab, clearHistory, toggleBookmark, onOpenSettings, toggleReader, openScreenshot]);

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
      if (ctrl && e.shiftKey && e.key === "T") { e.preventDefault(); const c = closedTabsRef.current.pop(); if (c) addTab(c.url); }
      if (ctrl && e.shiftKey && e.key === "I") { e.preventDefault(); invoke("toggle_devtools", { id: activeTab }); }
      if (ctrl && e.key === "d" && !e.shiftKey) { e.preventDefault(); toggleBookmark(); }
      if (ctrl && e.key === "h" && !e.shiftKey) { e.preventDefault(); setHistoryOpen(p => !p); }
      if (ctrl && e.key === "p" && !e.shiftKey) { e.preventDefault(); invoke("print_tab", { id: activeTab }); }
      if (ctrl && e.key === "j" && !e.shiftKey) { e.preventDefault(); setDownloadsOpen(p => !p); }
      if (ctrl && e.key === "r" && !e.shiftKey) { e.preventDefault(); invoke("reload_tab", { id: activeTab }); }
      if (ctrl && e.key === "=") { e.preventDefault(); const z = Math.min((zoomRef.current[activeTab] || 1) + 0.1, 3); zoomRef.current[activeTab] = z; invoke("zoom_tab", { id: activeTab, factor: z }); }
      if (ctrl && e.key === "-") { e.preventDefault(); const z = Math.max((zoomRef.current[activeTab] || 1) - 0.1, 0.3); zoomRef.current[activeTab] = z; invoke("zoom_tab", { id: activeTab, factor: z }); }
      if (ctrl && e.key === "0") { e.preventDefault(); zoomRef.current[activeTab] = 1; invoke("zoom_tab", { id: activeTab, factor: 1 }); }
      if (e.key === "F11") { e.preventDefault(); invoke("toggle_fullscreen"); }
      if (e.key === "F5") { e.preventDefault(); invoke("reload_tab", { id: activeTab }); }
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
        case "screenshot": openScreenshot(); break;
        case "reader-mode": toggleReader(); break;
        case "split-view": toggleSplit(); break;
        case "print": invoke("print_tab", { id: activeTab }); break;
        case "reload": invoke("reload_tab", { id: activeTab }); break;
        case "fullscreen": invoke("toggle_fullscreen"); break;
        case "downloads": setDownloadsOpen(p => !p); break;
        case "devtools": invoke("toggle_devtools", { id: activeTab }); break;
        case "reopen-tab": { const c = closedTabsRef.current.pop(); if (c) addTab(c.url); break; }
        case "zoom-in": { const z = Math.min((zoomRef.current[activeTab] || 1) + 0.1, 3); zoomRef.current[activeTab] = z; invoke("zoom_tab", { id: activeTab, factor: z }); break; }
        case "zoom-out": { const z = Math.max((zoomRef.current[activeTab] || 1) - 0.1, 0.3); zoomRef.current[activeTab] = z; invoke("zoom_tab", { id: activeTab, factor: z }); break; }
        case "zoom-reset": { zoomRef.current[activeTab] = 1; invoke("zoom_tab", { id: activeTab, factor: 1 }); break; }
      }
    };
    return () => { delete (window as any).__bushidoGlobalShortcut; };
  }, [toggleBookmark, addTab, closeTab, activeTab, toggleSplit, openScreenshot]);

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

  // onboarding handlers
  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    setSettings(prev => ({ ...prev, onboardingComplete: true }));
  }, []);

  const handleImportBookmarks = useCallback((imported: { title: string; url: string; folder: string }[]) => {
    bookmarkBulkRef.current = true; // allow debounced save_bookmarks for bulk import
    setBookmarkData(prev => {
      const existing = new Set(prev.bookmarks.map(b => b.url));
      const newBookmarks = imported
        .filter(b => b.url && !existing.has(b.url))
        .map((b, i) => ({
          id: genId("bm"),
          url: b.url,
          title: b.title || b.url,
          folderId: "imported",
          createdAt: Date.now(),
          order: prev.bookmarks.filter(bm => bm.folderId === "imported").length + i,
        }));
      const hasImportedFolder = prev.folders.some(f => f.id === "imported");
      const folders = hasImportedFolder ? prev.folders : [...prev.folders, { id: "imported", name: "Imported", parentId: "root", order: prev.folders.length }];
      return { bookmarks: [...prev.bookmarks, ...newBookmarks], folders };
    });
  }, []);

  const handleImportHistory = useCallback((imported: { title: string; url: string; visit_count: number; last_visit: number }[]) => {
    setHistoryEntries(prev => {
      const existing = new Set(prev.map(h => h.url));
      const newEntries = imported
        .filter(h => h.url && !existing.has(h.url))
        .map(h => ({
          url: h.url,
          title: h.title || h.url,
          visitCount: h.visit_count,
          lastVisitAt: h.last_visit,
        }));
      return [...prev, ...newEntries];
    });
  }, []);

  const handleThemeChange = useCallback((accent: string, mode: "dark" | "light") => {
    applyTheme(accent, mode);
    setSettings(prev => ({ ...prev, accentColor: accent, themeMode: mode }));
  }, [applyTheme]);

  const reloadAllTabs = useCallback(() => {
    const sr = settingsRef.current;
    const base = { httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, ...secArgs(sr) };
    tabs.forEach(t => {
      if (t.url.startsWith("bushido://") || t.suspended || t.memoryState === "destroyed") return;
      invoke("close_tab", { id: t.id }).then(() => {
        invoke("create_tab", { id: t.id, url: t.url, sidebarW: layoutOffset, topOffset, isPanel: false, profileName: t.workspaceId, ...base });
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
    <>
    {showOnboarding && (
      <Onboarding
        onComplete={handleOnboardingComplete}
        onImportBookmarks={handleImportBookmarks}
        onImportHistory={handleImportHistory}
        onThemeChange={handleThemeChange}
        initialAccent={settings.accentColor}
        initialMode={settings.themeMode}
      />
    )}
    <div className="browser" style={showOnboarding ? { display: "none" } : undefined}>
      {screenshotPreview !== null && activeTab && (
        <ScreenshotOverlay
          tabId={activeTab}
          tabUrl={current?.url || ""}
          preview={screenshotPreview}
          onClose={() => { setScreenshotPreview(null); syncLayout(); }}
          onAnnotate={(data) => { setScreenshotPreview(null); setAnnotationData(data); }}
          onRestoreWebview={() => syncLayout()}
        />
      )}
      {glance && (
        <GlanceOverlay
          url={glance.url}
          title={glance.title}
          sidebarWidth={layoutOffset}
          topOffset={topOffset}
          onClose={closeGlance}
          onExpand={expandGlance}
          onSplit={splitGlance}
        />
      )}
      {annotationData && (
        <AnnotationEditor
          imageData={annotationData}
          onClose={() => { setAnnotationData(null); syncLayout(); }}
        />
      )}
      {shareOpen && current?.url && (
        <ShareMenu
          url={current.url}
          onClose={() => setShareOpen(false)}
        />
      )}
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
          onClearWorkspaceData={clearWorkspaceData}
          onRenameWorkspace={renameWorkspace}
          onRecolorWorkspace={recolorWorkspace}
          onToggleCollapse={toggleCollapse}
          onAddChildTab={addChildTab}
          onMoveTabToWorkspace={moveTabToWorkspace}
          bookmarks={bookmarkData.bookmarks}
          bookmarkFolders={bookmarkData.folders}
          onSelectBookmark={selectBookmark}
          onRemoveBookmark={removeBookmark}
          onAddBookmarkFolder={addBookmarkFolder}
          onRenameBookmarkFolder={renameBookmarkFolder}
          onDeleteBookmarkFolder={deleteBookmarkFolder}
          onMoveBookmarkToFolder={moveBookmarkToFolder}
          onReorderBookmarks={reorderBookmarks}
          onReorderFolders={reorderFolders}
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
          onScreenshot={openScreenshot}
          onShareUrl={() => setShareOpen(true)}
          syncEnabled={settings.syncEnabled}
          pairedDevices={syncPairedDevices}
          onTabSplitDrag={onTabSplitDrag}
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
        <div className="main" ref={mainRef}
        >
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
              onThemeChange={handleThemeChange}
              onOpenUrl={addTab}
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
          <div
            className="drop-zone-overlay"
            style={{ pointerEvents: "none", opacity: dragOverContent ? 1 : 0 }}
          >
            {dropZone && (
              <div
                className="drop-zone-preview"
                style={{
                  left: dropZone.previewRect.x,
                  top: dropZone.previewRect.y,
                  width: dropZone.previewRect.w,
                  height: dropZone.previewRect.h,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
    {syncToast && (
      <div className={`sync-toast sync-toast--${syncToast}`}>
        {syncToast === "syncing" && (
          <svg className="sync-toast-icon sync-toast-spin" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5A6.5 6.5 0 1 0 14.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
        {syncToast === "success" && (
          <svg className="sync-toast-icon sync-toast-check" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8.5L6.5 12L13 4" stroke="var(--success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
        {syncToast === "error" && (
          <svg className="sync-toast-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 4v5M8 11v1" stroke="var(--danger)" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
        <span>{syncToast === "syncing" ? "Syncing..." : syncToast === "success" ? "Synced" : "Sync failed"}</span>
      </div>
    )}
    {errorToast && (
      <div className="sync-toast sync-toast--error">
        <svg className="sync-toast-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 4v5M8 11v1" stroke="var(--danger)" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span>{errorToast}</span>
      </div>
    )}
    {syncTabReceived && (
      <div className="sync-toast sync-toast--tab-received" onClick={() => {
        navigate(syncTabReceived.url);
        setSyncTabReceived(null);
      }}>
        <svg className="sync-toast-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 3h12v10H2z" stroke="var(--accent)" strokeWidth="1.3"/>
          <path d="M2 5.5h12" stroke="var(--accent)" strokeWidth="1"/>
        </svg>
        <span>Tab from {syncTabReceived.from_device}: {syncTabReceived.title.substring(0, 40)}</span>
        <span style={{ opacity: 0.6, fontSize: 11 }}>click to open</span>
      </div>
    )}
    {vaultSavePrompt && (
      <div className="vault-save-banner" style={{ left: layoutOffset, right: 0 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/><circle cx="12" cy="16" r="1"/></svg>
        <span>Save password for <b>{vaultSavePrompt.domain}</b>?</span>
        <span style={{ opacity: 0.85, fontSize: 11 }}>{vaultSavePrompt.username}</span>
        <button className="vault-save-btn save" onClick={async () => {
          const unlocked = await invoke<boolean>("vault_is_unlocked").catch(() => false);
          if (!unlocked) {
            const hasMaster = await invoke<boolean>("vault_has_master_password").catch(() => false);
            if (vaultSaveTimer.current) { clearTimeout(vaultSaveTimer.current); vaultSaveTimer.current = null; }
            setVaultMasterModal(hasMaster ? "unlock" : "setup");
            return;
          }
          await invoke("vault_save_entry", { domain: vaultSavePrompt.domain, username: vaultSavePrompt.username, password: vaultSavePrompt.password }).catch(() => showError("Failed to save password"));
          setVaultSavePrompt(null);
        }}>Save</button>
        <button className="vault-save-btn dismiss" onClick={() => setVaultSavePrompt(null)}>Dismiss</button>
      </div>
    )}
    {vaultMasterModal && (
      <div className="vault-master-overlay" onClick={() => {
        setVaultMasterModal(null);
        if (vaultSavePrompt && !vaultSaveTimer.current) {
          vaultSaveTimer.current = setTimeout(() => setVaultSavePrompt(null), 30000);
        }
      }}>
        <div className="vault-master-modal" onClick={e => e.stopPropagation()}>
          <h3>{vaultMasterModal === "setup" ? "Set Master Password" : "Unlock Vault"}</h3>
          <p style={{ opacity: 0.6, fontSize: 12, margin: "4px 0 12px" }}>
            {vaultMasterModal === "setup" ? "This encrypts all saved passwords." : "Enter your master password to continue."}
          </p>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const form = e.target as HTMLFormElement;
            const pw = (form.elements.namedItem("vaultpw") as HTMLInputElement).value;
            if (vaultMasterModal === "setup") {
              const confirm = (form.elements.namedItem("vaultpw2") as HTMLInputElement).value;
              if (pw !== confirm) { showError("Passwords don't match"); return; }
              await invoke("vault_setup", { masterPassword: pw }).catch((err: any) => { showError(String(err)); return; });
            } else {
              await invoke("vault_unlock", { masterPassword: pw }).catch((err: any) => { showError(String(err)); return; });
            }
            setVaultUnlocked(true);
            setVaultMasterModal(null);
            // retry autofill on all tabs now that vault is unlocked
            invoke("vault_retry_autofill").catch(() => {});
            // retry save if pending
            if (vaultSavePrompt) {
              await invoke("vault_save_entry", { domain: vaultSavePrompt.domain, username: vaultSavePrompt.username, password: vaultSavePrompt.password }).catch(() => showError("Failed to save password"));
              setVaultSavePrompt(null);
            }
          }}>
            <input name="vaultpw" type="password" placeholder="Master password" autoFocus minLength={8} required />
            {vaultMasterModal === "setup" && (
              <input name="vaultpw2" type="password" placeholder="Confirm password" minLength={8} required style={{ marginTop: 8 }} />
            )}
            <button type="submit" className="vault-save-btn save" style={{ marginTop: 12, width: "100%" }}>
              {vaultMasterModal === "setup" ? "Set Password" : "Unlock"}
            </button>
          </form>
        </div>
      </div>
    )}
    {permReq && (
      <div className="permission-prompt" style={{ left: layoutOffset + 16 }}>
        <div className="permission-prompt-icon">
          {permReq.permission === "camera" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="15" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M17 9.5l5-3v11l-5-3z" stroke="currentColor" strokeWidth="1.5"/></svg>
          ) : permReq.permission === "microphone" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="8" y="2" width="8" height="12" rx="4" stroke="currentColor" strokeWidth="1.5"/><path d="M5 11a7 7 0 0014 0M12 18v4" stroke="currentColor" strokeWidth="1.5"/></svg>
          ) : permReq.permission === "geolocation" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M12 2a8 8 0 00-8 8c0 6 8 12 8 12s8-6 8-12a8 8 0 00-8-8z" stroke="currentColor" strokeWidth="1.5"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/><path d="M12 8v4l3 3" stroke="currentColor" strokeWidth="1.5"/></svg>
          )}
        </div>
        <div className="permission-prompt-body">
          <span className="permission-prompt-domain">{permReq.domain}</span>
          <span className="permission-prompt-text">wants to use your {PERM_LABELS[permReq.permission] || permReq.permission}</span>
        </div>
        <label className="permission-prompt-remember">
          <input type="checkbox" checked={permRemember} onChange={e => setPermRemember(e.target.checked)} />
          Remember
        </label>
        <button className="permission-btn deny" onClick={() => {
          invoke("respond_permission", { requestId: permReq.requestId, allow: false, remember: permRemember });
          setPermReq(null);
        }}>Deny</button>
        <button className="permission-btn allow" onClick={() => {
          invoke("respond_permission", { requestId: permReq.requestId, allow: true, remember: permRemember });
          setPermReq(null);
        }}>Allow</button>
      </div>
    )}
    {pageCtx && (
      <div className="ctx-overlay" onClick={() => setPageCtx(null)} onKeyDown={(e) => {
        if (e.key === "Escape") { setPageCtx(null); return; }
        const menu = pageCtxRef.current;
        if (!menu) return;
        const items = Array.from(menu.querySelectorAll<HTMLElement>(".ctx-item"));
        const focused = document.activeElement as HTMLElement;
        const idx = items.indexOf(focused);
        if (e.key === "ArrowDown") { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus(); }
        else if (e.key === "Enter" && idx >= 0) { e.preventDefault(); items[idx].click(); }
      }}>
        <div ref={pageCtxRef} className="ctx-menu page-ctx" style={{ top: pageCtxPos.top, left: pageCtxPos.left }}>
          {pageCtx.linkUri && (
            <>
              <div className="ctx-item" tabIndex={0} onClick={() => { if (isSafeUrl(pageCtx.linkUri)) addTab(pageCtx.linkUri); setPageCtx(null); }}>
                Open link in new tab
              </div>
              <div className="ctx-item" tabIndex={0} onClick={() => { invoke("copy_text_to_clipboard", { text: pageCtx.linkUri }); setPageCtx(null); }}>
                Copy link address
              </div>
              <div className="ctx-divider" />
            </>
          )}
          {pageCtx.kind === "image" && pageCtx.sourceUri && (
            <>
              <div className="ctx-item" tabIndex={0} onClick={() => { if (isSafeUrl(pageCtx.sourceUri)) addTab(pageCtx.sourceUri); setPageCtx(null); }}>
                Open image in new tab
              </div>
              <div className="ctx-item" tabIndex={0} onClick={() => {
                const imgUrl = pageCtx.sourceUri;
                const filename = imgUrl.split("/").pop()?.split("?")[0] || "image.png";
                const sr = settingsRef.current;
                invoke("start_download", { url: imgUrl, filename, downloadDir: sr.downloadLocation || "", cookies: null, mimeRouting: sr.mimeRouting || null });
                setPageCtx(null);
              }}>
                Save image as...
              </div>
              <div className="ctx-item" tabIndex={0} onClick={() => { invoke("copy_text_to_clipboard", { text: pageCtx.sourceUri }); setPageCtx(null); }}>
                Copy image URL
              </div>
              <div className="ctx-divider" />
            </>
          )}
          {(pageCtx.kind === "video" || pageCtx.kind === "audio") && pageCtx.sourceUri && (
            <>
              <div className="ctx-item" tabIndex={0} onClick={() => { if (isSafeUrl(pageCtx.sourceUri)) addTab(pageCtx.sourceUri); setPageCtx(null); }}>
                Open media in new tab
              </div>
              <div className="ctx-item" tabIndex={0} onClick={() => { invoke("copy_text_to_clipboard", { text: pageCtx.sourceUri }); setPageCtx(null); }}>
                Copy media URL
              </div>
              <div className="ctx-divider" />
            </>
          )}
          {pageCtx.selectionText && (
            <>
              <div className="ctx-item" tabIndex={0} onClick={() => { invoke("copy_text_to_clipboard", { text: pageCtx.selectionText }); setPageCtx(null); }}>
                Copy
              </div>
              <div className="ctx-item" tabIndex={0} onClick={() => {
                const q = pageCtx.selectionText.slice(0, 200);
                addTab(getSearchUrl(q));
                setPageCtx(null);
              }}>
                Search "{pageCtx.selectionText.length > 30 ? pageCtx.selectionText.slice(0, 30) + "..." : pageCtx.selectionText}"
              </div>
              <div className="ctx-divider" />
            </>
          )}
          <div className="ctx-item" tabIndex={0} onClick={() => { invoke("go_back", { id: pageCtx.tabId }); setPageCtx(null); }}>
            Back
          </div>
          <div className="ctx-item" tabIndex={0} onClick={() => { invoke("go_forward", { id: pageCtx.tabId }); setPageCtx(null); }}>
            Forward
          </div>
          <div className="ctx-item" tabIndex={0} onClick={() => { invoke("reload_tab", { id: pageCtx.tabId }); setPageCtx(null); }}>
            Reload
          </div>
          <div className="ctx-divider" />
          <div className="ctx-item" tabIndex={0} onClick={() => {
            const tab = tabs.find(t => t.id === pageCtx.tabId);
            if (tab?.url) navigator.clipboard.writeText(tab.url);
            setPageCtx(null);
          }}>
            Copy page URL
          </div>
          <div className="ctx-item" tabIndex={0} onClick={() => { invoke("print_tab", { id: pageCtx.tabId }); setPageCtx(null); }}>
            Print page
          </div>
          <div className="ctx-item" tabIndex={0} onClick={() => {
            const tab = tabs.find(t => t.id === pageCtx.tabId);
            if (tab?.url) addTab("view-source:" + tab.url);
            setPageCtx(null);
          }}>
            View page source
          </div>
          <div className="ctx-divider" />
          <div className="ctx-item" tabIndex={0} onClick={() => { invoke("toggle_devtools", { id: pageCtx.tabId }); setPageCtx(null); }}>
            Inspect
          </div>
        </div>
      </div>
    )}
    </>
  );
}
