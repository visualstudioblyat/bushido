<script lang="ts">
// Module-scope helpers and constants — mirrors the top-of-file helpers in
// src/App.tsx. Shared across App instances; kept out of <script setup> so the
// tab/workspace id counters survive HMR remounts.
import {
  ref, computed, watch, onMounted, onUnmounted,
  type Ref,
} from "vue";
import { storeToRefs } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { DEFAULT_SETTINGS } from "./types";
import type {
  Tab, Workspace, SessionData, HistoryEntry, BookmarkData, FrecencyResult,
  DigidawSettings, DownloadItem, PaneRect, DividerInfo, WebPanel, DropZone,
  PermissionRequest, Bookmark, BookmarkFolder,
} from "./types";
import {
  allLeafIds, insertPane, removePane, computeRects, computeDividers,
  updateRatio, hasLeaf, detectDropZone,
} from "./splitLayout";
import type { PageCtxMenu } from "./store/storeTypes";

// blocked URL schemes — defense-in-depth (Rust side also blocks these)
const BLOCKED_SCHEMES = ["javascript:", "data:", "file:", "vbscript:", "blob:", "ms-msdt:", "search-ms:", "ms-officecmd:"];

function extractDomain(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}
const isSafeUrl = (url: string) => !BLOCKED_SCHEMES.some(s => url.toLowerCase().startsWith(s));

const NTP_URL = "digidaw://newtab";
const SETTINGS_URL = "digidaw://settings";
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
  const blocked = ["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "digidaw:"];
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

const secArgs = (sr: DigidawSettings) => ({
  disableDevTools: sr.disableDevTools, disableStatusBar: sr.disableStatusBar,
  disableAutofill: sr.disableAutofill, disablePasswordSave: sr.disablePasswordSave,
  blockServiceWorkers: sr.blockServiceWorkers, blockFontEnum: sr.blockFontEnumeration,
  spoofHwConcurrency: sr.spoofHardwareConcurrency,
  blockPopups: sr.blockPopups, defaultZoom: sr.defaultZoom,
  maxTabs: sr.maxTabs || 50,
});

// clamp a popup menu to viewport edges (port of the useClampedMenu hook;
// same pattern as Sidebar.vue's composable fn)
function useClampedMenu<T extends { x: number; y: number }>(menuEl: Ref<HTMLDivElement | null>, anchor: Ref<T | null>) {
  const pos = ref<{ top: number; left: number }>({ top: 0, left: 0 });
  watch(anchor, (a) => {
    if (!a) return;
    pos.value = { top: -9999, left: -9999 };
    requestAnimationFrame(() => {
      const el = menuEl.value;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pad = 8;
      const left = Math.max(pad, Math.min(a.x, window.innerWidth - rect.width - pad));
      const top = Math.max(pad, Math.min(a.y, window.innerHeight - rect.height - pad));
      pos.value = { top, left };
    });
  });
  return pos;
}
</script>

<script setup lang="ts">
import Sidebar from "./components/Sidebar.vue";
import WebviewPanel from "./components/WebviewPanel.vue";
import FindBar from "./components/FindBar.vue";
import HistoryPanel from "./components/HistoryPanel.vue";
import DownloadPanel from "./components/DownloadPanel.vue";
import NetworkPanel from "./components/NetworkPanel.vue";
import type { NetworkEntry } from "./components/NetworkPanel.vue";
import NewTabPage from "./components/NewTabPage.vue";
import SettingsPage from "./components/SettingsPage.vue";
import CommandPalette from "./components/CommandPalette.vue";
import SplitOverlay from "./components/SplitOverlay.vue";
import ScreenshotOverlay from "./components/ScreenshotOverlay.vue";
import AnnotationEditor from "./components/AnnotationEditor.vue";
import ShareMenu from "./components/ShareMenu.vue";
import Onboarding from "./components/Onboarding.vue";
import GlanceOverlay from "./components/GlanceOverlay.vue";
import PerfOverlay from "./components/PerfOverlay.vue";
import { useTabStore } from "./store/tabs";
import { useUiStore } from "./store/ui";
import { useDataStore } from "./store/data";
import { useFeatureStore, type GlanceState, type ReaderSettings } from "./store/feature";
import { useVaultStore } from "./store/vault";
import { useSyncStore } from "./store/sync";

// --- Pinia stores (React: useTabStore(s => ...) selectors) ---
const tabStore = useTabStore();
const ui = useUiStore();
const dataStore = useDataStore();
const featureStore = useFeatureStore();
const vaultStore = useVaultStore();
const syncStore = useSyncStore();
const showError = ui.showError;

const { tabs, workspaces, activeWorkspaceId } = storeToRefs(tabStore);
const { sidebarOpen, compactMode, findOpen, historyOpen, cmdOpen, downloadsOpen, networkOpen, showOnboarding, urlQuery, draggingDiv, dropZone, dragOverContent, pageCtx, errorToast } = storeToRefs(ui);
const { historyEntries, bookmarkData, downloads, settings } = storeToRefs(dataStore);
const { screenshotPreview, annotationData, shareOpen, readerTabs, readerSettings, hasVideo, pipActive, panels, activePanelId, glance } = storeToRefs(featureStore);
const { vaultSavePrompt, vaultMasterModal, vaultUnlocked, permReq, permRemember } = storeToRefs(vaultStore);
const { syncToast, syncTabReceived, syncPairedDevices } = storeToRefs(syncStore);

// --- local component state ---
const perfOpen = ref(false);
const tabPreview = ref<string | null>(null);
const networkEntries = ref<NetworkEntry[]>([]);
const cookieToast = ref(false);
const updateToast = ref<string | null>(null);
const pendingUpdate = ref<{ version: string; downloading: boolean } | null>(null);
const zoomDisplay = ref<Record<string, number>>({});
const searchSugs = ref<string[]>([]);

// non-reactive locals — React needed useRef mirrors for stale-closure safety;
// Vue closures read refs at call time, so these stay plain.
let vaultSaveTimer: ReturnType<typeof setTimeout> | null = null;
let syncToastTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;
let settingsLoaded = false;
let historyLoaded = false;
let bookmarksLoaded = false;
let bookmarkBulk = false;
let prevSettings: DigidawSettings | null = null;
let dropRaf = 0;
const closedTabs: { url: string; title: string; workspaceId: string }[] = [];
const tabThumbnails = new Map<string, string>();
const zoom: Record<string, number> = {};

// template refs
const urlBarRef = ref<HTMLInputElement | null>(null);
// Sidebar expects the React-ref shape `{ value }` and mutates it; a bare ref
// in a template binding would auto-unwrap, so hand over a getter/setter view.
const inputRefShim = {
  get value() { return urlBarRef.value; },
  set value(v: HTMLInputElement | null) { urlBarRef.value = v; },
};
const mainRef = ref<HTMLDivElement | null>(null);
const pageCtxRef = ref<HTMLDivElement | null>(null);
const pageCtxPos = useClampedMenu(pageCtxRef, pageCtx);

const topOffset = 40;

// --- derived state ---
const activeWs = computed(() => workspaces.value.find(w => w.id === activeWorkspaceId.value));
const activeTab = computed(() => activeWs.value?.activeTabId || "");
const paneLayout = computed(() => activeWs.value?.paneLayout);
const paneTabIds = computed(() => (paneLayout.value ? allLeafIds(paneLayout.value) : []));
const paneTabIdSet = computed(() => new Set(paneTabIds.value));
const currentWsTabs = computed(() => tabs.value.filter(t => t.workspaceId === activeWorkspaceId.value));
const sidebarW = computed(() => (compactMode.value ? 3 : sidebarOpen.value ? 300 : 54));
const panelW = computed(() => (activePanelId.value && !compactMode.value ? PANEL_W : 0));
const layoutOffset = computed(() => sidebarW.value + panelW.value);
const pinnedTabs = computed(() => currentWsTabs.value.filter(t => t.pinned));
const regularTabs = computed(() => currentWsTabs.value.filter(t => !t.pinned));

// media mini player — find any tab with media state (prefer playing over paused)
const playingTab = computed<Tab | undefined>(() =>
  tabs.value.find(t => t.mediaState === "playing") || tabs.value.find(t => t.mediaState === "paused"));

// compute dividers from current layout
const dividers = computed<DividerInfo[]>(() => {
  if (!paneLayout.value) return [];
  const cw = window.innerWidth - layoutOffset.value;
  const ch = window.innerHeight - topOffset;
  return computeDividers(paneLayout.value, { x: 0, y: 0, w: cw, h: ch });
});

const current = computed(() => tabs.value.find(t => t.id === activeTab.value));
const showNtp = computed(() => current.value?.url === NTP_URL);
const showSettings = computed(() => current.value?.url === SETTINGS_URL);
const showInternalPage = computed(() => showNtp.value || showSettings.value);
const bookmarkedUrls = computed(() => new Set(bookmarkData.value.bookmarks.map(b => b.url)));
const activeDownloadCount = computed(() => downloads.value.filter(d => d.state === "downloading").length);

// top sites — 8 most frecent, deduplicated by domain, with defaults
const topSites = computed<FrecencyResult[]>(() => {
  const domainMap = new Map<string, FrecencyResult>();
  for (const h of historyEntries.value) {
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
});

// frecency suggestions for URL bar — cap scan at 50 matches
const suggestions = computed<FrecencyResult[]>(() => {
  if (!urlQuery.value || urlQuery.value.length < 2) return [];
  const q = urlQuery.value.toLowerCase();
  const matches: FrecencyResult[] = [];

  for (const h of historyEntries.value) {
    if (h.url.toLowerCase().includes(q) || h.title.toLowerCase().includes(q)) {
      matches.push({ url: h.url, title: h.title, favicon: h.favicon, score: frecencyScore(h.visitCount, h.lastVisitAt), type: 'history' });
      if (matches.length >= 50) break;
    }
  }
  for (const b of bookmarkData.value.bookmarks) {
    if (b.url.toLowerCase().includes(q) || b.title.toLowerCase().includes(q)) {
      const s = frecencyScore(1, b.createdAt) + 200;
      const idx = matches.findIndex(m => m.url === b.url);
      if (idx >= 0) { if (s > matches[idx].score) matches[idx] = { url: b.url, title: b.title, favicon: b.favicon, score: s, type: 'bookmark' }; }
      else matches.push({ url: b.url, title: b.title, favicon: b.favicon, score: s, type: 'bookmark' });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  const frecency = matches.slice(0, 6);

  for (const s of searchSugs.value) {
    if (!matches.some(m => m.url === s)) {
      frecency.push({ url: s, title: s, score: 0, type: 'search' });
    }
  }

  return frecency.slice(0, 10);
});

// RSS Live Folders — key watched by the fetch effect (W16)
const rssKey = computed(() =>
  bookmarkData.value.folders.filter(f => f.rssUrl).map(f => f.id + f.rssUrl).join(","));

// --- core helpers ---

function applyTheme(accent: string, mode: "dark" | "light") {
  const root = document.documentElement;
  root.style.setProperty("--accent-base", accent);
  if (mode === "light") root.classList.add("light");
  else root.classList.remove("light");
}

// clear loading after a delay since webview2 child events are unreliable
function clearLoading(tabId: string, ms = 2000) {
  setTimeout(() => {
    tabs.value = tabs.value.map(t => (t.id === tabId ? { ...t, loading: false } : t));
  }, ms);
}

// single function to position all pane webviews — replaces all
// switch_tab/resize_webviews calls
function syncLayout(ws?: Workspace, allTabs?: Tab[]) {
  const w = ws || activeWs.value;
  if (!w) return;
  const cw = window.innerWidth - layoutOffset.value;
  const ch = window.innerHeight - topOffset;
  const rect = { x: 0, y: 0, w: cw, h: ch };

  let panes: PaneRect[];
  if (w.paneLayout) {
    panes = computeRects(w.paneLayout, rect);
  } else {
    const t = (allTabs || tabs.value).find(t2 => t2.id === w.activeTabId);
    if (!t || t.url.startsWith("digidaw://")) panes = [];
    else panes = [{ tabId: w.activeTabId, ...rect }];
  }

  invoke("layout_webviews", { panes, focusedTabId: w.activeTabId, sidebarW: layoutOffset.value, topOffset });
}

// record history from navigation events
function recordHistory(url: string, title: string, favicon?: string) {
  if (!historyLoaded || url.startsWith("digidaw://") || !url.startsWith("http")) return;
  const now = Date.now();
  const prev = historyEntries.value;
  const idx = prev.findIndex(h => h.url === url);
  if (idx >= 0) {
    const updated = [...prev];
    updated[idx] = { ...updated[idx], title: title || updated[idx].title, favicon: favicon || updated[idx].favicon, lastVisitAt: now, visitCount: updated[idx].visitCount + 1 };
    historyEntries.value = updated;
  } else {
    const next = [{ url, title, favicon, visitCount: 1, lastVisitAt: now }, ...prev];
    if (next.length > 10000) next.length = 10000;
    historyEntries.value = next;
  }
  // sync history to CRDT (fire-and-forget)
  if (settings.value.syncEnabled) {
    invoke("sync_add_history", { url, title: title || "", favicon: favicon || null, timestamp: now }).catch(e => console.warn("[digidaw]", e));
  }
}

// --- workspace operations ---

function switchWorkspace(wsId: string) {
  activeWorkspaceId.value = wsId;
  const ws = workspaces.value.find(w => w.id === wsId);
  if (ws?.activeTabId) syncLayout(ws);
}

function addWorkspace() {
  const wsId = genWsId();
  const tabId = genId();
  const colorIdx = workspaces.value.length % WS_COLORS.length;
  const ws: Workspace = { id: wsId, name: `Space ${workspaces.value.length + 1}`, color: WS_COLORS[colorIdx], activeTabId: tabId };
  const tab: Tab = { id: tabId, url: NEW_TAB_URL, title: "New Tab", loading: true, workspaceId: wsId };

  workspaces.value = [...workspaces.value, ws];
  tabs.value = [...tabs.value, tab];
  activeWorkspaceId.value = wsId;
  const sr = settings.value;
  invoke("create_tab", { id: tabId, url: NEW_TAB_URL, sidebarW: layoutOffset.value, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, profileName: wsId, ...secArgs(sr) });
  clearLoading(tabId);
}

function deleteWorkspace(wsId: string) {
  // can't delete last workspace
  if (workspaces.value.length <= 1) return;

  const wsTabs = tabs.value.filter(t => t.workspaceId === wsId);

  // confirm before closing workspace with multiple tabs
  if (settings.value.confirmCloseMultiple && wsTabs.length > 1) {
    if (!window.confirm(`Close workspace with ${wsTabs.length} tabs?`)) return;
  }

  // close all webviews in this workspace
  wsTabs.forEach(t => invoke("close_tab", { id: t.id }));

  tabs.value = tabs.value.filter(t => t.workspaceId !== wsId);
  const next = workspaces.value.filter(w => w.id !== wsId);
  if (activeWorkspaceId.value === wsId && next.length > 0) {
    const newActive = next[0];
    activeWorkspaceId.value = newActive.id;
    if (newActive.activeTabId) syncLayout(newActive);
  }
  workspaces.value = next;
}

function renameWorkspace(wsId: string, name: string) {
  workspaces.value = workspaces.value.map(w => (w.id === wsId ? { ...w, name } : w));
}

function recolorWorkspace(wsId: string, color: string) {
  workspaces.value = workspaces.value.map(w => (w.id === wsId ? { ...w, color } : w));
}

function setWorkspaceIcon(wsId: string, icon: string | undefined) {
  workspaces.value = workspaces.value.map(w => (w.id === wsId ? { ...w, icon } : w));
}

function clearWorkspaceData(wsId: string) {
  // find any active webview tab in this workspace to get a handle
  const wsTab = tabs.value.find(t => t.workspaceId === wsId && !t.url.startsWith("digidaw://") && t.memoryState !== "destroyed");
  if (wsTab) {
    invoke("clear_workspace_data", { tabId: wsTab.id }).catch(e => console.warn("[digidaw]", e));
  }
}

function moveTabToWorkspace(tabId: string, targetWsId: string) {
  const tab = tabs.value.find(t => t.id === tabId);
  if (!tab || tab.workspaceId === targetWsId) return;

  // profile isolation: moving tab means different cookie jar — confirm with user
  if (!window.confirm("Moving this tab will reload it in a different session. You may be logged out. Continue?")) return;

  const savedUrl = tab.url;
  const sourceWsId = tab.workspaceId;

  // close old webview (profile is locked at creation time)
  if (!savedUrl.startsWith("digidaw://")) {
    invoke("close_tab", { id: tabId });
  }

  // create new tab in target workspace with correct profile
  const newId = genId();
  const without = tabs.value.filter(t => t.id !== tabId);
  tabs.value = [...without, { id: newId, url: savedUrl, title: tab.title, loading: true, workspaceId: targetWsId, lastActiveAt: Date.now() } as Tab];

  workspaces.value = workspaces.value.map(w => {
    if (w.id === sourceWsId && w.activeTabId === tabId) {
      const remaining = tabs.value.filter(t => t.workspaceId === sourceWsId && t.id !== tabId);
      const newActiveId = remaining.length > 0 ? remaining[0].id : "";
      let newLayout = w.paneLayout;
      if (newLayout && hasLeaf(newLayout, tabId)) {
        newLayout = removePane(newLayout, tabId) || undefined;
      }
      const updated = { ...w, activeTabId: newActiveId, paneLayout: newLayout };
      if (sourceWsId === activeWorkspaceId.value && newActiveId) syncLayout(updated);
      return updated;
    }
    if (w.id === targetWsId) return { ...w, activeTabId: newId };
    return w;
  });

  // create webview in target workspace's profile
  if (!savedUrl.startsWith("digidaw://")) {
    const sr = settings.value;
    invoke("create_tab", { id: newId, url: savedUrl, sidebarW: layoutOffset.value, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, profileName: targetWsId, ...secArgs(sr) });
  }
}

function duplicateWorkspace(wsId: string) {
  const source = workspaces.value.find(w => w.id === wsId);
  if (!source) return;
  const newWsId = genWsId();
  const tabId = genId();
  const ws: Workspace = { id: newWsId, name: source.name + " Copy", color: source.color, icon: source.icon, activeTabId: tabId };
  const tab: Tab = { id: tabId, url: NEW_TAB_URL, title: "New Tab", loading: true, workspaceId: newWsId };
  workspaces.value = [...workspaces.value, ws];
  tabs.value = [...tabs.value, tab];
  const sr = settings.value;
  invoke("create_tab", { id: tabId, url: NEW_TAB_URL, sidebarW: layoutOffset.value, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, profileName: newWsId, ...secArgs(sr) });
  clearLoading(tabId);
}

function reorderWorkspaces(fromIdx: number, toIdx: number) {
  const next = [...workspaces.value];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  workspaces.value = next;
}

function muteTab(tabId: string) {
  invoke("media_mute", { id: tabId });
}

function renameTab(tabId: string, customTitle: string) {
  tabs.value = tabs.value.map(t => (t.id === tabId ? { ...t, customTitle: customTitle || undefined } : t));
}

// --- tab operations (workspace-aware) ---

function addTab(url = NEW_TAB_URL, parentId?: string) {
  const id = genId();
  const isInternal = url.startsWith("digidaw://");
  const title = url === SETTINGS_URL ? "Settings" : "New Tab";
  const tab: Tab = { id, url, title, loading: !isInternal, workspaceId: activeWorkspaceId.value, parentId, lastActiveAt: Date.now() };
  tabs.value = [...tabs.value, tab];
  workspaces.value = workspaces.value.map(w => (w.id === activeWorkspaceId.value ? { ...w, activeTabId: id, paneLayout: undefined } : w));
  if (!isInternal) {
    const sr = settings.value;
    const cw = window.innerWidth - layoutOffset.value;
    const ch = window.innerHeight - topOffset;
    invoke("create_tab", { id, url, sidebarW: layoutOffset.value, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, profileName: activeWorkspaceId.value, ...secArgs(sr) }).then(() => {
      invoke("layout_webviews", { panes: [{ tabId: id, x: 0, y: 0, w: cw, h: ch }], focusedTabId: id, sidebarW: layoutOffset.value, topOffset });
    }).catch(() => {
      showError("Failed to create tab");
      tabs.value = tabs.value.filter(t => t.id !== id);
    });
    clearLoading(id);
  } else {
    // hide all webviews since internal pages are Vue-rendered
    invoke("layout_webviews", { panes: [], focusedTabId: "__none__", sidebarW: layoutOffset.value, topOffset });
  }
}

function closeTab(id: string) {
  // if source tab of glance is being closed, close glance too
  if (glance.value?.sourceTabId === id) {
    invoke("close_glance", { glanceId: glance.value.id }).catch(e => console.warn("[digidaw]", e));
    glance.value = null;
  }
  invoke("close_tab", { id });
  const prev = tabs.value;
  const tab = prev.find(t => t.id === id);
  if (!tab) return;
  if (!tab.url.startsWith("digidaw://")) {
    closedTabs.push({ url: tab.url, title: tab.title, workspaceId: tab.workspaceId });
    if (closedTabs.length > 20) closedTabs.shift();
  }
  const wsId = tab.workspaceId;
  const wsTabs = prev.filter(t => t.workspaceId === wsId);
  const next = prev.filter(t => t.id !== id).map(t =>
    t.parentId === id ? { ...t, parentId: tab.parentId } : t
  );

  if (wsTabs.length <= 1) {
    const newId = genId();
    const newTab: Tab = { id: newId, url: NTP_URL, title: "New Tab", loading: false, workspaceId: wsId, lastActiveAt: Date.now() };
    invoke("layout_webviews", { panes: [], focusedTabId: "__none__", sidebarW: layoutOffset.value, topOffset });
    workspaces.value = workspaces.value.map(w => (w.id === wsId ? { ...w, activeTabId: newId, paneLayout: undefined } : w));
    tabs.value = [...next, newTab];
    return;
  }

  workspaces.value = workspaces.value.map(w => {
    if (w.id !== wsId) return w;

    // tab was in a pane layout
    if (w.paneLayout && hasLeaf(w.paneLayout, id)) {
      const newLayout = removePane(w.paneLayout, id);
      // removePane returns null if ≤1 leaf remains → exit split
      const newActive = w.activeTabId === id
        ? (newLayout ? allLeafIds(newLayout).find(lid => lid !== id) || "" : allLeafIds(w.paneLayout).find(lid => lid !== id) || "")
        : w.activeTabId;
      const updated = { ...w, activeTabId: newActive, paneLayout: newLayout || undefined };
      if (wsId === activeWorkspaceId.value) syncLayout(updated, next);
      return updated;
    }

    // closed the active tab (no split) → switch to most recent or adjacent
    if (w.activeTabId === id) {
      const wsTabsInNext = next.filter(t => t.workspaceId === wsId);
      let newActive: Tab | undefined;
      if (settings.value.selectRecentTabOnClose) {
        // pick the tab with the highest lastActiveAt timestamp
        newActive = wsTabsInNext.reduce<Tab | undefined>((best, t) =>
          !best || (t.lastActiveAt || 0) > (best.lastActiveAt || 0) ? t : best, undefined);
      } else {
        const oldIdx = wsTabs.findIndex(t => t.id === id);
        newActive = wsTabsInNext[Math.min(oldIdx, wsTabsInNext.length - 1)];
      }
      const updated = { ...w, activeTabId: newActive?.id || "" };
      if (wsId === activeWorkspaceId.value) syncLayout(updated, next);
      return updated;
    }

    return w;
  });
  tabs.value = next;
}

function selectTab(id: string) {
  const targetTab = tabs.value.find(t => t.id === id);
  const ws = workspaces.value.find(w => w.id === activeWorkspaceId.value);
  const isInternal = targetTab?.url === NTP_URL || targetTab?.url === SETTINGS_URL;

  // capture thumbnail of outgoing tab for instant-swap on future restore
  const outgoing = ws?.activeTabId;
  if (outgoing && outgoing !== id && !tabs.value.find(t => t.id === outgoing)?.url.startsWith("digidaw://")) {
    invoke<string>("capture_visible", { id: outgoing }).then(b64 => {
      tabThumbnails.set(outgoing, b64);
      if (tabThumbnails.size > 100) {
        const first = tabThumbnails.keys().next().value;
        if (first) tabThumbnails.delete(first);
      }
    }).catch(() => {});
  }

  tabs.value = tabs.value.map(t => (t.id === id ? { ...t, lastActiveAt: Date.now() } : t));

  // if tab is already in a pane, just change focus (no layout change)
  if (ws?.paneLayout && hasLeaf(ws.paneLayout, id) && !isInternal) {
    const updated = { ...ws, activeTabId: id };
    workspaces.value = workspaces.value.map(w => (w.id === activeWorkspaceId.value ? updated : w));
    syncLayout(updated);
    return;
  }

  // internal pages exit split
  const newLayout = isInternal ? undefined : ws?.paneLayout;
  const updated = { ...ws!, activeTabId: id, paneLayout: newLayout };
  workspaces.value = workspaces.value.map(w => (w.id === activeWorkspaceId.value ? updated : w));

  if (targetTab?.crashed) {
    // recreate crashed webview
    const sr = settings.value;
    invoke("close_tab", { id }).then(() =>
      invoke("create_tab", { id, url: targetTab.url, sidebarW: layoutOffset.value, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, profileName: targetTab.workspaceId, ...secArgs(sr) })
    ).then(() => syncLayout(updated));
    clearLoading(id);
    tabs.value = tabs.value.map(t => (t.id === id ? { ...t, crashed: false, loading: true, lastActiveAt: Date.now() } : t));
  } else if (targetTab?.memoryState === "suspended") {
    // instant resume — no page reload needed
    invoke("resume_tab", { id });
    tabs.value = tabs.value.map(t => (t.id === id ? { ...t, memoryState: "active" as const, lastActiveAt: Date.now() } : t));
    syncLayout(updated);
  } else if (targetTab?.suspended || targetTab?.memoryState === "destroyed") {
    // show cached thumbnail while webview loads
    const thumb = tabThumbnails.get(id);
    if (thumb) tabPreview.value = thumb;
    const sr = settings.value;
    invoke("create_tab", { id, url: targetTab.url, sidebarW: layoutOffset.value, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, profileName: targetTab.workspaceId, ...secArgs(sr) }).then(() => {
      syncLayout(updated);
      setTimeout(() => { tabPreview.value = null; }, 300);
    });
    clearLoading(id);
    tabs.value = tabs.value.map(t => (t.id === id ? { ...t, suspended: false, memoryState: "active" as const, loading: true, lastActiveAt: Date.now() } : t));
  } else if (isInternal) {
    invoke("layout_webviews", { panes: [], focusedTabId: "__none__", sidebarW: layoutOffset.value, topOffset });
  } else {
    syncLayout(updated);
  }
}

function pinTab(id: string) {
  const tab = tabs.value.find(t => t.id === id);
  const willPin = tab ? !tab.pinned : true;
  invoke("set_tab_pinned", { id, pinned: willPin }).catch(e => console.warn("[digidaw]", e));
  tabs.value = tabs.value.map(t => (t.id === id ? { ...t, pinned: willPin } : t));
}

// --- glance ops ---

function closeGlance() {
  const g = glance.value;
  if (!g) return;
  invoke("close_glance", { glanceId: g.id });
  glance.value = null;
  syncLayout();
}

function expandGlance() {
  const g: GlanceState | null = glance.value;
  if (!g) return;
  invoke("promote_glance", { glanceId: g.id });
  // add as a real tab — use glance_id as tab id (matches webview label)
  const newTab: Tab = {
    id: g.id, url: g.url, title: g.title,
    loading: false, workspaceId: activeWorkspaceId.value, lastActiveAt: Date.now(),
  };
  tabs.value = [...tabs.value, newTab];
  workspaces.value = workspaces.value.map(w => (w.id === activeWorkspaceId.value ? { ...w, activeTabId: g.id, paneLayout: undefined } : w));
  glance.value = null;
  // syncLayout will be called by the workspace/tab update effects
  setTimeout(() => syncLayout(), 50);
}

function splitGlance() {
  const g = glance.value;
  if (!g) return;
  invoke("close_glance", { glanceId: g.id });
  glance.value = null;
  // open URL as a new tab (addTab will handle layout)
  addTab(g.url);
}

function toggleCollapse(id: string) {
  tabs.value = tabs.value.map(t => (t.id === id ? { ...t, collapsed: !t.collapsed } : t));
}

function reorderTabs(from: number, to: number) {
  const prev = tabs.value;
  const wsTabs = prev.filter(t => t.workspaceId === activeWorkspaceId.value && !t.pinned);
  const otherTabs = prev.filter(t => t.workspaceId !== activeWorkspaceId.value || t.pinned);
  const item = wsTabs[from];
  if (!item) return;
  wsTabs.splice(from, 1);
  wsTabs.splice(to, 0, item);
  // rebuild: pinned first within ws, then unpinned, then other ws tabs
  const wsPinned = prev.filter(t => t.workspaceId === activeWorkspaceId.value && t.pinned);
  tabs.value = [...wsPinned, ...wsTabs, ...otherTabs.filter(t => t.workspaceId !== activeWorkspaceId.value)];
}

function getSearchUrl(query: string) {
  const q = encodeURIComponent(query);
  switch (settings.value.searchEngine) {
    case "duckduckgo": return `https://duckduckgo.com/?q=${q}`;
    case "brave": return `https://search.brave.com/search?q=${q}`;
    case "bing": return `https://www.bing.com/search?q=${q}`;
    case "custom": return settings.value.customSearchUrl ? settings.value.customSearchUrl.replace("%s", q) : `https://www.google.com/search?q=${q}`;
    default: return `https://www.google.com/search?q=${q}`;
  }
}

function navigate(url: string) {
  if (!activeTab.value) return;
  let finalUrl = url;
  if (!/^https?:\/\//i.test(url)) {
    if (/\.\w{2,}/.test(url)) {
      finalUrl = "https://" + url;
    } else {
      finalUrl = getSearchUrl(url);
    }
  }
  const currentTab = tabs.value.find(t => t.id === activeTab.value);
  tabs.value = tabs.value.map(t => (t.id === activeTab.value ? { ...t, url: finalUrl, loading: true, blockedCount: 0 } : t));
  if (currentTab?.url?.startsWith("digidaw://") || currentTab?.suspended || currentTab?.memoryState === "destroyed" || currentTab?.memoryState === "suspended") {
    const sr = settings.value;
    invoke("create_tab", { id: activeTab.value, url: finalUrl, sidebarW: layoutOffset.value, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, profileName: currentTab?.workspaceId, ...secArgs(sr) }).then(() => {
      // directly position — syncLayout would read stale tab URL from state
      const cw = window.innerWidth - layoutOffset.value;
      const ch = window.innerHeight - topOffset;
      invoke("layout_webviews", { panes: [{ tabId: activeTab.value, x: 0, y: 0, w: cw, h: ch }], focusedTabId: activeTab.value, sidebarW: layoutOffset.value, topOffset });
    });
    if (currentTab?.suspended || currentTab?.memoryState === "destroyed" || currentTab?.memoryState === "suspended") {
      tabs.value = tabs.value.map(t => (t.id === activeTab.value ? { ...t, suspended: false, memoryState: "active" as const } : t));
    }
  } else {
    invoke("navigate_tab", { id: activeTab.value, url: finalUrl });
  }
  clearLoading(activeTab.value, 3000);
}

// split view — toggle or split with a specific tab, optional side
function toggleSplit(targetId?: string, side: "left" | "right" | "top" | "bottom" = "right") {
  const ws = workspaces.value.find(w => w.id === activeWorkspaceId.value);
  if (!ws) return;

  // already split → exit
  if (ws.paneLayout) {
    const updated = { ...ws, paneLayout: undefined };
    workspaces.value = workspaces.value.map(w => (w.id === activeWorkspaceId.value ? updated : w));
    syncLayout(updated);
    return;
  }

  // find a tab to split with
  const wsTabs = tabs.value.filter(t => t.workspaceId === activeWorkspaceId.value && !t.url.startsWith("digidaw://") && !t.suspended && t.memoryState !== "destroyed");
  let splitWith = targetId;
  if (!splitWith) {
    const candidates = wsTabs.filter(t => t.id !== ws.activeTabId).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0));
    splitWith = candidates[0]?.id;
  }
  if (!splitWith || splitWith === ws.activeTabId) return;

  // can't split if active tab is internal
  const activeT = tabs.value.find(t => t.id === ws.activeTabId);
  if (activeT?.url.startsWith("digidaw://")) return;

  const newLayout = insertPane(null, ws.activeTabId, splitWith, side);
  if (!newLayout) return;
  const updated = { ...ws, paneLayout: newLayout };
  workspaces.value = workspaces.value.map(w => (w.id === activeWorkspaceId.value ? updated : w));
  syncLayout(updated);
}

// --- divider drag ---
function onDividerDown(idx: number, e: MouseEvent) {
  e.preventDefault();
  draggingDiv.value = idx;
  const div = dividers.value[idx];
  if (!div) return;
  let lastPos = div.dir === "row" ? e.clientX : e.clientY;
  const dimension = div.dir === "row" ? window.innerWidth - layoutOffset.value : window.innerHeight - topOffset;
  let rafId = 0;
  let pendingDelta = 0;
  let currentLayout = activeWs.value?.paneLayout;
  if (!currentLayout) return;

  // hide webviews so mousemove fires over the whole area (native webviews steal pointer)
  invoke("layout_webviews", { panes: [], focusedTabId: "__none__", sidebarW: layoutOffset.value, topOffset });

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
    draggingDiv.value = null;
    if (currentLayout) {
      const finalLayout = currentLayout;
      workspaces.value = workspaces.value.map(w =>
        w.id === activeWorkspaceId.value ? { ...w, paneLayout: finalLayout } : w
      );
      // show webviews at final positions
      const cw = window.innerWidth - layoutOffset.value;
      const ch = window.innerHeight - topOffset;
      const panes = computeRects(finalLayout, { x: 0, y: 0, w: cw, h: ch });
      const focusId = activeWs.value?.activeTabId || "";
      invoke("layout_webviews", { panes, focusedTabId: focusId, sidebarW: layoutOffset.value, topOffset });
    }
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

// drag-to-split: mouse-based fake drag (HTML5 drag events don't work over
// WebView2 areas). Same pattern as divider drag: mousedown → mousemove on
// document → mouseup. Sidebar applies the 5px threshold before calling this.
function onTabSplitDrag(tabId: string) {
  // immediately hide webviews and show overlay
  invoke("layout_webviews", { panes: [], focusedTabId: "__none__", sidebarW: layoutOffset.value, topOffset });
  dragOverContent.value = true;

  const onMove = (e: MouseEvent) => {
    // RAF-gated zone detection
    if (dropRaf) return;
    dropRaf = requestAnimationFrame(() => {
      dropRaf = 0;
      if (!mainRef.value) return;
      const rect = mainRef.value.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        dropZone.value = null;
        return;
      }
      const ws = workspaces.value.find(w => w.id === activeWorkspaceId.value);
      const zone = detectDropZone(
        ws?.paneLayout || undefined,
        ws?.activeTabId || "",
        { x: 0, y: 0, w: rect.width, h: rect.height },
        e.clientX - rect.left,
        e.clientY - rect.top
      );
      dropZone.value = zone;
    });
  };

  const onUp = (e: MouseEvent) => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    if (dropRaf) { cancelAnimationFrame(dropRaf); dropRaf = 0; }

    const currentDropZone = dropZone.value;
    dragOverContent.value = false;
    dropZone.value = null;

    const tab = tabs.value.find(t => t.id === tabId);
    if (tab && !tab.url.startsWith("digidaw://") && currentDropZone) {
      const ws = workspaces.value.find(w => w.id === activeWorkspaceId.value);
      if (ws) {
        if (tabId === currentDropZone.anchorTabId) { syncLayout(); return; }
        let base = ws.paneLayout || null;
        if (base && hasLeaf(base, tabId)) base = removePane(base, tabId);
        const newLayout = insertPane(base, currentDropZone.anchorTabId, tabId, currentDropZone.side);
        if (newLayout) {
          const updated = { ...ws, paneLayout: newLayout };
          workspaces.value = workspaces.value.map(w => (w.id === activeWorkspaceId.value ? updated : w));
          syncLayout(updated);
          return;
        }
      }
    }
    syncLayout();
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function setZoom(tabId: string, factor: number) {
  zoom[tabId] = factor;
  zoomDisplay.value = { ...zoomDisplay.value, [tabId]: factor };
  invoke("zoom_tab", { id: tabId, factor });
  const tab = tabs.value.find(t => t.id === tabId);
  if (tab) {
    const domain = extractDomain(tab.url);
    if (domain) {
      const s = settings.value;
      const zh = { ...s.zoomHistory };
      if (factor === 1) delete zh[domain];
      else zh[domain] = factor;
      settings.value = { ...s, zoomHistory: zh };
    }
  }
}

function toggleWhitelist() {
  if (!activeTab.value) return;
  const tab = tabs.value.find(t => t.id === activeTab.value);
  if (!tab) return;
  let domain = "";
  try { domain = new URL(tab.url).hostname; } catch {}
  if (!domain) return;
  invoke<boolean>("toggle_whitelist", { domain }).then(whitelisted => {
    tabs.value = tabs.value.map(t => (t.id === activeTab.value ? { ...t, whitelisted } : t));
    invoke("reload_tab", { id: activeTab.value });
  });
}

// --- bookmark operations ---

function addBookmark(url: string, title: string, favicon?: string, folderId = "") {
  const id = `bm-${Date.now()}`;
  const createdAt = Date.now();
  const prev = bookmarkData.value;
  const order = prev.bookmarks.filter(b => b.folderId === folderId).length;
  bookmarkData.value = { ...prev, bookmarks: [...prev.bookmarks, { id, url, title, favicon, folderId, createdAt, order }] };
  invoke("sync_add_bookmark", { id, url, title, favicon: favicon || null, folderId, createdAt }).catch(e => console.warn("[digidaw]", e));
}

function removeBookmark(id: string) {
  const prev = bookmarkData.value;
  bookmarkData.value = { ...prev, bookmarks: prev.bookmarks.filter(b => b.id !== id) };
  invoke("sync_remove_bookmark", { id }).catch(e => console.warn("[digidaw]", e));
}

function editBookmark(id: string, title: string, url: string) {
  const prev = bookmarkData.value;
  bookmarkData.value = { ...prev, bookmarks: prev.bookmarks.map(b => (b.id === id ? { ...b, title, url } : b)) };
}

function addBookmarkFolder(name: string, parentId = "root"): string {
  const id = `bmf-${Date.now()}`;
  const prev = bookmarkData.value;
  bookmarkData.value = { ...prev, folders: [...prev.folders, { id, name, parentId, order: prev.folders.length }] };
  invoke("sync_add_folder", { id, name, parentId, order: 0 }).catch(e => console.warn("[digidaw]", e));
  return id;
}

function renameBookmarkFolder(folderId: string, name: string) {
  const prev = bookmarkData.value;
  bookmarkData.value = { ...prev, folders: prev.folders.map(f => (f.id === folderId ? { ...f, name } : f)) };
  invoke("sync_rename_folder", { id: folderId, name }).catch(e => console.warn("[digidaw]", e));
}

function deleteBookmarkFolder(folderId: string) {
  const prev = bookmarkData.value;
  bookmarkData.value = {
    ...prev,
    folders: prev.folders.filter(f => f.id !== folderId),
    bookmarks: prev.bookmarks.map(b => (b.folderId === folderId ? { ...b, folderId: "" } : b)),
  };
  invoke("sync_remove_folder", { id: folderId }).catch(e => console.warn("[digidaw]", e));
}

function moveBookmarkToFolder(bookmarkId: string, folderId: string) {
  const prev = bookmarkData.value;
  bookmarkData.value = { ...prev, bookmarks: prev.bookmarks.map(b => (b.id === bookmarkId ? { ...b, folderId } : b)) };
  invoke("sync_move_bookmark", { id: bookmarkId, folderId }).catch(e => console.warn("[digidaw]", e));
}

function reorderBookmarks(bookmarkId: string, targetId: string, position: "before" | "after") {
  const prev = bookmarkData.value;
  const bm = prev.bookmarks.find(b => b.id === bookmarkId);
  const target = prev.bookmarks.find(b => b.id === targetId);
  if (!bm || !target) return;
  const targetFolder = target.folderId;
  const inFolder = prev.bookmarks
    .filter(b => b.folderId === targetFolder && b.id !== bookmarkId)
    .sort((a, b) => a.order - b.order);
  const targetIdx = inFolder.findIndex(b => b.id === targetId);
  const insertIdx = position === "before" ? targetIdx : targetIdx + 1;
  inFolder.splice(insertIdx, 0, { ...bm, folderId: targetFolder });
  const reordered = inFolder.map((b, i) => ({ ...b, order: i }));
  const others = prev.bookmarks.filter(b => b.folderId !== targetFolder && b.id !== bookmarkId);
  bookmarkData.value = { ...prev, bookmarks: [...others, ...reordered] };
}

function reorderFolders(folderId: string, targetFolderId: string, position: "before" | "after") {
  const prev = bookmarkData.value;
  const folder = prev.folders.find(f => f.id === folderId);
  if (!folder) return;
  const folders = prev.folders.filter(f => f.id !== folderId).sort((a, b) => a.order - b.order);
  const targetIdx = folders.findIndex(f => f.id === targetFolderId);
  const insertIdx = position === "before" ? targetIdx : targetIdx + 1;
  folders.splice(insertIdx, 0, folder);
  bookmarkData.value = { ...prev, folders: folders.map((f, i) => ({ ...f, order: i })) };
}

// --- RSS Live Folders ---
function setFolderRss(folderId: string, rssUrl: string) {
  const prev = bookmarkData.value;
  bookmarkData.value = { ...prev, folders: prev.folders.map(f => (f.id === folderId ? { ...f, rssUrl, lastFetched: 0, autoItems: [] } : f)) };
}

function removeFolderRss(folderId: string) {
  const prev = bookmarkData.value;
  bookmarkData.value = { ...prev, folders: prev.folders.map(f => (f.id === folderId ? { ...f, rssUrl: undefined, lastFetched: undefined, autoItems: undefined } : f)) };
}

function toggleBookmark() {
  const cur = current.value;
  if (!cur) return;
  const existing = bookmarkData.value.bookmarks.find(b => b.url === cur.url);
  if (existing) removeBookmark(existing.id);
  else addBookmark(cur.url, cur.title, cur.favicon);
}

// --- history operations ---

function removeHistoryEntry(url: string) {
  historyEntries.value = historyEntries.value.filter(h => h.url !== url);
  invoke("delete_history_entry", { url }).catch(e => console.warn("[digidaw] delete history entry:", e));
}

function clearHistory(range: 'hour' | 'today' | 'all') {
  if (range === 'all') { historyEntries.value = []; return; }
  const cutoff = range === 'hour' ? Date.now() - 3600_000 : new Date().setHours(0, 0, 0, 0);
  historyEntries.value = historyEntries.value.filter(h => h.lastVisitAt < cutoff);
}

function selectBookmark(url: string) {
  if (!activeTab.value) return;
  navigate(url);
}

function onSuggestionSelect(url: string) {
  navigate(url);
  urlQuery.value = "";
}

function onUrlInputChange(query: string) {
  urlQuery.value = query;
}

function toggleHistory() {
  historyOpen.value = !historyOpen.value;
}

// --- reader mode ---

function toggleReader() {
  if (!activeTab.value) return;
  const tab = tabs.value.find(t => t.id === activeTab.value);
  if (!tab || tab.url.startsWith("digidaw://") || tab.suspended || tab.memoryState === "suspended" || tab.memoryState === "destroyed") return;

  invoke("toggle_reader", {
    id: activeTab.value,
    fontSize: readerSettings.value.fontSize,
    font: readerSettings.value.font,
    theme: readerSettings.value.theme,
    lineWidth: readerSettings.value.lineWidth,
  });

  const next = new Set(readerTabs.value);
  if (next.has(activeTab.value)) next.delete(activeTab.value);
  else next.add(activeTab.value);
  readerTabs.value = next;
}

function updateReaderSettings(update: Partial<ReaderSettings>) {
  const next = { ...readerSettings.value, ...update };
  settings.value = {
    ...settings.value,
    readerFontSize: next.fontSize,
    readerFont: next.font,
    readerTheme: next.theme,
    readerLineWidth: next.lineWidth,
  };
  readerSettings.value = next;
}

// --- picture in picture ---

function togglePip() {
  if (!activeTab.value) return;
  invoke("toggle_pip", { id: activeTab.value });
}

// --- settings / screenshot / actions ---

function onOpenSettings() {
  const existing = tabs.value.find(t => t.url === SETTINGS_URL);
  if (existing) {
    selectTab(existing.id);
    return;
  }
  addTab(SETTINGS_URL);
}

// Screenshot: capture viewport while webview is on-screen, then hide + open overlay
async function openScreenshot() {
  if (!activeTab.value) return;
  try {
    const b64: string = await invoke("capture_visible", { id: activeTab.value });
    // Hide webviews so the Vue overlay is visible
    invoke("layout_webviews", { panes: [], focusedTabId: activeTab.value, sidebarW: 0, topOffset: 0 });
    screenshotPreview.value = b64;
  } catch (e: any) {
    // If capture fails, still open overlay with empty preview
    invoke("layout_webviews", { panes: [], focusedTabId: activeTab.value || "__none__", sidebarW: 0, topOffset: 0 });
    screenshotPreview.value = "";
  }
}

function toggleCompactMode() {
  const next = !compactMode.value;
  compactMode.value = next;
  settings.value = { ...settings.value, compactMode: next };
}

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value;
}

function closeScreenshot() {
  screenshotPreview.value = null;
  syncLayout();
}

function annotateScreenshot(data: string) {
  screenshotPreview.value = null;
  annotationData.value = data;
}

function closeAnnotation() {
  annotationData.value = null;
  syncLayout();
}

function executeAction(action: string) {
  switch (action) {
    case "action-new-tab": addTab(); break;
    case "action-close-tab": closeTab(activeTab.value); break;
    case "action-toggle-compact": toggleCompactMode(); break;
    case "action-toggle-sidebar": toggleSidebar(); break;
    case "action-settings": onOpenSettings(); break;
    case "action-reader-mode": toggleReader(); break;
    case "action-clear-history": clearHistory("all"); break;
    case "action-history": historyOpen.value = true; break;
    case "action-bookmark": toggleBookmark(); break;
    case "action-screenshot": openScreenshot(); break;
  }
}

function handleQuickAction(action: string) {
  switch (action) {
    case "toggleCompact": toggleCompactMode(); break;
    case "splitView": toggleSplit(); break;
    case "openSettings": onOpenSettings(); break;
    case "togglePin": pinTab(activeTab.value); break;
    case "muteTab": muteTab(activeTab.value); break;
    case "addBookmark": toggleBookmark(); break;
    case "copyUrl": { const t = tabs.value.find(x => x.id === activeTab.value); if (t) navigator.clipboard.writeText(t.url); break; }
    case "screenshot": openScreenshot(); break;
    case "toggleReader": toggleReader(); break;
    case "togglePip": togglePip(); break;
    case "zoomIn": { const z = Math.min((zoom[activeTab.value] || 1) + 0.1, 3); setZoom(activeTab.value, z); break; }
    case "zoomOut": { const z = Math.max((zoom[activeTab.value] || 1) - 0.1, 0.3); setZoom(activeTab.value, z); break; }
    case "zoomReset": setZoom(activeTab.value, 1); break;
    case "findInPage": findOpen.value = true; break;
    case "printPage": invoke("print_tab", { id: activeTab.value }); break;
    case "toggleDevtools": invoke("toggle_devtools", { id: activeTab.value }); break;
    case "toggleFullscreen": invoke("toggle_fullscreen"); break;
    case "clearHistory": clearHistory("all"); break;
    case "newWorkspace": addWorkspace(); break;
    case "closeTab": closeTab(activeTab.value); break;
  }
}

// --- stable callbacks for child components ---
function addChildTab(parentId: string) { addTab(NEW_TAB_URL, parentId); }
function goBack() { invoke("go_back", { id: activeTab.value }); }
function goForward() { invoke("go_forward", { id: activeTab.value }); }
function goReload() { invoke("reload_tab", { id: activeTab.value }); }
function closeFindBar() { findOpen.value = false; }

// --- download callbacks ---
function pauseDownload(id: string) { invoke("pause_download", { id }); }
function resumeDownload(id: string) { invoke("resume_download", { id }); }
function cancelDownload(id: string) { invoke("cancel_download", { id }); }
function openDownload(id: string) { invoke("open_download", { id }); }
function openDownloadFolder(id: string) { invoke("open_download_folder", { id }); }
function retryDownload(id: string) {
  const dl = downloads.value.find(d => d.id === id);
  if (!dl) return;
  cancelDownload(id);
  const dir = settings.value.downloadLocation || "";
  invoke("start_download", { url: dl.url, filename: dl.fileName, downloadDir: dir, cookies: null });
}
function clearCompletedDownloads() {
  downloads.value = downloads.value.filter(d => d.state !== "completed");
}
function toggleDownloads() { downloadsOpen.value = !downloadsOpen.value; }

function toggleNetwork() { networkOpen.value = !networkOpen.value; }
function clearNetworkLog() {
  if (!activeTab.value) return;
  networkEntries.value = [];
  invoke("clear_network_log", { tabId: activeTab.value });
}

// --- media controls ---
function mediaPlayPause() {
  if (playingTab.value) invoke("media_play_pause", { id: playingTab.value.id });
}
function mediaMute() {
  if (playingTab.value) invoke("media_mute", { id: playingTab.value.id });
}

// --- panels ---
function togglePanel(panelId: string) {
  if (activePanelId.value === panelId) {
    invoke("position_panel", { id: panelId, x: -9999, y: 0, w: PANEL_W, h: 0 });
    activePanelId.value = null;
  } else {
    if (activePanelId.value) {
      invoke("position_panel", { id: activePanelId.value, x: -9999, y: 0, w: PANEL_W, h: 0 });
    }
    activePanelId.value = panelId;
  }
}

function addPanel(rawUrl: string) {
  const url = sanitizePanelUrl(rawUrl);
  if (!url) return;
  if (panels.value.some(p => p.url === url)) return;
  const id = genId("panel");
  let favicon: string | undefined;
  try { favicon = `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`; } catch {}
  panels.value = [...panels.value, { id, url, title: url, favicon }];
  const sr = settings.value;
  invoke("create_tab", { id, url, sidebarW: sidebarW.value, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: true, ...secArgs(sr) })
    .then(() => invoke("register_panel", { id }));
  activePanelId.value = id;
}

function removePanel(panelId: string) {
  invoke("unregister_panel", { id: panelId }).then(() => invoke("close_tab", { id: panelId }));
  panels.value = panels.value.filter(p => p.id !== panelId);
  if (activePanelId.value === panelId) activePanelId.value = null;
}

function reorderPanels(reordered: WebPanel[]) {
  panels.value = reordered;
}

function positionActivePanel() {
  if (!activePanelId.value || compactMode.value) return;
  const h = window.innerHeight - topOffset;
  invoke("position_panel", { id: activePanelId.value, x: sidebarW.value, y: topOffset, w: PANEL_W, h });
}

// --- onboarding handlers ---
function handleOnboardingComplete() {
  showOnboarding.value = false;
  settings.value = { ...settings.value, onboardingComplete: true };
}

function handleImportBookmarks(imported: { title: string; url: string; folder: string }[]) {
  bookmarkBulk = true; // allow debounced save_bookmarks for bulk import
  const prev = bookmarkData.value;
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
  bookmarkData.value = { bookmarks: [...prev.bookmarks, ...newBookmarks], folders };
}

function handleImportHistory(imported: { title: string; url: string; visit_count: number; last_visit: number }[]) {
  const prev = historyEntries.value;
  const existing = new Set(prev.map(h => h.url));
  const newEntries = imported
    .filter(h => h.url && !existing.has(h.url))
    .map(h => ({
      url: h.url,
      title: h.title || h.url,
      visitCount: h.visit_count,
      lastVisitAt: h.last_visit,
    }));
  historyEntries.value = [...prev, ...newEntries];
}

function handleThemeChange(accent: string, mode: "dark" | "light") {
  applyTheme(accent, mode);
  settings.value = { ...settings.value, accentColor: accent, themeMode: mode };
}

function reloadAllTabs() {
  const sr = settings.value;
  const base = { httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, ...secArgs(sr) };
  tabs.value.forEach(t => {
    if (t.url.startsWith("digidaw://") || t.suspended || t.memoryState === "destroyed") return;
    invoke("close_tab", { id: t.id }).then(() => {
      invoke("create_tab", { id: t.id, url: t.url, sidebarW: layoutOffset.value, topOffset, isPanel: false, profileName: t.workspaceId, ...base });
    });
  });
  panels.value.forEach(p => {
    invoke("close_tab", { id: p.id }).then(() => {
      invoke("create_tab", { id: p.id, url: p.url, sidebarW: layoutOffset.value, topOffset, isPanel: true, ...base })
        .then(() => invoke("register_panel", { id: p.id }));
    });
  });
  setTimeout(() => {
    const ws = workspaces.value.find(w => w.id === activeWorkspaceId.value);
    if (ws) syncLayout(ws);
  }, 500);
}

function updateSettings(patch: Partial<DigidawSettings>) {
  const next = { ...settings.value, ...patch };
  // sync compactMode toggle from settings to app state
  if ("compactMode" in patch && patch.compactMode !== compactMode.value) {
    compactMode.value = patch.compactMode!;
  }
  settings.value = next;
}

function minimizeWindow() { invoke("minimize_window"); }
function maximizeWindow() { invoke("maximize_window"); }
async function closeWindow() {
  if (settings.value.confirmBeforeQuit && tabs.value.length > 1) {
    if (!window.confirm(`Quit with ${tabs.value.length} tabs open?`)) return;
  }
  if (settings.value.clearDataOnExit) {
    await invoke("save_history", { data: "[]" }).catch(e => console.warn("[digidaw]", e));
  }
  invoke("close_window");
}

// --- vault UI handlers ---

async function vaultSaveConfirm() {
  const p = vaultSavePrompt.value;
  if (!p) return;
  const unlocked = await invoke<boolean>("vault_is_unlocked").catch(() => false);
  if (!unlocked) {
    const hasMaster = await invoke<boolean>("vault_has_master_password").catch(() => false);
    if (vaultSaveTimer) { clearTimeout(vaultSaveTimer); vaultSaveTimer = null; }
    vaultMasterModal.value = hasMaster ? "unlock" : "setup";
    return;
  }
  await invoke("vault_save_entry", { domain: p.domain, username: p.username, password: p.password }).catch(() => showError("Failed to save password"));
  vaultSavePrompt.value = null;
}

function vaultSaveDismiss() {
  vaultSavePrompt.value = null;
}

function vaultOverlayClose() {
  vaultMasterModal.value = null;
  if (vaultSavePrompt.value && !vaultSaveTimer) {
    vaultSaveTimer = setTimeout(() => { vaultSavePrompt.value = null; }, 30000);
  }
}

async function onVaultSubmit(e: Event) {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const pw = (form.elements.namedItem("vaultpw") as HTMLInputElement).value;
  if (vaultMasterModal.value === "setup") {
    const confirmPw = (form.elements.namedItem("vaultpw2") as HTMLInputElement).value;
    if (pw !== confirmPw) { showError("Passwords don't match"); return; }
    await invoke("vault_setup", { masterPassword: pw }).catch((err: any) => { showError(String(err)); return; });
  } else {
    await invoke("vault_unlock", { masterPassword: pw }).catch((err: any) => { showError(String(err)); return; });
  }
  vaultUnlocked.value = true;
  vaultMasterModal.value = null;
  // retry autofill on all tabs now that vault is unlocked
  invoke("vault_retry_autofill").catch(e => console.warn("[digidaw]", e));
  // retry save if pending
  if (vaultSavePrompt.value) {
    await invoke("vault_save_entry", { domain: vaultSavePrompt.value.domain, username: vaultSavePrompt.value.username, password: vaultSavePrompt.value.password }).catch(() => showError("Failed to save password"));
    vaultSavePrompt.value = null;
  }
}

// --- permission prompt ---
function respondPerm(allow: boolean) {
  if (!permReq.value) return;
  invoke("respond_permission", { requestId: permReq.value.requestId, allow, remember: permRemember.value });
  permReq.value = null;
}

// --- page context menu ---

function ctxClose() { pageCtx.value = null; }

function ctxOpenLink() {
  if (pageCtx.value && isSafeUrl(pageCtx.value.linkUri)) addTab(pageCtx.value.linkUri);
  pageCtx.value = null;
}
function ctxCopyLink() {
  if (pageCtx.value) invoke("copy_text_to_clipboard", { text: pageCtx.value.linkUri });
  pageCtx.value = null;
}
function ctxOpenImage() {
  if (pageCtx.value && isSafeUrl(pageCtx.value.sourceUri)) addTab(pageCtx.value.sourceUri);
  pageCtx.value = null;
}
function ctxSaveImage() {
  if (!pageCtx.value) return;
  const imgUrl = pageCtx.value.sourceUri;
  const filename = imgUrl.split("/").pop()?.split("?")[0] || "image.png";
  const sr = settings.value;
  invoke("start_download", { url: imgUrl, filename, downloadDir: sr.downloadLocation || "", cookies: null, mimeRouting: sr.mimeRouting || null });
  pageCtx.value = null;
}
function ctxCopyImageUrl() {
  if (pageCtx.value) invoke("copy_text_to_clipboard", { text: pageCtx.value.sourceUri });
  pageCtx.value = null;
}
function ctxOpenMedia() {
  if (pageCtx.value && isSafeUrl(pageCtx.value.sourceUri)) addTab(pageCtx.value.sourceUri);
  pageCtx.value = null;
}
function ctxCopyMediaUrl() {
  if (pageCtx.value) invoke("copy_text_to_clipboard", { text: pageCtx.value.sourceUri });
  pageCtx.value = null;
}
function ctxCopySelection() {
  if (pageCtx.value) invoke("copy_text_to_clipboard", { text: pageCtx.value.selectionText });
  pageCtx.value = null;
}
function ctxSearchSelection() {
  if (!pageCtx.value) return;
  const q = pageCtx.value.selectionText.slice(0, 200);
  addTab(getSearchUrl(q));
  pageCtx.value = null;
}
function ctxBack() {
  if (pageCtx.value) invoke("go_back", { id: pageCtx.value.tabId });
  pageCtx.value = null;
}
function ctxForward() {
  if (pageCtx.value) invoke("go_forward", { id: pageCtx.value.tabId });
  pageCtx.value = null;
}
function ctxReload() {
  if (pageCtx.value) invoke("reload_tab", { id: pageCtx.value.tabId });
  pageCtx.value = null;
}
function ctxCopyPageUrl() {
  const tab = tabs.value.find(t => t.id === pageCtx.value?.tabId);
  if (tab?.url) navigator.clipboard.writeText(tab.url);
  pageCtx.value = null;
}
function ctxPrintPage() {
  if (pageCtx.value) invoke("print_tab", { id: pageCtx.value.tabId });
  pageCtx.value = null;
}
function ctxViewSource() {
  const tab = tabs.value.find(t => t.id === pageCtx.value?.tabId);
  if (tab?.url) addTab("view-source:" + tab.url);
  pageCtx.value = null;
}
function ctxInspect() {
  if (pageCtx.value) invoke("toggle_devtools", { id: pageCtx.value.tabId });
  pageCtx.value = null;
}

// roving-focus keyboard nav on the page ctx overlay (port of the React onKeyDown)
function onPageCtxKeydown(e: KeyboardEvent) {
  if (!pageCtx.value) return;
  if (e.key === "Escape") { pageCtx.value = null; return; }
  const menu = pageCtxRef.value;
  if (!menu) return;
  const items = Array.from(menu.querySelectorAll<HTMLElement>(".ctx-item"));
  const focused = document.activeElement as HTMLElement;
  const idx = items.indexOf(focused);
  if (e.key === "ArrowDown") { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus(); }
  else if (e.key === "Enter" && idx >= 0) { e.preventDefault(); items[idx].click(); }
}

// --- update toast ---
async function installUpdate() {
  const pu = pendingUpdate.value;
  if (!pu || pu.downloading) return;
  pendingUpdate.value = { ...pu, downloading: true };
  try {
    const update = await checkUpdate();
    if (update) {
      await update.downloadAndInstall();
      await invoke("close_window");
    }
  } catch (e) {
    console.warn("[digidaw] update install failed:", e);
    pendingUpdate.value = null;
  }
}

function openSyncTab() {
  if (!syncTabReceived.value) return;
  navigate(syncTabReceived.value.url);
  syncTabReceived.value = null;
}

// command palette wiring
function onCmdSelectTab(id: string) { selectTab(id); cmdOpen.value = false; }
function onCmdNavigate(url: string) { navigate(url); cmdOpen.value = false; }
function onCmdAction(action: string) { executeAction(action); cmdOpen.value = false; }
function closeCmdPalette() { cmdOpen.value = false; }

// history panel wiring
function onHistorySelect(url: string) { selectBookmark(url); historyOpen.value = false; }

// --- keyboard shortcuts (works when the Vue UI has focus) ---
function onKeydown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === "t") { e.preventDefault(); addTab(); }
  if (ctrl && e.key === "w") { e.preventDefault(); closeTab(activeTab.value); }
  if (ctrl && e.key === "l") { e.preventDefault(); urlBarRef.value?.focus(); urlBarRef.value?.select(); }
  if (ctrl && e.shiftKey && e.key === "B") { e.preventDefault(); toggleCompactMode(); }
  if (ctrl && e.key === "b" && !e.shiftKey) { e.preventDefault(); toggleSidebar(); }
  if (ctrl && e.key === "f") { e.preventDefault(); findOpen.value = true; }
  if (ctrl && e.key === "k") { e.preventDefault(); cmdOpen.value = !cmdOpen.value; }
  if (ctrl && e.shiftKey && e.key === "R") { e.preventDefault(); toggleReader(); }
  if (ctrl && e.shiftKey && e.key === "T") { e.preventDefault(); const c = closedTabs.pop(); if (c) addTab(c.url); }
  if (ctrl && e.shiftKey && e.key === "I") { e.preventDefault(); invoke("toggle_devtools", { id: activeTab.value }); }
  if (ctrl && e.key === "d" && !e.shiftKey) { e.preventDefault(); toggleBookmark(); }
  if (ctrl && e.key === "h" && !e.shiftKey) { e.preventDefault(); historyOpen.value = !historyOpen.value; }
  if (ctrl && e.shiftKey && e.key === "P") { e.preventDefault(); perfOpen.value = !perfOpen.value; }
  if (ctrl && e.key === "p" && !e.shiftKey) { e.preventDefault(); invoke("print_tab", { id: activeTab.value }); }
  if (ctrl && e.key === "j" && !e.shiftKey) { e.preventDefault(); downloadsOpen.value = !downloadsOpen.value; }
  if (ctrl && e.key === "r" && !e.shiftKey) { e.preventDefault(); invoke("reload_tab", { id: activeTab.value }); }
  if (ctrl && e.key === "=") { e.preventDefault(); const z = Math.min((zoom[activeTab.value] || 1) + 0.1, 3); setZoom(activeTab.value, z); }
  if (ctrl && e.key === "-") { e.preventDefault(); const z = Math.max((zoom[activeTab.value] || 1) - 0.1, 0.3); setZoom(activeTab.value, z); }
  if (ctrl && e.key === "0") { e.preventDefault(); setZoom(activeTab.value, 1); }
  if (e.key === "F11") { e.preventDefault(); invoke("toggle_fullscreen"); }
  if (e.key === "F5") { e.preventDefault(); invoke("reload_tab", { id: activeTab.value }); }
  // Ctrl+Tab cycles tabs within current workspace
  if (ctrl && e.key === "Tab") {
    e.preventDefault();
    const wsTabs = currentWsTabs.value;
    if (wsTabs.length === 0) return;
    const idx = wsTabs.findIndex(t => t.id === activeTab.value);
    const next = e.shiftKey
      ? (idx - 1 + wsTabs.length) % wsTabs.length
      : (idx + 1) % wsTabs.length;
    selectTab(wsTabs[next].id);
  }
  // Ctrl+1-9 switches workspaces
  if (ctrl && e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    const idx = parseInt(e.key) - 1;
    if (idx < workspaces.value.length) switchWorkspace(workspaces.value[idx].id);
  }
}

// global shortcut bridge: Rust eval() calls this directly on the main webview;
// also handles child webview shortcuts forwarded via global-shortcut events.
// Closure-free: reads store refs at call time (React re-assigned it per render).
function globalShortcut(action: string) {
  switch (action) {
    case "toggle-compact": toggleCompactMode(); break;
    case "toggle-sidebar": toggleSidebar(); break;
    case "bookmark": toggleBookmark(); break;
    case "history": historyOpen.value = !historyOpen.value; break;
    case "new-tab": addTab(); break;
    case "close-tab": closeTab(activeTab.value); break;
    case "focus-url": urlBarRef.value?.focus(); urlBarRef.value?.select(); break;
    case "find": findOpen.value = true; break;
    case "command-palette": cmdOpen.value = !cmdOpen.value; break;
    case "screenshot": openScreenshot(); break;
    case "reader-mode": toggleReader(); break;
    case "split-view": toggleSplit(); break;
    case "print": invoke("print_tab", { id: activeTab.value }); break;
    case "reload": invoke("reload_tab", { id: activeTab.value }); break;
    case "fullscreen": invoke("toggle_fullscreen"); break;
    case "downloads": downloadsOpen.value = !downloadsOpen.value; break;
    case "devtools": invoke("toggle_devtools", { id: activeTab.value }); break;
    case "reopen-tab": { const c = closedTabs.pop(); if (c) addTab(c.url); break; }
    case "zoom-in": { const z = Math.min((zoom[activeTab.value] || 1) + 0.1, 3); setZoom(activeTab.value, z); break; }
    case "zoom-out": { const z = Math.max((zoom[activeTab.value] || 1) - 0.1, 0.3); setZoom(activeTab.value, z); break; }
    case "zoom-reset": { setZoom(activeTab.value, 1); break; }
  }
}

// autofocus directive for the vault master password input (React autoFocus)
const vFocus = { mounted: (el: HTMLElement) => el.focus() };

// --- watchers (React useEffect translation) ---

// W1: save session when tabs/workspaces change (debounced)
watch([tabs, workspaces, activeWorkspaceId, compactMode, panels], (_v, _o, onCleanup) => {
  if (!initialized || tabs.value.length === 0) return;
  const t = setTimeout(() => {
    const session: SessionData = {
      workspaces: workspaces.value.map(w => ({ id: w.id, name: w.name, color: w.color, icon: w.icon, activeTabId: w.activeTabId, paneLayout: w.paneLayout })),
      tabs: tabs.value.map(tab => ({ id: tab.id, url: tab.url, title: tab.title, pinned: tab.pinned, workspaceId: tab.workspaceId, parentId: tab.parentId, suspended: tab.suspended })),
      activeWorkspaceId: activeWorkspaceId.value,
      compactMode: compactMode.value,
      panels: panels.value.map(p => ({ id: p.id, url: p.url, title: p.title, favicon: p.favicon })),
    };
    invoke("save_session", { tabs: JSON.stringify(session) }).catch(() => showError("Failed to save session"));
  }, 1000);
  onCleanup(() => clearTimeout(t));
});

// W2: save history debounced
watch(historyEntries, (_v, _o, onCleanup) => {
  if (!historyLoaded) return;
  const t = setTimeout(() => invoke("save_history", { data: JSON.stringify(historyEntries.value) }), 2000);
  onCleanup(() => clearTimeout(t));
});

// W3: save bookmarks debounced (skip when sync enabled — surgical commands handle Loro persistence)
watch([bookmarkData, () => settings.value.syncEnabled], (_v, _o, onCleanup) => {
  if (!bookmarksLoaded) return;
  if (settings.value.syncEnabled && !bookmarkBulk) return;
  bookmarkBulk = false;
  const t = setTimeout(() => invoke("save_bookmarks", { data: JSON.stringify(bookmarkData.value) }), 1000);
  onCleanup(() => clearTimeout(t));
});

// W4: save settings debounced
watch(settings, (_v, _o, onCleanup) => {
  if (!settingsLoaded) return;
  const t = setTimeout(() => {
    invoke("save_settings", { data: JSON.stringify(settings.value) });
    // update dns resolver level if changed
    if (prevSettings && settings.value.dnsLevel !== prevSettings.dnsLevel) {
      invoke("set_dns_level", { level: settings.value.dnsLevel }).catch(e => console.warn("[digidaw]", e));
    }
  }, 500);
  onCleanup(() => clearTimeout(t));
});

// W5: sync settings to CRDT — diff only changed keys
watch(settings, () => {
  if (!settingsLoaded || !settings.value.syncEnabled) return;
  const prev = prevSettings;
  if (prev) {
    const keys = Object.keys(settings.value) as (keyof DigidawSettings)[];
    keys.forEach(key => {
      if (settings.value[key] !== prev[key]) {
        invoke("sync_write_setting", { key, value: JSON.stringify(settings.value[key]) }).catch(e => console.warn("[digidaw]", e));
      }
    });
  }
  prevSettings = { ...settings.value };
});

// W6: fetch paired devices for sidebar send-tab feature
watch(() => settings.value.syncEnabled, (_v, _o, onCleanup) => {
  if (!settings.value.syncEnabled) { syncPairedDevices.value = []; return; }
  const fetchDevices = () => {
    invoke<{ enabled: boolean; paired_devices: { device_id: string; name: string }[] }>("get_sync_status")
      .then(info => { syncPairedDevices.value = info.paired_devices || []; })
      .catch(e => console.warn("[digidaw]", e));
  };
  fetchDevices();
  const p = listen("pair-complete", fetchDevices);
  onCleanup(() => { p.then(u => u()); });
}, { immediate: true });

// W7: sync open tabs every 30s
watch([() => settings.value.syncEnabled, tabs], (_v, _o, onCleanup) => {
  if (!settings.value.syncEnabled) return;
  const sync = () => {
    const tabsForSync = tabs.value.filter(t => t.memoryState !== "destroyed")
      .map(t => ({ id: t.id, url: t.url, title: t.title, favicon: t.favicon }));
    invoke("sync_write_tabs", { tabs: JSON.stringify(tabsForSync) }).catch(e => console.warn("[digidaw]", e));
  };
  sync();
  const iv = setInterval(sync, 30000);
  onCleanup(() => clearInterval(iv));
});

// W8: focus first ctx menu item when the page context menu opens
watch(pageCtx, () => {
  if (!pageCtx.value) return;
  requestAnimationFrame(() => {
    pageCtxRef.value?.querySelector<HTMLElement>(".ctx-item")?.focus();
  });
});

// W9: resize webviews when sidebar/topOffset/layout changes — delay so the CSS
// transition (300ms) completes before native resize (blocks compositor)
watch([sidebarW, paneLayout, () => activePanelId.value, () => compactMode.value], (_v, _o, onCleanup) => {
  if (!activeTab.value) return;
  const t = setTimeout(() => { syncLayout(); positionActivePanel(); }, 320);
  onCleanup(() => clearTimeout(t));
});

// W10: reposition active panel when it (or the sidebar) changes
watch([() => activePanelId.value, sidebarW, () => compactMode.value], () => {
  positionActivePanel();
}, { immediate: true });

// W11: hide webviews when vault unlock modal is showing (native windows cover
// the Vue overlays); push webviews down when save banner is showing
watch([vaultMasterModal, vaultSavePrompt], () => {
  if (vaultMasterModal.value) {
    invoke("layout_webviews", { panes: [], focusedTabId: activeTab.value || "__none__", sidebarW: 0, topOffset: 0 });
  } else if (vaultSavePrompt.value) {
    // push webview down 30px to reveal save banner below titlebar
    const ws = workspaces.value.find(w => w.id === activeWorkspaceId.value);
    if (!ws?.activeTabId) return;
    const t = tabs.value.find(tab => tab.id === ws.activeTabId);
    if (!t || t.url.startsWith("digidaw://")) return;
    const bannerH = 36;
    const cw = window.innerWidth - layoutOffset.value;
    const ch = window.innerHeight - topOffset - bannerH;
    const panes = [{ tabId: ws.activeTabId, x: 0, y: bannerH, w: cw, h: ch }];
    invoke("layout_webviews", { panes, focusedTabId: ws.activeTabId, sidebarW: layoutOffset.value, topOffset });
  } else {
    syncLayout();
  }
}, { immediate: true });

// W12: vault auto-lock after inactivity
watch([() => settings.value.vaultAutoLock, () => settings.value.vaultLockTimeout, vaultUnlocked], (_v, _o, onCleanup) => {
  if (!settings.value.vaultAutoLock || !settings.value.vaultLockTimeout || !vaultUnlocked.value) return;
  const timeoutMs = settings.value.vaultLockTimeout * 60_000;
  const lock = () => invoke("vault_lock").then(() => { vaultUnlocked.value = false; }).catch(e => console.warn("[digidaw]", e));
  let timer = setTimeout(lock, timeoutMs);
  // reset timer on user activity signals
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(lock, timeoutMs);
  };
  window.addEventListener("mousedown", reset);
  window.addEventListener("keydown", reset);
  onCleanup(() => {
    clearTimeout(timer);
    window.removeEventListener("mousedown", reset);
    window.removeEventListener("keydown", reset);
  });
});

// W13: hide panel webview when entering compact mode
watch(compactMode, () => {
  if (compactMode.value && activePanelId.value) {
    invoke("position_panel", { id: activePanelId.value, x: -9999, y: 0, w: PANEL_W, h: 0 });
  }
});

// W14: sync compactMode setting ↔ state
watch(() => settings.value.compactMode, () => {
  if (!settingsLoaded) return;
  if (settings.value.compactMode !== compactMode.value) {
    compactMode.value = settings.value.compactMode;
  }
}, { immediate: true });

// W15: smart tab lifecycle — 3-tier: active → suspended (TrySuspend) → destroyed.
// One interval reading store refs fresh at tick time (React re-created the
// interval on dep change just to refresh closures).
onMounted(() => {
  setInterval(() => {
    if (settings.value.suspendTimeout === 0) return; // disabled
    const destroyMs = settings.value.suspendTimeout * 60 * 1000;
    const suspendMs = Math.min(destroyMs * 0.4, 120_000); // 40% of destroy time, max 2min

    const now = Date.now();
    let changed = false;
    const next = tabs.value.map(t => {
      if (t.id === activeTab.value || paneTabIdSet.value.has(t.id)) return t;
      if (t.pinned || t.url.startsWith("digidaw://")) return t;
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
    if (changed) tabs.value = next;
  }, 15_000);
});

// W16: RSS Live Folders — fetch on startup + every 30 min (keyed by folder set)
async function fetchRssForFolder(folder: { id: string; rssUrl?: string; lastFetched?: number }) {
  if (!folder.rssUrl) return;
  if (folder.lastFetched && Date.now() - folder.lastFetched < 30 * 60 * 1000) return;
  try {
    const res = await fetch(folder.rssUrl);
    if (!res.ok) return;
    const text = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/xml");
    // support both RSS <item> and Atom <entry>
    const items = doc.querySelectorAll("item, entry");
    const autoItems: Bookmark[] = [];
    for (let i = 0; i < Math.min(items.length, 20); i++) {
      const item = items[i];
      const title = item.querySelector("title")?.textContent || "Untitled";
      // RSS uses <link> text, Atom uses <link href="">
      const linkEl = item.querySelector("link");
      const url = linkEl?.getAttribute("href") || linkEl?.textContent || "";
      if (!url) continue;
      autoItems.push({
        id: `rss-${folder.id}-${i}`,
        url: url.trim(),
        title: title.trim(),
        folderId: folder.id,
        createdAt: Date.now(),
        order: i,
      });
    }
    const prev = bookmarkData.value;
    bookmarkData.value = { ...prev, folders: prev.folders.map(f => (f.id === folder.id ? { ...f, autoItems, lastFetched: Date.now() } : f)) };
  } catch {
    // silently fail for RSS fetch errors
  }
}

function fetchAllRss() {
  const folders = bookmarkData.value.folders.filter(f => f.rssUrl);
  folders.forEach(f => fetchRssForFolder(f));
}

watch(rssKey, (_v, _o, onCleanup) => {
  fetchAllRss();
  const interval = setInterval(fetchAllRss, 30 * 60 * 1000);
  onCleanup(() => clearInterval(interval));
}, { immediate: true });

// W17: search suggestions from engine API (debounced)
watch([urlQuery, () => settings.value.searchSuggestions, () => settings.value.searchEngine], (_v, _o, onCleanup) => {
  if (!urlQuery.value || urlQuery.value.length < 2 || !settings.value.searchSuggestions) {
    searchSugs.value = [];
    return;
  }
  if (/^https?:\/\//.test(urlQuery.value) || urlQuery.value.startsWith(">")) return;
  const timer = setTimeout(() => {
    invoke<string[]>("fetch_search_suggestions", { query: urlQuery.value, engine: settings.value.searchEngine })
      .then(res => { searchSugs.value = res; })
      .catch(() => { searchSugs.value = []; });
  }, 300);
  onCleanup(() => clearTimeout(timer));
});

// W18: detect videos on current page (poll every 3s for up to 30s — lazy sites)
watch([activeTab, () => current.value?.url], (_v, _o, onCleanup) => {
  if (!activeTab.value) return;
  const tab = tabs.value.find(t => t.id === activeTab.value);
  if (!tab || tab.url.startsWith("digidaw://") || tab.suspended || tab.memoryState === "suspended" || tab.memoryState === "destroyed") {
    hasVideo.value = false;
    pipActive.value = false;
    return;
  }
  const detectVideo = () => {
    invoke("detect_video", { id: activeTab.value });
  };
  const interval = setInterval(detectVideo, 3000);
  const stop = setTimeout(() => clearInterval(interval), 30000);
  onCleanup(() => { clearInterval(interval); clearTimeout(stop); });
});

// W19: network log enable / hydrate
watch([networkOpen, activeTab], () => {
  invoke("set_network_log_enabled", { enabled: networkOpen.value });
  if (networkOpen.value && activeTab.value) {
    invoke<NetworkEntry[]>("get_network_log", { tabId: activeTab.value }).then(entries => {
      networkEntries.value = entries;
    });
  }
  if (!networkOpen.value) {
    networkEntries.value = [];
  }
});

// --- mount effects ---

// restore session or create first tab
onMounted(() => {
  if (initialized) return;
  initialized = true;

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
    settings.value = s;
    settingsLoaded = true;

    // apply saved theme
    applyTheme(s.accentColor || "#6366f1", s.themeMode || "dark");

    // restore reader settings from persisted settings
    if (s.readerFontSize || s.readerFont || s.readerTheme || s.readerLineWidth) {
      readerSettings.value = {
        fontSize: s.readerFontSize || 18,
        font: s.readerFont || "serif",
        theme: s.readerTheme || "dark",
        lineWidth: s.readerLineWidth || 680,
      };
    }

    // apply bandwidth limit from settings
    if (s.bandwidthLimit) {
      invoke("set_bandwidth_limit", { limit: s.bandwidthLimit });
    }

    // if onboarding hasn't been completed, show it and skip session restore
    if (!s.onboardingComplete) {
      showOnboarding.value = true;
      // still set up a default workspace so the app has something after onboarding
      const wsId = genWsId();
      const id = genId();
      const ws: Workspace = { id: wsId, name: "Home", color: DEFAULT_WS_COLOR, activeTabId: id };
      const tab: Tab = { id, url: NTP_URL, title: "New Tab", loading: false, workspaceId: wsId, lastActiveAt: Date.now() };
      workspaces.value = [ws];
      tabs.value = [tab];
      activeWorkspaceId.value = wsId;
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
      workspaces.value = [ws];
      tabs.value = [tab];
      activeWorkspaceId.value = wsId;
      compactMode.value = s.compactMode;
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
        return { id: w.id, name: w.name, color: w.color, icon: w.icon, activeTabId: w.activeTabId, paneLayout: w.paneLayout };
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
        const isInternal = st.url.startsWith("digidaw://");
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
      workspaces.value = restoredWs;
      tabs.value = restoredTabs;
      activeWorkspaceId.value = session.activeWorkspaceId;
      compactMode.value = restoredCompact;

      // progressive restore: only create the active tab's webview immediately,
      // defer all others as "destroyed" — they'll be created on first click
      const restoredSidebarW = restoredCompact ? 3 : 300;
      const restoredTopOffset = 40;
      const firstActiveWs = restoredWs.find(w => w.id === session.activeWorkspaceId);
      const activePaneIds = new Set<string>();
      if (firstActiveWs?.activeTabId) activePaneIds.add(firstActiveWs.activeTabId);
      if (firstActiveWs?.paneLayout) {
        for (const lid of allLeafIds(firstActiveWs.paneLayout)) activePaneIds.add(lid);
      }
      restoredTabs.forEach(t => {
        if (t.url.startsWith("digidaw://") || t.suspended) return;
        if (activePaneIds.has(t.id)) {
          invoke("create_tab", { id: t.id, url: t.url, sidebarW: restoredSidebarW, topOffset: restoredTopOffset, profileName: t.workspaceId, ...tabArgs });
          clearLoading(t.id);
        } else {
          t.memoryState = "destroyed";
          t.suspended = true;
          t.loading = false;
        }
      });
      if (firstActiveWs?.activeTabId) {
        const activeRestoredTab = restoredTabs.find(t => t.id === firstActiveWs.activeTabId);
        if (activeRestoredTab?.url?.startsWith("digidaw://")) {
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
        panels.value = session.panels;
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
        workspaces.value = [ws];
        tabs.value = restored;
        activeWorkspaceId.value = wsId;

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
});

// update notification: show toast when version changes
onMounted(() => {
  getVersion().then(version => {
    const lastVersion = localStorage.getItem("digidaw-last-version");
    if (lastVersion && lastVersion !== version) {
      updateToast.value = version;
      setTimeout(() => { updateToast.value = null; }, 8000);
    }
    localStorage.setItem("digidaw-last-version", version);
  }).catch(e => console.warn("[digidaw]", e));
});

// auto-update check on startup (delay 5s to not block startup)
let updateCheckTimer: ReturnType<typeof setTimeout> | null = null;
onMounted(() => {
  updateCheckTimer = setTimeout(async () => {
    try {
      const update = await checkUpdate();
      if (update) {
        pendingUpdate.value = { version: update.version, downloading: false };
      }
    } catch (e) {
      console.warn("[digidaw] update check failed:", e);
    }
  }, 5000);
});

// load history + bookmarks on init
onMounted(() => {
  invoke<string>("load_history").then(json => {
    try { const p = JSON.parse(json); if (Array.isArray(p)) historyEntries.value = p; } catch {}
    historyLoaded = true;
  });
});

onMounted(() => {
  invoke<string>("load_bookmarks").then(json => {
    try {
      const p = JSON.parse(json);
      if (p?.bookmarks) {
        // backfill order field for existing bookmarks that don't have it
        p.bookmarks = p.bookmarks.map((b: any, i: number) => ({ ...b, order: b.order ?? i }));
        if (p.folders) p.folders = p.folders.map((f: any, i: number) => ({ ...f, order: f.order ?? i }));
        bookmarkData.value = p;
      }
    } catch {}
    bookmarksLoaded = true;
  });
});

// listen for webview events from rust
const unlistenPromises: Promise<() => void>[] = [];
onMounted(() => {
  unlistenPromises.push(
    listen<{ id: string; url: string }>("tab-url-changed", (e) => {
      let favicon: string | undefined;
      let domain = "";
      try {
        const host = new URL(e.payload.url).hostname;
        if (host) favicon = `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
        domain = host;
      } catch {}
      tabs.value = tabs.value.map(t => (t.id === e.payload.id ? { ...t, url: e.payload.url, favicon } : t));
      panels.value = panels.value.map(p => (p.id === e.payload.id ? { ...p, url: e.payload.url, favicon } : p));
      // update glance URL if this is the glance webview
      if (glance.value && glance.value.id === e.payload.id) {
        glance.value = { ...glance.value, url: e.payload.url };
      }
      recordHistory(e.payload.url, "", favicon);
      if (domain) {
        invoke<boolean>("is_whitelisted", { domain }).then(wl => {
          tabs.value = tabs.value.map(t => (t.id === e.payload.id ? { ...t, whitelisted: wl } : t));
        });
        const savedZoom = settings.value.zoomHistory?.[domain];
        if (savedZoom && savedZoom !== 1) {
          zoom[e.payload.id] = savedZoom;
          zoomDisplay.value = { ...zoomDisplay.value, [e.payload.id]: savedZoom };
          invoke("zoom_tab", { id: e.payload.id, factor: savedZoom });
        }
      }
    }),
    listen<{ id: string; title: string }>("tab-title-changed", (e) => {
      const clean = e.payload.title.replace(/<[^>]*>/g, "");
      const tab = tabs.value.find(t => t.id === e.payload.id);
      if (tab) {
        historyEntries.value = historyEntries.value.map(h => (h.url === tab.url ? { ...h, title: clean } : h));
      }
      tabs.value = tabs.value.map(t => (t.id === e.payload.id ? { ...t, title: clean, loading: false } : t));
      panels.value = panels.value.map(p => (p.id === e.payload.id ? { ...p, title: clean } : p));
      // update glance title if this is the glance webview
      if (glance.value && glance.value.id === e.payload.id) {
        glance.value = { ...glance.value, title: clean };
      }
    }),
    listen<{ id: string; loading: boolean }>("tab-loading", (e) => {
      tabs.value = tabs.value.map(t => (t.id === e.payload.id ? { ...t, loading: e.payload.loading } : t));
    }),
    listen<{ id: string; count: number }>("tab-blocked-count", (e) => {
      tabs.value = tabs.value.map(t => (t.id === e.payload.id ? { ...t, blockedCount: e.payload.count } : t));
    }),
    listen<{ id: string; hasVideo: boolean }>("tab-has-video", (e) => {
      hasVideo.value = e.payload.hasVideo;
    }),
    listen<{ id: string; state: string; title: string; artist?: string; currentTime?: number; duration?: number; playbackRate?: number; metaTitle?: string }>("tab-media-state", (e) => {
      tabs.value = tabs.value.map(t =>
        t.id === e.payload.id
          ? {
              ...t,
              mediaState: e.payload.state === "ended" ? undefined : e.payload.state as "playing" | "paused",
              mediaTitle: (e.payload.metaTitle || e.payload.title || "").replace(/<[^>]*>/g, ""),
              mediaArtist: e.payload.artist || undefined,
              mediaCurrentTime: e.payload.currentTime ?? t.mediaCurrentTime,
              mediaDuration: e.payload.duration ?? t.mediaDuration,
              mediaPlaybackRate: e.payload.playbackRate ?? t.mediaPlaybackRate,
            }
          : t
      );
    }),
    listen<{ id: string }>("tab-crashed", (e) => {
      tabs.value = tabs.value.map(t =>
        t.id === e.payload.id ? { ...t, crashed: true, loading: false } : t
      );
    }),
    // download events
    listen<{ url: string; suggestedFilename: string; cookies?: string }>("download-intercepted", (e) => {
      const dir = settings.value.downloadLocation || "";
      const routing = settings.value.mimeRouting || [];
      invoke("start_download", { url: e.payload.url, filename: e.payload.suggestedFilename, downloadDir: dir, cookies: e.payload.cookies || null, mimeRouting: routing });
      downloadsOpen.value = true;
    }),
    listen<DownloadItem>("download-started", (e) => {
      if (!downloads.value.find(d => d.id === e.payload.id)) {
        downloads.value = [e.payload, ...downloads.value];
      }
      // download arc animation
      const dlBtn = document.querySelector(".download-btn");
      if (dlBtn) {
        const btnRect = dlBtn.getBoundingClientRect();
        const dot = document.createElement("div");
        dot.className = "download-arc-dot";
        dot.style.setProperty("--arc-end-x", `${btnRect.left + btnRect.width / 2}px`);
        dot.style.setProperty("--arc-end-y", `${btnRect.top + btnRect.height / 2}px`);
        document.body.appendChild(dot);
        dot.addEventListener("animationend", () => dot.remove());
      }
    }),
    listen<DownloadItem>("download-progress", (e) => {
      downloads.value = downloads.value.map(d => (d.id === e.payload.id ? e.payload : d));
    }),
    listen<DownloadItem>("download-complete", (e) => {
      downloads.value = downloads.value.map(d => (d.id === e.payload.id ? e.payload : d));
    }),
    listen<DownloadItem>("download-failed", (e) => {
      downloads.value = downloads.value.map(d => (d.id === e.payload.id ? e.payload : d));
    }),
    listen<{ id: string }>("download-cancelled", (e) => {
      downloads.value = downloads.value.filter(d => d.id !== e.payload.id);
    }),
    listen<{ id: string; reason: string }>("download-resume-failed", (e) => {
      showError(e.payload.reason);
    }),
    // speculative preload promotion
    listen<{ preloadId: string; url: string; sourceTabId: string }>("preload-promoted", (e) => {
      const { preloadId, url, sourceTabId } = e.payload;
      // find the source tab to inherit its workspace
      const sourceTab = tabs.value.find(t => t.id === sourceTabId);
      const wsId = sourceTab?.workspaceId || activeWorkspaceId.value;
      const newTab: Tab = {
        id: preloadId,
        url,
        title: url,
        loading: true,
        pinned: false,
        workspaceId: wsId,
        parentId: sourceTabId,
      };
      tabs.value = [...tabs.value, newTab];
      // set the preloaded tab as active
      workspaces.value = workspaces.value.map(ws => (ws.id === activeWorkspaceId.value ? { ...ws, activeTabId: preloadId } : ws));
    }),
    // network inspector
    listen<{ tabId: string; entries: NetworkEntry[] }>("network-request", (e) => {
      networkEntries.value = [...networkEntries.value, ...e.payload.entries].slice(-500);
    }),
    // sync: reload bookmarks when remote changes arrive
    listen("sync-bookmarks-changed", () => {
      console.log("[sync] sync-bookmarks-changed event received, reloading...");
      invoke<string>("load_bookmarks").then(json => {
        console.log("[sync] load_bookmarks returned:", json?.substring(0, 300));
        try { const p = JSON.parse(json); if (p?.bookmarks) { console.log("[sync] setting bookmarkData:", p.bookmarks.length, "bookmarks,", p.folders.length, "folders"); bookmarkData.value = p; } } catch (e) { console.error("[sync] parse error:", e); }
      }).catch(e => console.error("[sync] load_bookmarks failed:", e));
    }),
    // sync: activity indicator
    listen<string>("sync-activity", (e) => {
      const state = e.payload as "syncing" | "success" | "error";
      syncToast.value = state;
      if (syncToastTimer) clearTimeout(syncToastTimer);
      if (state !== "syncing") {
        syncToastTimer = setTimeout(() => { syncToast.value = null; }, 2500);
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
          const merged = { ...settings.value };
          // only apply universal (non-device-local) keys
          const deviceLocal = new Set(["compactMode", "suspendTimeout", "downloadLocation", "askDownloadLocation", "onStartup", "syncDeviceName", "syncEnabled", "onboardingComplete"]);
          for (const key of Object.keys(remote)) {
            if (!deviceLocal.has(key) && remote[key] !== undefined) {
              (merged as any)[key] = remote[key];
            }
          }
          settings.value = merged;
        } catch {}
      }).catch(e => console.warn("[digidaw]", e));
    }),
    // sync: tab received from another device
    listen<{ from_device: string; url: string; title: string }>("tab-received", (e) => {
      syncTabReceived.value = e.payload;
      setTimeout(() => { syncTabReceived.value = null; }, 8000);
    }),
    // page context menu (right-click on web content)
    listen<any>("webview-context-menu", (e) => {
      const p = e.payload;
      pageCtx.value = {
        x: p.x + layoutOffset.value,
        y: p.y + topOffset,
        kind: p.kind,
        linkUri: p.linkUri || "",
        sourceUri: p.sourceUri || "",
        selectionText: p.selectionText || "",
        pageUri: p.pageUri || "",
        isEditable: !!p.isEditable,
        tabId: p.id,
      };
    }),
    // permission prompt from webview
    listen<PermissionRequest>("permission-requested", (e) => {
      permReq.value = e.payload;
      permRemember.value = true;
    }),
    // glance: ephemeral link preview
    listen<{ url: string; sourceTabId: string }>("glance-request", (e) => {
      if (glance.value) return; // already showing a glance
      const glanceId = `glance-${Date.now()}`;
      const g: GlanceState = { id: glanceId, url: e.payload.url, title: e.payload.url, sourceTabId: e.payload.sourceTabId };
      glance.value = g;
      const src = tabs.value.find(t => t.id === e.payload.sourceTabId);
      invoke("open_glance", { url: e.payload.url, glanceId, sidebarW: layoutOffset.value, topOffset, profileName: src?.workspaceId });
      // hide tab webviews so overlay is visible
      invoke("layout_webviews", { panes: [], focusedTabId: "__none__", sidebarW: layoutOffset.value, topOffset });
    }),
    listen<{ domain: string; username: string; password: string }>("vault-save-prompt", (e) => {
      vaultSavePrompt.value = e.payload;
      if (vaultSaveTimer) clearTimeout(vaultSaveTimer);
      vaultSaveTimer = setTimeout(() => { vaultSavePrompt.value = null; }, 30000);
    }),
    // vault unlock needed — page has login form but vault is locked
    listen<{ domain: string; tabId: string }>("vault-unlock-needed", () => {
      if (!vaultUnlocked.value) {
        vaultMasterModal.value = "unlock";
      }
    }),
    // cookie banner auto-rejected
    listen<{ id: string }>("cookie-rejected", () => {
      cookieToast.value = true;
      setTimeout(() => { cookieToast.value = false; }, 2000);
    }),
    // popup / window.open from webview — open in same workspace
    listen<{ sourceTabId: string; url: string }>("new-window-requested", (e) => {
      const id = genId();
      const sourceTab = tabs.value.find(t => t.id === e.payload.sourceTabId);
      const wsId = sourceTab?.workspaceId || "ws-1";
      const tab: Tab = { id, url: e.payload.url, title: "Loading...", loading: true, workspaceId: wsId, lastActiveAt: Date.now() };
      const sr = settings.value;
      invoke("create_tab", { id, url: e.payload.url, sidebarW: layoutOffset.value, topOffset, httpsOnly: sr.httpsOnly, adBlocker: sr.adBlocker, cookieAutoReject: sr.cookieAutoReject, isPanel: false, profileName: wsId, ...secArgs(sr) });
      tabs.value = [...tabs.value, tab];
      workspaces.value = workspaces.value.map(w => (w.id === wsId ? { ...w, activeTabId: id } : w));
    }),
  );

  // load existing downloads on init
  invoke<DownloadItem[]>("get_downloads").then(items => {
    if (items.length > 0) downloads.value = items;
  }).catch(e => console.warn("[digidaw]", e));

  // check vault lock state
  invoke<boolean>("vault_is_unlocked").then(v => { vaultUnlocked.value = v; }).catch(e => console.warn("[digidaw]", e));
});

// EcoQoS + memory priority: low-power mode when window hidden/minimized
let visHandler: (() => void) | null = null;
onMounted(() => {
  visHandler = () => {
    invoke("set_power_mode", { low: document.hidden }).catch(e => console.warn("[digidaw]", e));
  };
  document.addEventListener("visibilitychange", visHandler);
});

// resize webviews when the window resizes
let resizeHandler: (() => void) | null = null;
onMounted(() => {
  resizeHandler = () => {
    if (!activeTab.value) return;
    syncLayout();
    positionActivePanel();
  };
  window.addEventListener("resize", resizeHandler);
});

// keyboard shortcuts (works when Vue UI has focus) — registered once; the
// handler reads store refs fresh at event time (no React dep-refresh needed)
onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

// global shortcut bridge + child-webview shortcut events
onMounted(() => {
  (window as any).__digidawGlobalShortcut = globalShortcut;
  unlistenPromises.push(
    listen<string>("global-shortcut", (e) => {
      const fn = (window as any).__digidawGlobalShortcut;
      if (fn) fn(e.payload);
    }),
  );
});

onUnmounted(() => {
  if (updateCheckTimer) clearTimeout(updateCheckTimer);
  if (vaultSaveTimer) clearTimeout(vaultSaveTimer);
  if (syncToastTimer) clearTimeout(syncToastTimer);
  unlistenPromises.forEach(p => p.then(u => u()));
  document.removeEventListener("visibilitychange", visHandler!);
  window.removeEventListener("resize", resizeHandler!);
  window.removeEventListener("keydown", onKeydown);
  delete (window as any).__digidawGlobalShortcut;
});

// __PHASE_END__
</script>

<template>
  <Onboarding
    v-if="showOnboarding"
    :initial-accent="settings.accentColor"
    :initial-mode="settings.themeMode"
    @complete="handleOnboardingComplete"
    @import-bookmarks="handleImportBookmarks"
    @import-history="handleImportHistory"
    @theme-change="handleThemeChange"
  />
  <div class="browser" :style="showOnboarding ? { display: 'none' } : undefined">
    <ScreenshotOverlay
      v-if="screenshotPreview !== null && activeTab"
      :tab-id="activeTab"
      :tab-url="current?.url || ''"
      :preview="screenshotPreview"
      @close="closeScreenshot"
      @annotate="annotateScreenshot"
      @restore-webview="syncLayout"
    />
    <PerfOverlay :visible="perfOpen" />
    <GlanceOverlay
      v-if="glance"
      :url="glance.url"
      :title="glance.title"
      :glance-id="glance.id"
      :sidebar-width="layoutOffset"
      :top-offset="topOffset"
      @close="closeGlance"
      @expand="expandGlance"
      @split="splitGlance"
    />
    <AnnotationEditor
      v-if="annotationData"
      :image-data="annotationData"
      @close="closeAnnotation"
    />
    <ShareMenu
      v-if="shareOpen && current?.url"
      :url="current.url"
      @close="shareOpen = false"
    />
    <CommandPalette
      v-if="cmdOpen"
      :tabs="tabs"
      :bookmarks="bookmarkData.bookmarks"
      :history="historyEntries"
      :sidebar-w="sidebarW"
      @select-tab="onCmdSelectTab"
      @navigate="onCmdNavigate"
      @action="onCmdAction"
      @close="closeCmdPalette"
    />
    <div class="titlebar" data-tauri-drag-region>
      <div class="titlebar-title">{{ current?.title || "Digidaw" }}</div>
      <div class="titlebar-controls">
        <button class="win-btn" @click="minimizeWindow" title="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button class="win-btn" @click="maximizeWindow" title="Maximize">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1"/></svg>
        </button>
        <button class="win-btn win-close" @click="closeWindow" title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
      </div>
    </div>

    <div class="browser-body">
      <Sidebar
        :tabs="regularTabs"
        :pinned-tabs="pinnedTabs"
        :active-tab="activeTab"
        :open="sidebarOpen"
        :compact="compactMode"
        :on-select="selectTab"
        :on-close="closeTab"
        :on-pin="pinTab"
        :on-new="addTab"
        :on-reorder="reorderTabs"
        :on-toggle="toggleSidebar"
        :workspaces="workspaces"
        :active-workspace-id="activeWorkspaceId"
        :on-switch-workspace="switchWorkspace"
        :on-add-workspace="addWorkspace"
        :on-delete-workspace="deleteWorkspace"
        :on-clear-workspace-data="clearWorkspaceData"
        :on-rename-workspace="renameWorkspace"
        :on-recolor-workspace="recolorWorkspace"
        :on-set-workspace-icon="setWorkspaceIcon"
        :on-toggle-collapse="toggleCollapse"
        :on-add-child-tab="addChildTab"
        :on-move-tab-to-workspace="moveTabToWorkspace"
        :on-duplicate-workspace="duplicateWorkspace"
        :on-reorder-workspaces="reorderWorkspaces"
        :on-mute-tab="muteTab"
        :on-rename-tab="renameTab"
        :bookmarks="bookmarkData.bookmarks"
        :bookmark-folders="bookmarkData.folders"
        :on-select-bookmark="selectBookmark"
        :on-remove-bookmark="removeBookmark"
        :on-add-bookmark-folder="addBookmarkFolder"
        :on-rename-bookmark-folder="renameBookmarkFolder"
        :on-delete-bookmark-folder="deleteBookmarkFolder"
        :on-move-bookmark-to-folder="moveBookmarkToFolder"
        :on-reorder-bookmarks="reorderBookmarks"
        :on-reorder-folders="reorderFolders"
        :on-set-folder-rss="setFolderRss"
        :on-remove-folder-rss="removeFolderRss"
        :on-toggle-history="toggleHistory"
        :on-back="goBack"
        :on-forward="goForward"
        :on-reload="goReload"
        :url="current?.url || ''"
        :on-navigate="navigate"
        :loading="current?.loading || false"
        :input-ref="inputRefShim"
        :blocked-count="current?.blockedCount || 0"
        :whitelisted="current?.whitelisted || false"
        :on-toggle-whitelist="toggleWhitelist"
        :suggestions="suggestions"
        :top-sites="topSites"
        :on-suggestion-select="onSuggestionSelect"
        :on-input-change="onUrlInputChange"
        :is-bookmarked="current ? bookmarkedUrls.has(current.url) : false"
        :on-toggle-bookmark="toggleBookmark"
        :on-toggle-reader="toggleReader"
        :is-reader-active="readerTabs.has(activeTab)"
        :reader-settings="readerSettings"
        :on-update-reader-settings="updateReaderSettings"
        :has-video="hasVideo"
        :pip-active="pipActive"
        :on-toggle-pip="togglePip"
        :on-open-settings="onOpenSettings"
        :active-download-count="activeDownloadCount"
        :on-toggle-downloads="toggleDownloads"
        :on-toggle-network="toggleNetwork"
        :pane-tab-ids="paneTabIds"
        :on-split-with="toggleSplit"
        :playing-tab="playingTab"
        :on-media-play-pause="mediaPlayPause"
        :on-media-mute="mediaMute"
        :panels="panels"
        :active-panel-id="activePanelId"
        :on-toggle-panel="togglePanel"
        :on-add-panel="addPanel"
        :on-remove-panel="removePanel"
        :on-reorder-panels="reorderPanels"
        :on-screenshot="openScreenshot"
        :on-share-url="() => { shareOpen = true }"
        :sync-enabled="settings.syncEnabled"
        :paired-devices="syncPairedDevices"
        :on-tab-split-drag="onTabSplitDrag"
        :zoom-level="zoomDisplay[activeTab] ?? zoom[activeTab] ?? 1"
        :on-zoom-reset="() => setZoom(activeTab, 1)"
        :on-edit-bookmark="editBookmark"
        :on-quick-action="handleQuickAction"
        :show-domain-only="settings.showDomainOnly"
        :show-media-controls="settings.showMediaControls"
      />
      <HistoryPanel
        v-if="historyOpen"
        :history="historyEntries"
        removable
        @select="onHistorySelect"
        @close="toggleHistory"
        @clear="clearHistory"
        @remove-entry="removeHistoryEntry"
      />
      <DownloadPanel
        v-if="downloadsOpen"
        :downloads="downloads"
        @pause="pauseDownload"
        @resume="resumeDownload"
        @cancel="cancelDownload"
        @open="openDownload"
        @open-folder="openDownloadFolder"
        @clear-completed="clearCompletedDownloads"
        @close="toggleDownloads"
        @retry="retryDownload"
      />
      <NetworkPanel
        v-if="networkOpen"
        :entries="networkEntries"
        @close="toggleNetwork"
        @clear="clearNetworkLog"
      />
      <div class="sidebar-spacer" :class="compactMode ? 'compact' : sidebarOpen ? '' : 'collapsed'" />
      <div v-if="panelW > 0" :style="{ width: `${panelW}px`, flexShrink: 0 }" />
      <div class="main" ref="mainRef">
        <FindBar
          v-if="findOpen && activeTab && !showInternalPage"
          :tab-id="activeTab"
          @close="closeFindBar"
        />
        <NewTabPage
          v-if="showNtp"
          :top-sites="settings.showTopSites ? topSites : []"
          :show-clock="settings.showClock"
          :show-greeting="settings.showGreeting"
          @navigate="navigate"
          @select-site="navigate"
        />
        <SettingsPage
          v-else-if="showSettings"
          :settings="settings"
          :on-update="updateSettings"
          :on-reload-all-tabs="reloadAllTabs"
          :on-theme-change="handleThemeChange"
          :on-open-url="addTab"
          :on-import-bookmarks="handleImportBookmarks"
          :on-import-history="handleImportHistory"
        />
        <template v-else>
          <WebviewPanel />
          <div
            v-if="tabPreview"
            class="tab-preview-overlay"
            :style="{ position: 'absolute', inset: 0, zIndex: 5, background: 'var(--bg-primary)' }"
          >
            <img
              :src="`data:image/png;base64,${tabPreview}`"
              style="width: 100%; height: 100%; object-fit: cover"
              alt=""
            />
          </div>
        </template>
        <SplitOverlay
          v-if="dividers.length > 0"
          :dividers="dividers"
          :dragging-div="draggingDiv"
          @divider-down="onDividerDown"
        />
        <div
          class="drop-zone-overlay"
          :style="{ pointerEvents: 'none', opacity: dragOverContent ? 1 : 0 }"
        >
          <div
            v-if="dropZone"
            class="drop-zone-preview"
            :style="{
              left: `${dropZone.previewRect.x}px`,
              top: `${dropZone.previewRect.y}px`,
              width: `${dropZone.previewRect.w}px`,
              height: `${dropZone.previewRect.h}px`,
            }"
          />
        </div>
      </div>
    </div>
  </div>
  <div
    v-if="cookieToast"
    class="sync-toast sync-toast--success"
    style="pointer-events: none"
  >
    <svg class="sync-toast-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1L2 4V7.5C2 11.1 4.5 14.4 8 15.2C11.5 14.4 14 11.1 14 7.5V4L8 1Z"
            stroke="var(--success)" stroke-width="1.3" stroke-linejoin="round" fill="none"/>
      <path d="M5.5 8L7 9.5L10.5 6" stroke="var(--success)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>cookie banner rejected</span>
  </div>
  <div v-if="syncToast" :class="`sync-toast sync-toast--${syncToast}`">
    <svg
      v-if="syncToast === 'syncing'"
      class="sync-toast-icon sync-toast-spin" width="16" height="16" viewBox="0 0 16 16" fill="none"
    >
      <path d="M8 1.5A6.5 6.5 0 1 0 14.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <svg
      v-if="syncToast === 'success'"
      class="sync-toast-icon sync-toast-check" width="16" height="16" viewBox="0 0 16 16" fill="none"
    >
      <path d="M3 8.5L6.5 12L13 4" stroke="var(--success)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <svg
      v-if="syncToast === 'error'"
      class="sync-toast-icon" width="16" height="16" viewBox="0 0 16 16" fill="none"
    >
      <path d="M8 4v5M8 11v1" stroke="var(--danger)" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <span>{{ syncToast === "syncing" ? "Syncing..." : syncToast === "success" ? "Synced" : "Sync failed" }}</span>
  </div>
  <div v-if="errorToast" class="sync-toast sync-toast--error">
    <svg class="sync-toast-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 4v5M8 11v1" stroke="var(--danger)" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <span>{{ errorToast }}</span>
  </div>
  <div v-if="updateToast" class="update-toast" @click="updateToast = null">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1v10M4.5 7.5L8 11l3.5-3.5" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M3 14h10" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <div style="display: flex; flex-direction: column; gap: 2px">
      <span style="font-weight: 600">Updated to v{{ updateToast }}</span>
      <span style="font-size: 11px; opacity: 0.6">Click to dismiss</span>
    </div>
  </div>
  <div v-if="pendingUpdate" class="update-toast" @click="installUpdate">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1v10M4.5 7.5L8 11l3.5-3.5" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M3 14h10" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <div style="display: flex; flex-direction: column; gap: 2px">
      <span style="font-weight: 600">{{ pendingUpdate.downloading ? "Downloading..." : `v${pendingUpdate.version} available` }}</span>
      <span style="font-size: 11px; opacity: 0.6">{{ pendingUpdate.downloading ? "Installing update" : "Click to update" }}</span>
    </div>
  </div>
  <div v-if="syncTabReceived" class="sync-toast sync-toast--tab-received" @click="openSyncTab">
    <svg class="sync-toast-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 3h12v10H2z" stroke="var(--accent)" stroke-width="1.3"/>
      <path d="M2 5.5h12" stroke="var(--accent)" stroke-width="1"/>
    </svg>
    <span>Tab from {{ syncTabReceived.from_device }}: {{ syncTabReceived.title.substring(0, 40) }}</span>
    <span style="opacity: 0.6; font-size: 11px">click to open</span>
  </div>
  <div
    v-if="vaultSavePrompt"
    class="vault-save-banner"
    :style="{ left: `${layoutOffset}px`, right: '0' }"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="flex-shrink: 0"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/><circle cx="12" cy="16" r="1"/></svg>
    <span>Save password for <b>{{ vaultSavePrompt.domain }}</b>?</span>
    <span style="opacity: 0.85; font-size: 11px">{{ vaultSavePrompt.username }}</span>
    <button class="vault-save-btn save" @click="vaultSaveConfirm">Save</button>
    <button class="vault-save-btn dismiss" @click="vaultSaveDismiss">Dismiss</button>
  </div>
  <div v-if="vaultMasterModal" class="vault-master-overlay" @click="vaultOverlayClose">
    <div class="vault-master-modal" @click.stop>
      <h3>{{ vaultMasterModal === "setup" ? "Set Master Password" : "Unlock Vault" }}</h3>
      <p style="opacity: 0.6; font-size: 12px; margin: 4px 0 12px">
        {{ vaultMasterModal === "setup" ? "This encrypts all saved passwords." : "Enter your master password to continue." }}
      </p>
      <form @submit.prevent="onVaultSubmit">
        <input v-focus name="vaultpw" type="password" placeholder="Master password" minlength="8" required />
        <input
          v-if="vaultMasterModal === 'setup'"
          name="vaultpw2"
          type="password"
          placeholder="Confirm password"
          minlength="8"
          required
          style="margin-top: 8px"
        />
        <button type="submit" class="vault-save-btn save" style="margin-top: 12px; width: 100%">
          {{ vaultMasterModal === "setup" ? "Set Password" : "Unlock" }}
        </button>
      </form>
    </div>
  </div>
  <div v-if="permReq" class="permission-prompt" :style="{ left: `${layoutOffset + 16}px` }">
    <div class="permission-prompt-icon">
      <svg v-if="permReq.permission === 'camera'" width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="15" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M17 9.5l5-3v11l-5-3z" stroke="currentColor" stroke-width="1.5"/></svg>
      <svg v-else-if="permReq.permission === 'microphone'" width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="8" y="2" width="8" height="12" rx="4" stroke="currentColor" stroke-width="1.5"/><path d="M5 11a7 7 0 0014 0M12 18v4" stroke="currentColor" stroke-width="1.5"/></svg>
      <svg v-else-if="permReq.permission === 'geolocation'" width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M12 2a8 8 0 00-8 8c0 6 8 12 8 12s8-6 8-12a8 8 0 00-8-8z" stroke="currentColor" stroke-width="1.5"/></svg>
      <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v4l3 3" stroke="currentColor" stroke-width="1.5"/></svg>
    </div>
    <div class="permission-prompt-body">
      <span class="permission-prompt-domain">{{ permReq.domain }}</span>
      <span class="permission-prompt-text">wants to use your {{ PERM_LABELS[permReq.permission] || permReq.permission }}</span>
    </div>
    <label class="permission-prompt-remember">
      <input type="checkbox" v-model="permRemember" />
      Remember
    </label>
    <button class="permission-btn deny" @click="respondPerm(false)">Deny</button>
    <button class="permission-btn allow" @click="respondPerm(true)">Allow</button>
  </div>
  <div
    v-if="pageCtx"
    class="ctx-overlay"
    @click="ctxClose"
    @keydown="onPageCtxKeydown"
  >
    <div
      ref="pageCtxRef"
      class="ctx-menu page-ctx"
      :style="{ top: `${pageCtxPos.top}px`, left: `${pageCtxPos.left}px` }"
    >
      <template v-if="pageCtx.linkUri">
        <div class="ctx-item" tabindex="0" @click="ctxOpenLink">
          Open link in new tab
        </div>
        <div class="ctx-item" tabindex="0" @click="ctxCopyLink">
          Copy link address
        </div>
        <div class="ctx-divider" />
      </template>
      <template v-if="pageCtx.kind === 'image' && pageCtx.sourceUri">
        <div class="ctx-item" tabindex="0" @click="ctxOpenImage">
          Open image in new tab
        </div>
        <div class="ctx-item" tabindex="0" @click="ctxSaveImage">
          Save image as...
        </div>
        <div class="ctx-item" tabindex="0" @click="ctxCopyImageUrl">
          Copy image URL
        </div>
        <div class="ctx-divider" />
      </template>
      <template v-if="(pageCtx.kind === 'video' || pageCtx.kind === 'audio') && pageCtx.sourceUri">
        <div class="ctx-item" tabindex="0" @click="ctxOpenMedia">
          Open media in new tab
        </div>
        <div class="ctx-item" tabindex="0" @click="ctxCopyMediaUrl">
          Copy media URL
        </div>
        <div class="ctx-divider" />
      </template>
      <template v-if="pageCtx.selectionText">
        <div class="ctx-item" tabindex="0" @click="ctxCopySelection">
          Copy
        </div>
        <div class="ctx-item" tabindex="0" @click="ctxSearchSelection">
          Search "{{ pageCtx.selectionText.length > 30 ? pageCtx.selectionText.slice(0, 30) + "..." : pageCtx.selectionText }}"
        </div>
        <div class="ctx-divider" />
      </template>
      <div class="ctx-item" tabindex="0" @click="ctxBack">
        Back
      </div>
      <div class="ctx-item" tabindex="0" @click="ctxForward">
        Forward
      </div>
      <div class="ctx-item" tabindex="0" @click="ctxReload">
        Reload
      </div>
      <div class="ctx-divider" />
      <div class="ctx-item" tabindex="0" @click="ctxCopyPageUrl">
        Copy page URL
      </div>
      <div class="ctx-item" tabindex="0" @click="ctxPrintPage">
        Print page
      </div>
      <div class="ctx-item" tabindex="0" @click="ctxViewSource">
        View page source
      </div>
      <div class="ctx-divider" />
      <div class="ctx-item" tabindex="0" @click="ctxInspect">
        Inspect
      </div>
    </div>
  </div>
</template>
