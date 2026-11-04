<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Tab, Workspace, Bookmark, BookmarkFolder, FrecencyResult, WebPanel, SyncTab } from "../types";
import logoSrc from "../assets/logo.png";

// Vue port of src/components/Sidebar.tsx. Callback props are kept as function
// props (1:1 with the React Props) rather than emits — App.vue wires them the
// same way React did. See docs/PORT_STATUS.md.

const WS_COLORS = ["#6366f1", "#f43f5e", "#22c55e", "#f59e0b", "#06b6d4", "#a855f7", "#ec4899", "#14b8a6"];

const EMOJI_CATEGORIES = [
  { label: "Work", emojis: "💼 📊 📈 💡 🎯 ✅ 📝 📋 📌 🗂️".split(" ") },
  { label: "Tech", emojis: "💻 🖥️ ⌨️ 🔧 ⚙️ 🛠️ 🔌 📱 🌐 🔒".split(" ") },
  { label: "Social", emojis: "💬 📧 🎵 🎮 📺 🎬 📸 🎨 ✈️ 🏠".split(" ") },
  { label: "Nature", emojis: "🌙 ⭐ 🔥 🌊 🌿 🌸 🍀 ☀️ 🌈 ❄️".split(" ") },
  { label: "Objects", emojis: "📚 🎓 💰 🏦 🛒 🍕 ☕ 🎁 🏆 💎".split(" ") },
  { label: "Symbols", emojis: "⚡ 💜 💙 💚 ❤️ 🧡 💛 🖤 ⬛ ⬜".split(" ") },
  { label: "Fun", emojis: "🚀 👾 🤖 🎪 🎭 🦊 🐱 🦄 🐙 👻".split(" ") },
];

const PANEL_PRESETS = [
  { name: "ChatGPT", url: "https://chatgpt.com", favicon: "https://www.google.com/s2/favicons?domain=chatgpt.com&sz=32" },
  { name: "Spotify", url: "https://open.spotify.com", favicon: "https://www.google.com/s2/favicons?domain=spotify.com&sz=32" },
  { name: "Discord", url: "https://discord.com/app", favicon: "https://www.google.com/s2/favicons?domain=discord.com&sz=32" },
  { name: "WhatsApp", url: "https://web.whatsapp.com", favicon: "https://www.google.com/s2/favicons?domain=whatsapp.com&sz=32" },
  { name: "YouTube Music", url: "https://music.youtube.com", favicon: "https://www.google.com/s2/favicons?domain=music.youtube.com&sz=32" },
  { name: "Twitter / X", url: "https://x.com", favicon: "https://www.google.com/s2/favicons?domain=x.com&sz=32" },
] as const;

interface QuickAction {
  id: string;
  label: string;
  keywords: string[];
  shortcut?: string;
  action: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: "compact", label: "Toggle Compact Mode", keywords: ["compact", "hide", "sidebar"], shortcut: "Ctrl+Shift+B", action: "toggleCompact" },
  { id: "split", label: "New Split View", keywords: ["split", "side"], shortcut: "Ctrl+\\", action: "splitView" },
  { id: "settings", label: "Open Settings", keywords: ["settings", "preferences", "options"], action: "openSettings" },
  { id: "pin", label: "Pin/Unpin Tab", keywords: ["pin", "unpin", "stick"], action: "togglePin" },
  { id: "mute", label: "Mute/Unmute Tab", keywords: ["mute", "unmute", "sound", "audio"], action: "muteTab" },
  { id: "bookmark", label: "Bookmark This Page", keywords: ["bookmark", "save", "star"], shortcut: "Ctrl+D", action: "addBookmark" },
  { id: "copy-url", label: "Copy Page URL", keywords: ["copy", "url", "link"], action: "copyUrl" },
  { id: "screenshot", label: "Take Screenshot", keywords: ["screenshot", "capture", "snap"], shortcut: "Ctrl+Shift+S", action: "screenshot" },
  { id: "reader", label: "Toggle Reader Mode", keywords: ["reader", "read", "article"], shortcut: "Ctrl+Shift+R", action: "toggleReader" },
  { id: "pip", label: "Picture in Picture", keywords: ["pip", "picture", "video", "float"], action: "togglePip" },
  { id: "zoom-in", label: "Zoom In", keywords: ["zoom", "bigger", "larger"], shortcut: "Ctrl+=", action: "zoomIn" },
  { id: "zoom-out", label: "Zoom Out", keywords: ["zoom", "smaller"], shortcut: "Ctrl+-", action: "zoomOut" },
  { id: "zoom-reset", label: "Reset Zoom", keywords: ["zoom", "reset", "100"], shortcut: "Ctrl+0", action: "zoomReset" },
  { id: "find", label: "Find in Page", keywords: ["find", "search", "ctrl+f"], shortcut: "Ctrl+F", action: "findInPage" },
  { id: "print", label: "Print Page", keywords: ["print"], shortcut: "Ctrl+P", action: "printPage" },
  { id: "devtools", label: "Toggle DevTools", keywords: ["devtools", "inspect", "developer"], shortcut: "Ctrl+Shift+I", action: "toggleDevtools" },
  { id: "fullscreen", label: "Toggle Fullscreen", keywords: ["fullscreen", "f11"], shortcut: "F11", action: "toggleFullscreen" },
  { id: "clear-history", label: "Clear History", keywords: ["clear", "history", "delete"], action: "clearHistory" },
  { id: "new-workspace", label: "New Workspace", keywords: ["workspace", "space", "new"], action: "newWorkspace" },
  { id: "close-tab", label: "Close Tab", keywords: ["close", "tab"], shortcut: "Ctrl+W", action: "closeTab" },
];

const ACTION_SCORES_KEY = "digidaw-action-scores";

function getActionScores(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(ACTION_SCORES_KEY) || "{}"); } catch { return {}; }
}

function bumpActionScore(actionId: string) {
  const scores = getActionScores();
  scores[actionId] = (scores[actionId] || 0) + 1;
  localStorage.setItem(ACTION_SCORES_KEY, JSON.stringify(scores));
}

let _actionScoresDecayed = false;
function decayActionScores() {
  if (_actionScoresDecayed) return;
  _actionScoresDecayed = true;
  const scores = getActionScores();
  const decayed: Record<string, number> = {};
  for (const [k, v] of Object.entries(scores)) {
    const d = Math.round(v * 0.95 * 100) / 100;
    if (d > 0.01) decayed[k] = d;
  }
  localStorage.setItem(ACTION_SCORES_KEY, JSON.stringify(decayed));
}
decayActionScores();

function matchQuickActions(query: string): (QuickAction & { matchScore: number })[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const scores = getActionScores();
  return QUICK_ACTIONS
    .map(a => {
      let matchScore = 0;
      const label = a.label.toLowerCase();
      for (const kw of a.keywords) {
        if (kw.startsWith(q)) matchScore = Math.max(matchScore, 100);
        else if (kw.includes(q)) matchScore = Math.max(matchScore, 50);
      }
      if (label.startsWith(q)) matchScore = Math.max(matchScore, 100);
      else if (label.includes(q)) matchScore = Math.max(matchScore, 50);
      if (matchScore === 0) {
        let qi = 0;
        for (let li = 0; li < label.length && qi < q.length; li++) {
          if (label[li] === q[qi]) qi++;
        }
        if (qi === q.length) matchScore = 25;
      }
      matchScore += (scores[a.id] || 0) * 2;
      return { ...a, matchScore };
    })
    .filter(a => a.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 6);
}

interface ReaderSettings { fontSize: number; font: "serif" | "sans"; theme: "dark" | "light" | "sepia"; lineWidth: number }

interface Props {
  tabs: Tab[];
  pinnedTabs: Tab[];
  activeTab: string;
  open: boolean;
  compact: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onPin: (id: string) => void;
  onNew: (url?: string) => void;
  onToggle: () => void;
  onReorder: (from: number, to: number) => void;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onSwitchWorkspace: (id: string) => void;
  onAddWorkspace: () => void;
  onDeleteWorkspace: (id: string) => void;
  onClearWorkspaceData: (id: string) => void;
  onRenameWorkspace: (id: string, name: string) => void;
  onRecolorWorkspace: (id: string, color: string) => void;
  onSetWorkspaceIcon: (id: string, icon: string | undefined) => void;
  onToggleCollapse: (id: string) => void;
  onAddChildTab: (parentId: string) => void;
  onMoveTabToWorkspace: (tabId: string, targetWsId: string) => void;
  onDuplicateWorkspace: (wsId: string) => void;
  onReorderWorkspaces: (fromIdx: number, toIdx: number) => void;
  onMuteTab: (tabId: string) => void;
  onRenameTab: (tabId: string, customTitle: string) => void;
  bookmarks: Bookmark[];
  bookmarkFolders: BookmarkFolder[];
  onSelectBookmark: (url: string) => void;
  onRemoveBookmark: (id: string) => void;
  onAddBookmarkFolder: (name: string) => string;
  onRenameBookmarkFolder: (folderId: string, name: string) => void;
  onDeleteBookmarkFolder: (folderId: string) => void;
  onMoveBookmarkToFolder: (bookmarkId: string, folderId: string) => void;
  onReorderBookmarks: (bookmarkId: string, targetId: string, position: "before" | "after") => void;
  onReorderFolders: (folderId: string, targetFolderId: string, position: "before" | "after") => void;
  onSetFolderRss?: (folderId: string, rssUrl: string) => void;
  onRemoveFolderRss?: (folderId: string) => void;
  onToggleHistory: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  url: string;
  onNavigate: (url: string) => void;
  loading: boolean;
  inputRef: { value: HTMLInputElement | null };
  blockedCount: number;
  whitelisted: boolean;
  onToggleWhitelist: () => void;
  suggestions: FrecencyResult[];
  topSites: FrecencyResult[];
  onSuggestionSelect: (url: string) => void;
  onInputChange: (query: string) => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  onToggleReader: () => void;
  isReaderActive: boolean;
  readerSettings: ReaderSettings;
  onUpdateReaderSettings: (update: Partial<ReaderSettings>) => void;
  hasVideo: boolean;
  pipActive: boolean;
  onTogglePip: () => void;
  onOpenSettings: () => void;
  activeDownloadCount: number;
  onToggleDownloads: () => void;
  onToggleNetwork: () => void;
  paneTabIds: string[];
  onSplitWith: (targetId?: string) => void;
  playingTab?: Tab;
  onMediaPlayPause: () => void;
  onMediaMute: () => void;
  panels: WebPanel[];
  activePanelId: string | null;
  onTogglePanel: (id: string) => void;
  onAddPanel: (url: string) => void;
  onRemovePanel: (id: string) => void;
  onReorderPanels: (panels: WebPanel[]) => void;
  onScreenshot: () => void;
  onShareUrl: () => void;
  syncEnabled?: boolean;
  pairedDevices?: { device_id: string; name: string }[];
  onTabSplitDrag?: (tabId: string) => void;
  zoomLevel?: number;
  onZoomReset?: () => void;
  onEditBookmark?: (id: string, title: string, url: string) => void;
  onQuickAction?: (action: string) => void;
  showDomainOnly?: boolean;
  showMediaControls?: boolean;
}

const props = defineProps<Props>();

interface CtxMenu { x: number; y: number; tabId: string; pinned: boolean }
interface WsCtxMenu { x: number; y: number; wsId: string }
interface TabNode { tab: Tab; children: TabNode[]; depth: number }

function buildTree(tabs: Tab[]): TabNode[] {
  const map = new Map<string, TabNode>();
  const roots: TabNode[] = [];
  tabs.forEach(t => map.set(t.id, { tab: t, children: [], depth: 0 }));
  tabs.forEach(t => {
    const node = map.get(t.id)!;
    if (t.parentId && map.has(t.parentId)) {
      const parent = map.get(t.parentId)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function flattenTree(nodes: TabNode[]): TabNode[] {
  const result: TabNode[] = [];
  function walk(list: TabNode[]) {
    for (const node of list) {
      result.push(node);
      if (!node.tab.collapsed && node.children.length > 0) walk(node.children);
    }
  }
  walk(nodes);
  return result;
}

// --- state ---
const ctx = ref<CtxMenu | null>(null);
const wsCtx = ref<WsCtxMenu | null>(null);
const emojiPicker = ref<{ wsId: string; x: number; y: number } | null>(null);
const renaming = ref<string | null>(null);
const renameValue = ref("");
const renameRef = ref<HTMLInputElement | null>(null);
const dragIdx = ref<number | null>(null);
const dropIdx = ref<number | null>(null);
const peeking = ref(false);
let peekTimer: ReturnType<typeof setTimeout> | null = null;
const wsDropTarget = ref<string | null>(null);
const startIdx = ref(0);
const listRef = ref<HTMLDivElement | null>(null);
const bookmarksExpanded = ref(true);
const expandedFolders = ref<Set<string>>(new Set());
const bmCtx = ref<{ x: number; y: number; id: string } | null>(null);
const bmCtxMenuRef = ref<HTMLDivElement | null>(null);
const folderCtx = ref<{ x: number; y: number; folderId: string } | null>(null);
const folderCtxMenuRef = ref<HTMLDivElement | null>(null);
const bmDragId = ref<string | null>(null);
const bmDropId = ref<string | null>(null);
const editingBookmark = ref<{ id: string; title: string; url: string } | null>(null);
const bmDragType = ref<"bookmark" | "folder" | null>(null);
const bmListRef = ref<HTMLDivElement | null>(null);
const renamingFolder = ref<string | null>(null);
const renameFolderValue = ref("");
const renameFolderRef = ref<HTMLInputElement | null>(null);
const mediaDismissed = ref(false);
const panelDragIdx = ref<number | null>(null);
const panelDropIdx = ref<number | null>(null);
let prevPlayingTabId: string | undefined = undefined;

const panelPickerOpen = ref(false);
const panelCustomUrl = ref("");
const panelPickerRef = ref<HTMLDivElement | null>(null);
const syncedTabsOpen = ref(false);
const syncedTabs = ref<{ device_id: string; device_name?: string; tabs: SyncTab[]; timestamp: number }[]>([]);
const renamingTabId = ref<string | null>(null);
const renameTabValue = ref("");
const renameTabRef = ref<HTMLInputElement | null>(null);
const wsDragIdx = ref<number | null>(null);
const wsDropIdx = ref<number | null>(null);
let wsScrollCooldown = false;

const urlInput = ref(props.url);
const urlFocused = ref(false);
const selectedIdx = ref(-1);
const extPanelOpen = ref(false);
const extPanelRef = ref<HTMLDivElement | null>(null);

const ctxMenuRef = ref<HTMLDivElement | null>(null);
const wsCtxMenuRef = ref<HTMLDivElement | null>(null);

const preconnected = new Set<string>();

// clamp a context-menu element to the viewport (replaces useClampedMenu hook)
function useClampedMenu(menuEl: typeof ctxMenuRef, anchor: () => { x: number; y: number } | null) {
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

const ctxPos = useClampedMenu(ctxMenuRef, () => ctx.value);
const wsCtxPos = useClampedMenu(wsCtxMenuRef, () => wsCtx.value);
const bmCtxPos = useClampedMenu(bmCtxMenuRef, () => bmCtx.value);
const folderCtxPos = useClampedMenu(folderCtxMenuRef, () => folderCtx.value);

const bookmarksByFolder = computed(() => {
  const map = new Map<string, Bookmark[]>();
  const ungrouped: Bookmark[] = [];
  const folderIds = new Set(props.bookmarkFolders.map(f => f.id));
  for (const b of props.bookmarks) {
    if (b.folderId && folderIds.has(b.folderId)) {
      let arr = map.get(b.folderId);
      if (!arr) { arr = []; map.set(b.folderId, arr); }
      arr.push(b);
    } else {
      ungrouped.push(b);
    }
  }
  for (const arr of map.values()) arr.sort((a, b) => a.order - b.order);
  ungrouped.sort((a, b) => a.order - b.order);
  map.set("__ungrouped__", ungrouped);
  return map;
});

const sortedFolders = computed(() => [...props.bookmarkFolders].sort((a, b) => a.order - b.order));

// quick actions
const isCommandMode = computed(() => urlInput.value.startsWith(">"));
const actionQuery = computed(() => isCommandMode.value ? urlInput.value.slice(1) : urlInput.value);
const quickActions = computed(() => {
  if (!urlFocused.value || !actionQuery.value.trim()) return [];
  return matchQuickActions(actionQuery.value);
});

const totalItems = computed(() => props.suggestions.length + quickActions.value.length);

const displayUrl = computed(() => {
  if (urlFocused.value) return urlInput.value;
  try {
    const u = new URL(urlInput.value);
    if (props.showDomainOnly) return u.hostname;
    return u.hostname + (u.pathname !== "/" ? u.pathname : "");
  } catch { return urlInput.value; }
});

const tabFilter = computed(() => urlFocused.value ? urlInput.value : "");
const filtered = computed(() => {
  const q = tabFilter.value.toLowerCase();
  const fp = tabFilter.value ? props.pinnedTabs.filter(t => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q)) : props.pinnedTabs;
  const ft = tabFilter.value ? props.tabs.filter(t => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q)) : props.tabs;
  const tree = buildTree(ft);
  const flat = flattenTree(tree);
  return { filteredPinned: fp, flatTabs: flat };
});
const filteredPinned = computed(() => filtered.value.filteredPinned);
const flatTabs = computed(() => filtered.value.flatTabs);

// virtualization
const TAB_HEIGHT = 36;
const visibleCount = computed(() => Math.ceil((listRef.value?.clientHeight || 400) / TAB_HEIGHT) + 4);
const endIdx = computed(() => Math.min(startIdx.value + visibleCount.value, flatTabs.value.length));
const visibleTabs = computed(() => flatTabs.value.slice(startIdx.value, endIdx.value));
const topPad = computed(() => startIdx.value * TAB_HEIGHT);
const bottomPad = computed(() => Math.max(0, (flatTabs.value.length - endIdx.value) * TAB_HEIGHT));

function handleScroll(e: Event) {
  const idx = Math.floor((e.currentTarget as HTMLElement).scrollTop / TAB_HEIGHT);
  if (startIdx.value !== idx) startIdx.value = idx;
}

function handleMouseEnter() {
  if (!props.compact) return;
  if (peekTimer) { clearTimeout(peekTimer); peekTimer = null; }
  peeking.value = true;
}
function handleMouseLeave() {
  if (!props.compact) return;
  peekTimer = setTimeout(() => { peeking.value = false; }, 800);
}

// --- effects ---
watch(() => props.url, (u) => { if (!urlFocused.value) urlInput.value = u; });

watch(() => [props.syncEnabled, props.pairedDevices] as const, (_v, _o, onCleanup) => {
  if (!props.syncEnabled) return;
  const fetchTabs = () => {
    invoke<string>("sync_get_all_tabs").then(json => {
      try {
        const raw = JSON.parse(json) as { device_id: string; tabs: string; timestamp: number }[];
        syncedTabs.value = raw.map(d => ({
          device_id: d.device_id,
          device_name: props.pairedDevices?.find(p => p.device_id === d.device_id)?.name,
          tabs: (() => { try { return JSON.parse(d.tabs) as SyncTab[]; } catch { return []; } })(),
          timestamp: d.timestamp,
        }));
      } catch {}
    }).catch(e => console.warn("[digidaw]", e));
  };
  fetchTabs();
  const iv = setInterval(fetchTabs, 10000);
  const unlisten = listen("sync-tabs-changed", fetchTabs);
  onCleanup(() => { clearInterval(iv); unlisten.then(u => u()); });
}, { immediate: true });

watch(extPanelOpen, (openv, _o, onCleanup) => {
  if (!openv) return;
  const handler = (e: MouseEvent) => {
    if (extPanelRef.value && !extPanelRef.value.contains(e.target as Node)) extPanelOpen.value = false;
  };
  document.addEventListener("mousedown", handler);
  onCleanup(() => document.removeEventListener("mousedown", handler));
});

watch(panelPickerOpen, (openv, _o, onCleanup) => {
  if (!openv) return;
  const handler = (e: MouseEvent) => {
    if (panelPickerRef.value && !panelPickerRef.value.contains(e.target as Node)) panelPickerOpen.value = false;
  };
  document.addEventListener("mousedown", handler);
  onCleanup(() => document.removeEventListener("mousedown", handler));
});

watch([() => props.suggestions, () => quickActions.value.length], () => { selectedIdx.value = -1; });

watch(renaming, (v) => { if (v) nextTick(() => { renameRef.value?.focus(); renameRef.value?.select(); }); });
watch(renamingFolder, (v) => { if (v) nextTick(() => { renameFolderRef.value?.focus(); renameFolderRef.value?.select(); }); });
watch(renamingTabId, (v) => { if (v) nextTick(() => { renameTabRef.value?.focus(); renameTabRef.value?.select(); }); });

watch(() => props.playingTab?.id, (id) => {
  if (id !== prevPlayingTabId) { prevPlayingTabId = id; mediaDismissed.value = false; }
});

onUnmounted(() => { if (peekTimer) clearTimeout(peekTimer); });

// --- handlers ---
function handleUrlChange(e: Event) {
  const v = (e.target as HTMLInputElement).value;
  urlInput.value = v;
  props.onInputChange(v);
}

function executeQuickAction(qa: QuickAction) {
  bumpActionScore(qa.id);
  props.onQuickAction?.(qa.action);
  props.inputRef.value?.blur();
}

function handleUrlSubmit() {
  if (selectedIdx.value >= 0 && selectedIdx.value < props.suggestions.length) {
    props.onSuggestionSelect(props.suggestions[selectedIdx.value].url);
    props.inputRef.value?.blur();
    return;
  }
  if (selectedIdx.value >= props.suggestions.length && selectedIdx.value < totalItems.value) {
    const qa = quickActions.value[selectedIdx.value - props.suggestions.length];
    if (qa) { executeQuickAction(qa); return; }
  }
  if (isCommandMode.value && quickActions.value.length > 0) {
    executeQuickAction(quickActions.value[0]);
    return;
  }
  if (urlInput.value.trim()) {
    props.onNavigate(urlInput.value.trim());
    props.inputRef.value?.blur();
  }
}

function handleUrlKeyDown(e: KeyboardEvent) {
  if (!urlFocused.value || totalItems.value === 0) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    const next = Math.min(selectedIdx.value + 1, totalItems.value - 1);
    const s = props.suggestions[next];
    if (s && s.type !== "search" && s.url.startsWith("http") && !preconnected.has(s.url)) {
      preconnected.add(s.url);
      invoke("preconnect_url", { url: s.url }).catch(() => {});
    }
    selectedIdx.value = next;
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selectedIdx.value = Math.max(selectedIdx.value - 1, -1);
  }
}

function onUrlFocus(e: FocusEvent) {
  urlFocused.value = true;
  urlInput.value = props.url;
  props.onInputChange("");
  (e.target as HTMLInputElement).select();
}
function onUrlBlur() { urlFocused.value = false; props.onInputChange(""); }

function preconnectSuggestion(s: FrecencyResult) {
  if (s.type !== "search" && s.url.startsWith("http") && !preconnected.has(s.url)) {
    preconnected.add(s.url);
    invoke("preconnect_url", { url: s.url }).catch(() => {});
  }
}

function toggleFolderExpand(folderId: string) {
  const next = new Set(expandedFolders.value);
  if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
  expandedFolders.value = next;
}

function handlePanelPreset(url: string) {
  props.onAddPanel(url);
  panelPickerOpen.value = false;
  panelCustomUrl.value = "";
}
function handlePanelCustomSubmit() {
  if (panelCustomUrl.value.trim()) {
    props.onAddPanel(panelCustomUrl.value.trim());
    panelPickerOpen.value = false;
    panelCustomUrl.value = "";
  }
}

function handleCtx(e: MouseEvent, tabId: string, pinned: boolean) {
  e.preventDefault();
  ctx.value = { x: e.clientX, y: e.clientY, tabId, pinned };
}
function closeCtx() { ctx.value = null; }
function closeWsCtx() { wsCtx.value = null; }
function handleWsCtx(e: MouseEvent, wsId: string) {
  e.preventDefault();
  wsCtx.value = { x: e.clientX, y: e.clientY, wsId };
}

function startRename(wsId: string) {
  const ws = props.workspaces.find(w => w.id === wsId);
  renameValue.value = ws?.name || "";
  renaming.value = wsId;
  closeWsCtx();
}
function commitRename() {
  if (renaming.value && renameValue.value.trim()) props.onRenameWorkspace(renaming.value, renameValue.value.trim());
  renaming.value = null;
}

// tab reorder / split drag (non-pinned)
function onTabMouseDown(e: MouseEvent, tab: Tab, idx: number | undefined, isPinned: boolean) {
  if (isPinned || idx === undefined || e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  const fromIdx = idx;
  let mode: "none" | "reorder" | "split" = "none";
  let currentDropIdx = -1;

  const onMove = (me: MouseEvent) => {
    const dx = me.clientX - startX;
    const dy = me.clientY - startY;
    if (mode === "none" && dx * dx + dy * dy < 25) return;
    if (mode === "none") {
      if (Math.abs(dx) > Math.abs(dy) && dx > 0) {
        mode = "split";
        dragIdx.value = fromIdx;
        props.onTabSplitDrag?.(tab.id);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        return;
      } else {
        mode = "reorder";
        dragIdx.value = fromIdx;
      }
    }
    if (mode === "reorder") {
      const els = listRef.value?.querySelectorAll(".tab-item");
      if (els) {
        for (let i = 0; i < els.length; i++) {
          const r = els[i].getBoundingClientRect();
          if (me.clientY >= r.top && me.clientY < r.bottom) { currentDropIdx = i; dropIdx.value = i; break; }
        }
      }
    }
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    if (mode === "reorder" && currentDropIdx >= 0 && fromIdx !== currentDropIdx) props.onReorder(fromIdx, currentDropIdx);
    dragIdx.value = null;
    dropIdx.value = null;
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function tabIsSuspended(t: Tab) {
  return t.suspended || t.memoryState === "suspended" || t.memoryState === "destroyed";
}
function tabItemClass(tab: Tab, isPinned: boolean, idx?: number) {
  return [
    "tab-item",
    tab.id === props.activeTab ? "active" : "",
    props.paneTabIds.includes(tab.id) ? "split-active" : "",
    isPinned ? "pinned" : "",
    tabIsSuspended(tab) ? "tab-suspended" : "",
    tab.crashed ? "tab-crashed" : "",
    idx !== undefined && dragIdx.value === idx ? "dragging" : "",
    idx !== undefined && dropIdx.value === idx ? "drop-target" : "",
  ].filter(Boolean).join(" ");
}

function commitTabRename(tabId: string) {
  props.onRenameTab(tabId, renameTabValue.value.trim());
  renamingTabId.value = null;
}

// workspace wheel switch
function onWsWheel(e: WheelEvent) {
  if (wsScrollCooldown || props.workspaces.length <= 1) return;
  wsScrollCooldown = true;
  setTimeout(() => { wsScrollCooldown = false; }, 200);
  const curIdx = props.workspaces.findIndex(w => w.id === props.activeWorkspaceId);
  const nextIdx = e.deltaY > 0 ? Math.min(curIdx + 1, props.workspaces.length - 1) : Math.max(curIdx - 1, 0);
  if (nextIdx !== curIdx) props.onSwitchWorkspace(props.workspaces[nextIdx].id);
}

function onWsDrop(e: DragEvent, ws: Workspace) {
  e.preventDefault();
  const tabId = e.dataTransfer?.getData("text/plain");
  if (tabId && ws.id !== props.activeWorkspaceId) props.onMoveTabToWorkspace(tabId, ws.id);
  wsDropTarget.value = null;
}

function onWsMouseDown(e: MouseEvent, ws: Workspace, i: number) {
  if (e.button !== 0 || renaming.value === ws.id) return;
  const startX = e.clientX;
  const startY = e.clientY;
  const fromIdx = i;
  let dragging = false;
  let currentDrop = -1;
  const target = e.target as HTMLElement;
  const onMove = (me: MouseEvent) => {
    const dx = me.clientX - startX;
    const dy = me.clientY - startY;
    if (!dragging && dx * dx + dy * dy < 25) return;
    if (!dragging) { dragging = true; wsDragIdx.value = fromIdx; }
    const container = target.closest(".workspace-switcher");
    if (container) {
      const dots = container.querySelectorAll(".ws-dot:not(.ws-add)");
      for (let di = 0; di < dots.length; di++) {
        const r = dots[di].getBoundingClientRect();
        if (me.clientX >= r.left && me.clientX < r.right) { currentDrop = di; wsDropIdx.value = di; break; }
      }
    }
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    if (dragging && currentDrop >= 0 && currentDrop !== fromIdx) props.onReorderWorkspaces(fromIdx, currentDrop);
    wsDragIdx.value = null;
    wsDropIdx.value = null;
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

// panel reorder (HTML5 DnD)
function onPanelDragStart(e: DragEvent, i: number) {
  panelDragIdx.value = i;
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}
function onPanelDragOver(e: DragEvent, i: number) {
  e.preventDefault();
  if (panelDragIdx.value !== null && panelDragIdx.value !== i) panelDropIdx.value = i;
}
function onPanelDragEnd() {
  if (panelDragIdx.value !== null && panelDropIdx.value !== null && panelDragIdx.value !== panelDropIdx.value) {
    const next = [...props.panels];
    const [moved] = next.splice(panelDragIdx.value, 1);
    next.splice(panelDropIdx.value, 0, moved);
    props.onReorderPanels(next);
  }
  panelDragIdx.value = null;
  panelDropIdx.value = null;
}
function panelStyle(i: number) {
  const style: Record<string, string | number> = {
    opacity: panelDragIdx.value === i ? 0.6 : 1,
    transition: panelDragIdx.value !== null ? "margin 0.15s" : "",
  };
  if (panelDropIdx.value !== null && panelDragIdx.value !== null && panelDropIdx.value === i && panelDragIdx.value !== i) {
    style[panelDragIdx.value < panelDropIdx.value ? "marginBottom" : "marginTop"] = "24px";
  }
  return style;
}

// bookmark / folder drag-reorder (shared)
function onBmItemMouseDown(e: MouseEvent, b: Bookmark) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const startY = e.clientY;
  let dragging = false;
  let currentDrop: string | null = null;
  const onMove = (me: MouseEvent) => {
    if (!dragging && Math.abs(me.clientY - startY) < 5) return;
    if (!dragging) { dragging = true; bmDragId.value = b.id; bmDragType.value = "bookmark"; }
    const els = bmListRef.value?.querySelectorAll("[data-bm-id], [data-bm-folder]");
    let found: string | null = null;
    if (els) for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (me.clientY >= r.top && me.clientY < r.bottom) {
        const id = els[i].getAttribute("data-bm-id") || els[i].getAttribute("data-bm-folder");
        if (id && id !== b.id) { found = id; break; }
      }
    }
    currentDrop = found;
    bmDropId.value = found;
  };
  const onUp = (me: MouseEvent) => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    if (dragging && currentDrop) {
      const isFolder = props.bookmarkFolders.some(f => f.id === currentDrop);
      if (isFolder) {
        props.onMoveBookmarkToFolder(b.id, currentDrop);
      } else {
        const targetEl = bmListRef.value?.querySelector(`[data-bm-id="${currentDrop}"]`);
        if (targetEl) {
          const r = targetEl.getBoundingClientRect();
          const pos = me.clientY < r.top + r.height / 2 ? "before" : "after";
          props.onReorderBookmarks(b.id, currentDrop, pos);
        }
      }
    }
    bmDragId.value = null; bmDropId.value = null; bmDragType.value = null;
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function onFolderMouseDown(e: MouseEvent, folderId: string) {
  if (e.button !== 0 || renamingFolder.value === folderId) return;
  const startY = e.clientY;
  let dragging = false;
  let currentDrop: string | null = null;
  const onMove = (me: MouseEvent) => {
    if (!dragging && Math.abs(me.clientY - startY) < 5) return;
    if (!dragging) { dragging = true; bmDragId.value = folderId; bmDragType.value = "folder"; }
    const els = bmListRef.value?.querySelectorAll("[data-bm-folder]");
    let found: string | null = null;
    if (els) for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (me.clientY >= r.top && me.clientY < r.bottom && els[i].getAttribute("data-bm-folder") !== folderId) {
        found = els[i].getAttribute("data-bm-folder"); break;
      }
    }
    currentDrop = found;
    bmDropId.value = found;
  };
  const onUp = (me: MouseEvent) => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    if (dragging && currentDrop) {
      const targetEl = bmListRef.value?.querySelector(`[data-bm-folder="${currentDrop}"]`);
      if (targetEl) {
        const r = targetEl.getBoundingClientRect();
        const pos = me.clientY < r.top + r.height / 2 ? "before" : "after";
        props.onReorderFolders(folderId, currentDrop, pos);
      }
    }
    bmDragId.value = null; bmDropId.value = null; bmDragType.value = null;
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function commitFolderRename(folderId: string) {
  if (renameFolderValue.value.trim()) props.onRenameBookmarkFolder(folderId, renameFolderValue.value.trim());
  renamingFolder.value = null;
}

function newFolder() {
  const id = props.onAddBookmarkFolder("New Folder");
  renameFolderValue.value = "New Folder";
  renamingFolder.value = id;
}

// context-menu action helpers
const allTabs = computed(() => [...props.tabs, ...props.pinnedTabs]);
function ctxTab() { return ctx.value ? allTabs.value.find(t => t.id === ctx.value!.tabId) : undefined; }
function ctxCanSendTo() {
  const t = ctxTab();
  return !!(props.syncEnabled && props.pairedDevices && props.pairedDevices.length > 0 && t && t.url.startsWith("http"));
}
function sendTabTo(deviceId: string) {
  const t = ctxTab();
  if (t) invoke("send_tab_to_device", { deviceId, url: t.url, title: t.title });
  closeCtx();
}
function duplicateCtxTab() { const t = ctxTab(); if (t) props.onNew(t.url); closeCtx(); }
function startRenameCtxTab() {
  const t = ctxTab();
  renameTabValue.value = t?.customTitle || t?.title || "";
  if (ctx.value) renamingTabId.value = ctx.value.tabId;
  closeCtx();
}
const ctxMoveWorkspaces = computed(() => {
  if (!ctx.value) return [];
  const wsId = ctxTab()?.workspaceId || props.activeWorkspaceId;
  return props.workspaces.filter(ws => ws.id !== wsId);
});
function closeOtherTabs() {
  if (!ctx.value) return;
  props.tabs.filter(t => t.id !== ctx.value!.tabId).forEach(t => props.onClose(t.id));
  closeCtx();
}
function closeTabsBelow() {
  if (!ctx.value) return;
  const idx = props.tabs.findIndex(t => t.id === ctx.value!.tabId);
  if (idx >= 0) props.tabs.slice(idx + 1).forEach(t => props.onClose(t.id));
  closeCtx();
}

function openEditBookmark() {
  if (!bmCtx.value) return;
  const bm = props.bookmarks.find(b => b.id === bmCtx.value!.id);
  if (bm) editingBookmark.value = { id: bm.id, title: bm.title, url: bm.url };
  bmCtx.value = null;
}
function saveEditBookmark() {
  if (editingBookmark.value && props.onEditBookmark) {
    props.onEditBookmark(editingBookmark.value.id, editingBookmark.value.title, editingBookmark.value.url);
  }
  editingBookmark.value = null;
}

function startRenameFolderFromCtx() {
  if (!folderCtx.value) return;
  const folder = props.bookmarkFolders.find(f => f.id === folderCtx.value!.folderId);
  renameFolderValue.value = folder?.name || "";
  renamingFolder.value = folderCtx.value.folderId;
  folderCtx.value = null;
}
function folderCtxFolder() { return folderCtx.value ? props.bookmarkFolders.find(f => f.id === folderCtx.value!.folderId) : undefined; }
function setFolderRssFromCtx() {
  if (!folderCtx.value) return;
  const url = window.prompt("Enter RSS feed URL:");
  if (url?.trim()) props.onSetFolderRss?.(folderCtx.value.folderId, url.trim());
  folderCtx.value = null;
}

function wsCtxWs() { return wsCtx.value ? props.workspaces.find(w => w.id === wsCtx.value!.wsId) : undefined; }
function openEmojiPicker() {
  if (!wsCtx.value) return;
  emojiPicker.value = { wsId: wsCtx.value.wsId, x: wsCtxPos.value.left + 190, y: wsCtxPos.value.top };
  closeWsCtx();
}
function clearWorkspaceDataConfirm() {
  if (!wsCtx.value) return;
  if (window.confirm("Clear all browsing data for this workspace? You will be logged out of all sites.")) {
    props.onClearWorkspaceData(wsCtx.value.wsId);
  }
  closeWsCtx();
}
const emojiStyle = computed(() => {
  if (!emojiPicker.value) return {};
  return {
    top: `${Math.min(emojiPicker.value.y, window.innerHeight - 360)}px`,
    left: `${Math.min(emojiPicker.value.x, window.innerWidth - 220)}px`,
  };
});

// small template helpers (template can't use `new URL` / `window`)
function domainOf(s: { url: string; title: string }): string {
  try { return new URL(s.url).hostname.replace("www.", ""); } catch { return s.title; }
}
function hostnameOf(u: string): string {
  try { return new URL(u).hostname; } catch { return "secure"; }
}
function firstChar(s: string | undefined | null): string { return (s || "?")[0]; }
function deviceOnline(ts: number): boolean { return Date.now() - ts < 300000; }
function mediaProgressSeek(e: MouseEvent) {
  const t = props.playingTab;
  if (!t) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  invoke("media_seek", { id: t.id, time: pct * (t.mediaDuration || 0) });
}
function mediaProgressHover(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const indicator = (e.currentTarget as HTMLElement).querySelector(".media-bar-progress-hover") as HTMLElement | null;
  if (indicator) { indicator.style.left = `${pct * 100}%`; indicator.style.opacity = "1"; }
}
function mediaProgressLeave(e: MouseEvent) {
  const indicator = (e.currentTarget as HTMLElement).querySelector(".media-bar-progress-hover") as HTMLElement | null;
  if (indicator) indicator.style.opacity = "0";
}
function mediaCmd(cmd: string) { if (props.playingTab) invoke("media_command", { id: props.playingTab.id, cmd }); }
function setInputEl(el: any) { props.inputRef.value = el as HTMLInputElement | null; }
// function refs for inputs rendered inside v-for (avoid Vue's ref-array-in-v-for)
function setRenameRef(el: any) { renameRef.value = el as HTMLInputElement | null; }
function setRenameFolderRef(el: any) { renameFolderRef.value = el as HTMLInputElement | null; }
function setRenameTabRef(el: any) { renameTabRef.value = el as HTMLInputElement | null; }
</script>

<template>
  <div
    class="sidebar"
    :class="[open ? '' : 'collapsed', compact ? 'compact' : '', peeking ? 'peeking' : '']"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <div v-if="!open && !compact" class="sidebar-collapsed-logo">
      <img :src="logoSrc" alt="Digidaw" width="22" height="22" />
      <button class="sidebar-toggle" @click="onToggle">›</button>
    </div>

    <template v-if="open || compact">
      <!-- top row -->
      <div class="sidebar-header-row">
        <button class="settings-btn" title="Settings" @click="onOpenSettings">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" stroke="currentColor" stroke-width="1.3"/>
            <path d="M14.7 11.1l.8 1.4a.9.9 0 01-.3 1.2l-1.5.9a.9.9 0 01-1.1-.1l-.6-.6a5.4 5.4 0 01-1.5.4v.8a.9.9 0 01-.9.9h-1.8a.9.9 0 01-.9-.9v-.8a5.4 5.4 0 01-1.5-.4l-.6.6a.9.9 0 01-1.1.1l-1.5-.9a.9.9 0 01-.3-1.2l.8-1.4a5.4 5.4 0 010-4.2l-.8-1.4a.9.9 0 01.3-1.2l1.5-.9a.9.9 0 011.1.1l.6.6A5.4 5.4 0 017.2 3v-.8a.9.9 0 01.9-.9h1.8a.9.9 0 01.9.9V3a5.4 5.4 0 011.5.4l.6-.6a.9.9 0 011.1-.1l1.5.9a.9.9 0 01.3 1.2l-.8 1.4a5.4 5.4 0 010 4.2z" stroke="currentColor" stroke-width="1.3"/>
          </svg>
        </button>
        <div class="nav-right">
          <div
            class="bookmark-btn" :class="{ bookmarked: isBookmarked }"
            :title="isBookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'"
            @click="onToggleBookmark"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L9.8 5.6L14 6.2L11 9.1L11.7 13.2L8 11.3L4.3 13.2L5 9.1L2 6.2L6.2 5.6L8 2Z"
                    stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" :fill="isBookmarked ? 'var(--accent)' : 'none'" />
            </svg>
          </div>
          <div
            class="shield-badge" :class="{ 'shield-off': whitelisted }"
            :title="whitelisted ? 'shields down (click to enable)' : `${blockedCount} tracker${blockedCount !== 1 ? 's' : ''} blocked (click to disable for this site)`"
            @click="onToggleWhitelist"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1L2 4V7.5C2 11.1 4.5 14.4 8 15.2C11.5 14.4 14 11.1 14 7.5V4L8 1Z"
                    :stroke="whitelisted ? 'var(--text-dim)' : blockedCount > 0 ? 'var(--success)' : 'var(--text-dim)'"
                    stroke-width="1.3" stroke-linejoin="round" fill="none"/>
              <path v-if="whitelisted" d="M5 5.5L11 10.5M11 5.5L5 10.5" stroke="var(--text-dim)" stroke-width="1.2" stroke-linecap="round"/>
              <path v-else-if="blockedCount > 0" d="M5.5 8L7 9.5L10.5 6" stroke="var(--success)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span v-if="!whitelisted && blockedCount > 0" class="shield-count">{{ blockedCount > 99 ? '99+' : blockedCount }}</span>
          </div>
        </div>
      </div>

      <!-- nav buttons -->
      <div class="sidebar-nav-row">
        <button class="nav-btn" title="Back (Alt+←)" @click="onBack">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="nav-btn" title="Forward (Alt+→)" @click="onForward">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="nav-btn" title="Reload (Ctrl+R)" @click="onReload">
          <svg v-if="loading" width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <svg v-else width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 8A5 5 0 1 1 8 3M13 3V8H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>

      <!-- url bar -->
      <form class="sidebar-url-form" @submit.prevent="handleUrlSubmit">
        <div class="sidebar-url-bar" :class="{ focused: urlFocused }">
          <svg class="url-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M9.5 9.5L13 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
          <input
            :ref="setInputEl"
            class="url-input"
            :value="urlFocused ? urlInput : displayUrl"
            @input="handleUrlChange"
            @focus="onUrlFocus"
            @blur="onUrlBlur"
            @keydown="handleUrlKeyDown"
            placeholder="search or enter url"
            :spellcheck="false"
          />
          <button
            v-if="!urlFocused && zoomLevel != null && Math.round(zoomLevel * 100) !== 100"
            class="zoom-badge" type="button" title="Reset zoom to 100%"
            @click.prevent="onZoomReset?.()"
          >{{ Math.round(zoomLevel * 100) }}%</button>
          <button
            v-if="!urlFocused"
            class="ext-trigger" :class="{ open: extPanelOpen }" type="button" title="Extensions & quick actions"
            @click.prevent="extPanelOpen = !extPanelOpen"
          >
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M10.75 9.5V13M5.25 11.25H8.25M10.75 11.25H12.75M7.25 5V8.5M5.25 6.75H7.25M9.75 6.75H12.75M5.25 3H13.75C14.858 3 15.75 3.892 15.75 5V13.5C15.75 14.608 14.858 15.5 13.75 15.5H5.25C4.142 15.5 3.25 14.608 3.25 13.5V5C3.25 3.892 4.142 3 5.25 3Z"/>
            </svg>
          </button>
        </div>

        <!-- extensions panel -->
        <div v-if="extPanelOpen" class="ext-panel" ref="extPanelRef">
          <div class="ext-header">
            <button class="ext-action-btn" title="Bookmark" @click="onToggleBookmark">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 2H12V14L8 11L4 14V2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" :fill="isBookmarked ? 'currentColor' : 'none'"/></svg>
            </button>
            <button class="ext-action-btn" title="Screenshot" @click="onScreenshot">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="3.5" width="13" height="10" rx="1.5" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8.5" r="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 3.5V2.5H10.5V3.5" stroke="currentColor" stroke-width="1.3"/></svg>
            </button>
            <button class="ext-action-btn" :class="{ 'ext-active': isReaderActive }" title="Reader mode (Ctrl+Shift+R)" @click="onToggleReader">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3H6C7.1 3 8 3.9 8 5V14C8 13 7 12 6 12H2V3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M14 3H10C8.9 3 8 3.9 8 5V14C8 13 9 12 10 12H14V3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
            </button>
            <button v-if="hasVideo" class="ext-action-btn" :class="{ 'ext-active': pipActive }" title="Picture in Picture" @click="onTogglePip">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2.5" width="14" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="8" y="7" width="6" height="5" rx="1" fill="currentColor" opacity="0.3" stroke="currentColor" stroke-width="1"/></svg>
            </button>
            <button class="ext-action-btn" title="Share" @click="onShareUrl">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2V10M8 2L5 5M8 2L11 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 9V13H13V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>

          <div class="ext-section">
            <div class="ext-section-header"><span class="ext-section-label">Protections</span></div>
            <div class="ext-grid">
              <button class="ext-tile" :class="{ active: !whitelisted && blockedCount > 0 }" :title="whitelisted ? 'Shields down' : `${blockedCount} blocked`" @click="onToggleWhitelist">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1L2 4V7.5C2 11.1 4.5 14.4 8 15.2C11.5 14.4 14 11.1 14 7.5V4L8 1Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
                  <path v-if="!whitelisted && blockedCount > 0" d="M5.5 8L7 9.5L10.5 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>

          <div v-if="isReaderActive" class="reader-settings">
            <div class="reader-settings-row">
              <button class="reader-size-btn" @click="onUpdateReaderSettings({ fontSize: Math.max(12, readerSettings.fontSize - 2) })">A-</button>
              <span class="reader-size-label">{{ readerSettings.fontSize }}px</span>
              <button class="reader-size-btn" @click="onUpdateReaderSettings({ fontSize: Math.min(28, readerSettings.fontSize + 2) })">A+</button>
              <button class="reader-font-btn" :class="{ active: readerSettings.font === 'serif' }" @click="onUpdateReaderSettings({ font: 'serif' })">Serif</button>
              <button class="reader-font-btn" :class="{ active: readerSettings.font === 'sans' }" @click="onUpdateReaderSettings({ font: 'sans' })">Sans</button>
            </div>
            <div class="reader-settings-row">
              <button class="reader-theme-dot" :class="{ active: readerSettings.theme === 'dark' }" style="background:#09090b" @click="onUpdateReaderSettings({ theme: 'dark' })" />
              <button class="reader-theme-dot" :class="{ active: readerSettings.theme === 'light' }" style="background:#fafafa" @click="onUpdateReaderSettings({ theme: 'light' })" />
              <button class="reader-theme-dot" :class="{ active: readerSettings.theme === 'sepia' }" style="background:#f4ecd8" @click="onUpdateReaderSettings({ theme: 'sepia' })" />
            </div>
          </div>

          <div class="ext-footer">
            <div class="ext-security">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="6" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M5 6V4.5a2 2 0 1 1 4 0V6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              <span>{{ hostnameOf(url) }}</span>
            </div>
          </div>
        </div>

        <div v-if="loading" class="url-progress" />

        <!-- top sites -->
        <div v-if="urlFocused && suggestions.length === 0 && quickActions.length === 0 && topSites.length > 0" class="url-topsites">
          <div v-for="s in topSites" :key="s.url" class="topsite-tile" @mousedown.prevent="onSuggestionSelect(s.url)">
            <div class="topsite-icon">
              <img v-if="s.favicon" :src="s.favicon" alt="" width="28" height="28" />
              <span v-else class="topsite-placeholder">{{ domainOf(s).charAt(0).toUpperCase() }}</span>
            </div>
            <span class="topsite-label">{{ domainOf(s) || s.title }}</span>
          </div>
        </div>

        <!-- suggestions + quick actions -->
        <div v-if="urlFocused && totalItems > 0" class="url-suggestions">
          <template v-if="!isCommandMode">
            <div
              v-for="(s, i) in suggestions" :key="s.url"
              class="suggestion-item" :class="{ selected: i === selectedIdx }"
              @mousedown.prevent="onSuggestionSelect(s.url)"
              @mouseenter="preconnectSuggestion(s)"
            >
              <div class="suggestion-favicon">
                <img v-if="s.favicon" :src="s.favicon" alt="" width="14" height="14" />
                <span v-else class="tab-favicon-placeholder">{{ firstChar(s.title || s.url) }}</span>
              </div>
              <div class="suggestion-text">
                <span class="suggestion-title">{{ s.title || s.url }}</span>
                <span class="suggestion-url">{{ s.url }}</span>
              </div>
              <span class="suggestion-type">{{ s.type === 'bookmark' ? '★' : s.type === 'search' ? '🔍' : '◷' }}</span>
            </div>
          </template>
          <div
            v-for="(qa, i) in quickActions" :key="qa.id"
            class="suggestion-item suggestion-action"
            :class="{ selected: (isCommandMode ? i : suggestions.length + i) === selectedIdx }"
            @mousedown.prevent="executeQuickAction(qa)"
          >
            <div class="suggestion-favicon action-icon">{{ '⚡' }}</div>
            <div class="suggestion-text"><span class="suggestion-title">{{ qa.label }}</span></div>
            <span v-if="qa.shortcut" class="suggestion-shortcut">{{ qa.shortcut }}</span>
            <span class="suggestion-type">action</span>
          </div>
        </div>
      </form>

      <!-- workspace switcher -->
      <div class="workspace-switcher" @wheel="onWsWheel">
        <button
          v-for="(ws, i) in workspaces" :key="ws.id"
          class="ws-dot"
          :class="[ws.id === activeWorkspaceId ? 'active' : '', wsDropTarget === ws.id ? 'ws-drop-target' : '', wsDragIdx === i ? 'ws-dragging' : '', wsDropIdx === i ? 'ws-reorder-target' : '']"
          :style="{ '--ws-color': ws.color }"
          :title="`${ws.name} (Ctrl+${i + 1})`"
          @click="onSwitchWorkspace(ws.id)"
          @contextmenu="handleWsCtx($event, ws.id)"
          @dragover.prevent="$event.dataTransfer && ($event.dataTransfer.dropEffect = 'move')"
          @dragenter="wsDropTarget = ws.id"
          @dragleave="wsDropTarget === ws.id && (wsDropTarget = null)"
          @drop="onWsDrop($event, ws)"
          @mousedown="onWsMouseDown($event, ws, i)"
        >
          <input
            v-if="renaming === ws.id"
            :ref="setRenameRef"
            class="ws-rename-input"
            v-model="renameValue"
            @blur="commitRename"
            @keydown.enter="commitRename"
            @keydown.esc="renaming = null"
            @click.stop
          />
          <span v-else-if="ws.icon" class="ws-dot-emoji">{{ ws.icon }}</span>
          <template v-else>{{ ws.name.charAt(0).toUpperCase() }}</template>
        </button>
        <button class="ws-dot ws-add" title="New workspace" @click="onAddWorkspace">+</button>
      </div>

      <!-- panels -->
      <div class="panel-icons">
        <button
          v-for="(p, i) in panels" :key="p.id"
          class="panel-icon" :class="{ active: activePanelId === p.id, dragging: panelDragIdx === i }"
          :style="panelStyle(i)"
          :title="p.title"
          draggable="true"
          @click="onTogglePanel(p.id)"
          @contextmenu.prevent="onRemovePanel(p.id)"
          @dragstart="onPanelDragStart($event, i)"
          @dragover="onPanelDragOver($event, i)"
          @dragend="onPanelDragEnd"
          @dragleave="panelDropIdx = null"
        >
          <img v-if="p.favicon" :src="p.favicon" alt="" width="18" height="18" />
          <span v-else class="panel-icon-fallback">{{ firstChar(p.title) }}</span>
        </button>
        <div class="panel-picker-wrap" ref="panelPickerRef">
          <button class="panel-icon add" title="Add web panel" @click="panelPickerOpen = !panelPickerOpen">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <div v-if="panelPickerOpen" class="panel-picker">
            <div class="panel-picker-label">add panel</div>
            <div class="panel-picker-presets">
              <button v-for="p in PANEL_PRESETS" :key="p.url" class="panel-picker-item" @click="handlePanelPreset(p.url)">
                <img :src="p.favicon" alt="" width="16" height="16" />
                <span>{{ p.name }}</span>
              </button>
            </div>
            <form class="panel-picker-custom" @submit.prevent="handlePanelCustomSubmit">
              <input class="panel-picker-input" v-model="panelCustomUrl" placeholder="enter url..." :spellcheck="false" autofocus />
            </form>
          </div>
        </div>
      </div>

      <!-- pinned -->
      <div v-if="filteredPinned.length > 0" class="pinned-section">
        <div class="pinned-grid">
          <div
            v-for="t in filteredPinned" :key="t.id"
            :class="tabItemClass(t, true)"
            @click="onSelect(t.id)"
            @contextmenu="handleCtx($event, t.id, true)"
          >
            <div class="tab-info">
              <div v-if="t.crashed" class="tab-crash-badge">!</div>
              <div v-else-if="tabIsSuspended(t)" class="tab-zzz">zzz</div>
              <div v-else-if="t.loading" class="tab-spinner" />
              <div v-else class="tab-favicon">
                <img v-if="t.favicon" :src="t.favicon" alt="" width="14" height="14" />
                <span v-else class="tab-favicon-placeholder">{{ firstChar(t.title || t.url) }}</span>
              </div>
            </div>
            <svg v-if="t.mediaState === 'playing'" class="tab-audio-icon" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink:0;opacity:0.5">
              <path d="M8 1.5a.5.5 0 0 0-.5.5v12a.5.5 0 0 0 1 0V2a.5.5 0 0 0-.5-.5zM5 4.5a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5zM11 4.5a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5zM2 6.5a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 1 0V7a.5.5 0 0 0-.5-.5zM14 6.5a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 1 0V7a.5.5 0 0 0-.5-.5z"/>
            </svg>
          </div>
        </div>
      </div>

      <!-- bookmarks -->
      <div class="bookmark-section">
        <div class="section-label section-label-clickable" @click="bookmarksExpanded = !bookmarksExpanded">
          <span>bookmarks</span>
        </div>
        <div v-if="bookmarksExpanded" class="bookmark-list">
          <div v-if="bookmarks.length === 0 && bookmarkFolders.length === 0" class="bm-empty" @click="onToggleBookmark">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2L9.8 5.6L14 6.2L11 9.1L11.7 13.2L8 11.3L4.3 13.2L5 9.1L2 6.2L6.2 5.6L8 2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none" /></svg>
            <span>Press Ctrl+D to bookmark a page</span>
          </div>
          <div v-else ref="bmListRef">
            <!-- folders -->
            <div v-for="folder in sortedFolders" :key="folder.id">
              <div
                class="bm-folder-row"
                :class="{ 'bm-dragging': bmDragId === folder.id && bmDragType === 'folder', 'bm-drop-target': bmDropId === folder.id }"
                :data-bm-folder="folder.id"
                @click="toggleFolderExpand(folder.id)"
                @contextmenu.prevent="folderCtx = { x: $event.clientX, y: $event.clientY, folderId: folder.id }"
                @mousedown="onFolderMouseDown($event, folder.id)"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" :style="{ transform: expandedFolders.has(folder.id) ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease' }">
                  <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 3h3.5l1.5 1.5H12v7H2V3z" stroke="var(--text-dim)" stroke-width="1.2" :fill="expandedFolders.has(folder.id) ? 'var(--accent-soft)' : 'none'"/>
                </svg>
                <input
                  v-if="renamingFolder === folder.id"
                  :ref="setRenameFolderRef"
                  class="bm-folder-rename"
                  v-model="renameFolderValue"
                  @blur="commitFolderRename(folder.id)"
                  @keydown.enter="commitFolderRename(folder.id)"
                  @keydown.esc="renamingFolder = null"
                  @click.stop
                  :spellcheck="false"
                />
                <span v-else class="bm-folder-name">{{ folder.name }}</span>
                <span v-if="folder.rssUrl" class="bm-rss-icon" title="Live Folder (RSS)">&#128225;</span>
                <span class="bm-folder-count">{{ (bookmarksByFolder.get(folder.id) || []).length + (folder.autoItems?.length || 0) }}</span>
              </div>
              <template v-if="expandedFolders.has(folder.id)">
                <div
                  v-for="b in (bookmarksByFolder.get(folder.id) || [])" :key="b.id"
                  class="bookmark-item bm-indented"
                  :class="{ 'bm-dragging': bmDragId === b.id, 'bm-drop-target': bmDropId === b.id }"
                  :data-bm-id="b.id"
                  @click="onSelectBookmark(b.url)"
                  @contextmenu.prevent="bmCtx = { x: $event.clientX, y: $event.clientY, id: b.id }"
                  @mousedown="onBmItemMouseDown($event, b)"
                >
                  <div class="tab-favicon">
                    <img v-if="b.favicon" :src="b.favicon" alt="" width="14" height="14" />
                    <span v-else class="tab-favicon-placeholder">{{ firstChar(b.title || b.url) }}</span>
                  </div>
                  <span class="tab-title">{{ b.title || b.url }}</span>
                </div>
                <template v-if="folder.autoItems && folder.autoItems.length > 0">
                  <div v-if="(bookmarksByFolder.get(folder.id) || []).length > 0" class="bm-rss-separator" />
                  <div v-for="item in folder.autoItems" :key="item.id" class="bookmark-item bm-indented bm-rss-item" :title="item.url" @click="onSelectBookmark(item.url)">
                    <span class="bm-rss-dot" />
                    <span class="tab-title">{{ item.title }}</span>
                  </div>
                </template>
              </template>
            </div>
            <!-- ungrouped -->
            <div
              v-for="b in (bookmarksByFolder.get('__ungrouped__') || [])" :key="b.id"
              class="bookmark-item"
              :class="{ 'bm-dragging': bmDragId === b.id, 'bm-drop-target': bmDropId === b.id }"
              :data-bm-id="b.id"
              @click="onSelectBookmark(b.url)"
              @contextmenu.prevent="bmCtx = { x: $event.clientX, y: $event.clientY, id: b.id }"
              @mousedown="onBmItemMouseDown($event, b)"
            >
              <div class="tab-favicon">
                <img v-if="b.favicon" :src="b.favicon" alt="" width="14" height="14" />
                <span v-else class="tab-favicon-placeholder">{{ firstChar(b.title || b.url) }}</span>
              </div>
              <span class="tab-title">{{ b.title || b.url }}</span>
            </div>
            <div class="bm-new-folder" @click="newFolder">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
              <span>new folder</span>
            </div>
          </div>
        </div>
      </div>

      <!-- synced tabs -->
      <div v-if="syncEnabled && syncedTabs.length > 0" class="bookmark-section">
        <div class="section-label section-label-clickable" style="justify-content:flex-start;gap:6px" @click="syncedTabsOpen = !syncedTabsOpen">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" :style="{ transform: syncedTabsOpen ? 'rotate(90deg)' : '', transition: 'transform 0.15s', flexShrink: 0 }">
            <path d="M3 1L7 5L3 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>synced tabs</span>
        </div>
        <div v-if="syncedTabsOpen" class="bookmark-list">
          <div v-for="device in syncedTabs" :key="device.device_id">
            <div class="section-label" style="font-size:10px;opacity:0.5;padding-left:12px">
              {{ device.device_name || device.device_id.substring(0, 8) }}
              <span style="margin-left:4px;font-size:9px">{{ deviceOnline(device.timestamp) ? '  online' : '' }}</span>
            </div>
            <div v-for="(st, i) in device.tabs.slice(0, 5)" :key="i" class="bookmark-item" :title="st.url" @click="onSelectBookmark(st.url)">
              <img v-if="st.favicon" :src="st.favicon" alt="" width="14" height="14" style="margin-right:6px;border-radius:2px" />
              <span class="bookmark-title">{{ st.title || st.url }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- tab list (virtualized) -->
      <div class="tab-section">
        <div class="tab-list" ref="listRef" @scroll="handleScroll">
          <div :style="{ height: `${topPad}px` }" />
          <div
            v-for="(node, i) in visibleTabs" :key="node.tab.id"
            :class="tabItemClass(node.tab, false, startIdx + i)"
            :style="node.depth > 0 ? { paddingLeft: `${10 + node.depth * 16}px` } : undefined"
            @click="onSelect(node.tab.id)"
            @contextmenu="handleCtx($event, node.tab.id, false)"
            @mousedown="onTabMouseDown($event, node.tab, startIdx + i, false)"
          >
            <button v-if="node.children.length > 0" class="tab-collapse-btn" @click.stop="onToggleCollapse(node.tab.id)">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path v-if="node.tab.collapsed" d="M3 1L8 5L3 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                <path v-else d="M1 3L5 8L9 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div class="tab-info">
              <div v-if="node.tab.crashed" class="tab-crash-badge">!</div>
              <div v-else-if="tabIsSuspended(node.tab)" class="tab-zzz">zzz</div>
              <div v-else-if="node.tab.loading" class="tab-spinner" />
              <div v-else class="tab-favicon">
                <img v-if="node.tab.favicon" :src="node.tab.favicon" alt="" width="14" height="14" />
                <span v-else class="tab-favicon-placeholder">{{ firstChar(node.tab.title || node.tab.url) }}</span>
              </div>
              <input
                v-if="renamingTabId === node.tab.id"
                :ref="setRenameTabRef"
                class="tab-rename-input"
                v-model="renameTabValue"
                @blur="commitTabRename(node.tab.id)"
                @keydown.enter="commitTabRename(node.tab.id)"
                @keydown.esc="renamingTabId = null"
                @click.stop
                :spellcheck="false"
              />
              <span v-else class="tab-title">{{ node.tab.customTitle || node.tab.title }}</span>
            </div>
            <svg v-if="node.tab.mediaState === 'playing'" class="tab-audio-icon" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink:0;opacity:0.5">
              <path d="M8 1.5a.5.5 0 0 0-.5.5v12a.5.5 0 0 0 1 0V2a.5.5 0 0 0-.5-.5zM5 4.5a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5zM11 4.5a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5zM2 6.5a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 1 0V7a.5.5 0 0 0-.5-.5zM14 6.5a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 1 0V7a.5.5 0 0 0-.5-.5z"/>
            </svg>
            <button class="tab-close" @click.stop="onClose(node.tab.id)">×</button>
          </div>
          <div :style="{ height: `${bottomPad}px` }" />
        </div>
      </div>

      <!-- media bar -->
      <div v-if="playingTab && !mediaDismissed && showMediaControls !== false" class="media-bar" @click="onSelect(playingTab.id)">
        <button class="media-bar-dismiss" title="Dismiss" @click.stop="mediaDismissed = true">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2L8 8M8 2L2 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </button>
        <div class="media-bar-compact">
          <div class="media-bar-favicon">
            <img v-if="playingTab.favicon" :src="playingTab.favicon" alt="" width="14" height="14" />
            <span v-else class="tab-favicon-placeholder">{{ firstChar(playingTab.title) }}</span>
          </div>
          <div class="media-bar-title-wrap"><span class="media-bar-title">{{ playingTab.mediaTitle || playingTab.title }}</span></div>
          <button class="media-bar-btn" :title="playingTab.mediaState === 'playing' ? 'Pause' : 'Play'" @click.stop="onMediaPlayPause">
            <svg v-if="playingTab.mediaState === 'playing'" width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="2" width="3" height="10" rx="0.5" fill="currentColor"/><rect x="8" y="2" width="3" height="10" rx="0.5" fill="currentColor"/></svg>
            <svg v-else width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 2L12 7L4 12V2Z" fill="currentColor"/></svg>
          </button>
        </div>
        <div class="media-bar-expanded">
          <span v-if="playingTab.mediaArtist" class="media-bar-artist">{{ playingTab.mediaArtist }}</span>
          <div
            v-if="playingTab.mediaDuration != null && playingTab.mediaDuration > 0"
            class="media-bar-progress" style="cursor:pointer;position:relative"
            @click.stop="mediaProgressSeek"
            @mousemove="mediaProgressHover"
            @mouseleave="mediaProgressLeave"
          >
            <div class="media-bar-progress-fill" :style="{ width: `${((playingTab.mediaCurrentTime || 0) / playingTab.mediaDuration) * 100}%` }" />
            <div class="media-bar-progress-hover" style="position:absolute;top:0;width:1px;height:100%;background:var(--text-primary,#fff);opacity:0;pointer-events:none;transition:opacity 0.15s" />
          </div>
          <div class="media-bar-controls">
            <button class="media-bar-btn" title="Previous track" @click.stop="mediaCmd('prev')">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="3" width="2" height="8" rx="0.5" fill="currentColor"/><path d="M12 3L6 7L12 11V3Z" fill="currentColor"/></svg>
            </button>
            <button class="media-bar-btn" :title="playingTab.mediaState === 'playing' ? 'Pause' : 'Play'" @click.stop="onMediaPlayPause">
              <svg v-if="playingTab.mediaState === 'playing'" width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="2" width="3" height="10" rx="0.5" fill="currentColor"/><rect x="8" y="2" width="3" height="10" rx="0.5" fill="currentColor"/></svg>
              <svg v-else width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 2L12 7L4 12V2Z" fill="currentColor"/></svg>
            </button>
            <button class="media-bar-btn" title="Next track" @click.stop="mediaCmd('next')">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 3L8 7L2 11V3Z" fill="currentColor"/><rect x="10" y="3" width="2" height="8" rx="0.5" fill="currentColor"/></svg>
            </button>
            <button class="media-bar-btn" title="Mute/Unmute" @click.stop="onMediaMute">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5H4L7 2V12L4 9H2V5Z" fill="currentColor"/><path d="M9.5 4.5C10.3 5.3 10.8 6.6 10.8 7S10.3 8.7 9.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- bottom buttons -->
      <div class="sidebar-bottom-btns">
        <button class="new-tab-btn" @click="onNew()">
          <span class="new-tab-icon">+</span>
          <span>new tab</span>
        </button>
        <button class="history-btn" title="History (Ctrl+H)" @click="onToggleHistory">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M8 5V8.5L10.5 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="download-btn" title="Downloads" @click="onToggleDownloads">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2V10M8 10L5 7M8 10L11 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12H13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          <span v-if="activeDownloadCount > 0" class="download-badge">{{ activeDownloadCount }}</span>
        </button>
        <button class="network-btn" title="Network Inspector" @click="onToggleNetwork">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4H14M2 8H14M2 12H14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="5" cy="4" r="1" fill="currentColor"/><circle cx="9" cy="8" r="1" fill="currentColor"/><circle cx="7" cy="12" r="1" fill="currentColor"/></svg>
        </button>
        <button v-if="hasVideo" class="pip-shortcut-btn" :class="{ 'pip-active': pipActive }" title="Picture in Picture" @click="onTogglePip">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2.5" width="14" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="8" y="7" width="6" height="5" rx="1" fill="currentColor" opacity="0.3" stroke="currentColor" stroke-width="1"/></svg>
        </button>
      </div>
    </template>
  </div>

  <!-- tab context menu -->
  <div v-if="ctx" class="ctx-overlay" @click="closeCtx">
    <div ref="ctxMenuRef" class="ctx-menu" :style="{ top: `${ctxPos.top}px`, left: `${ctxPos.left}px` }">
      <button class="ctx-item" @click="onPin(ctx.tabId); closeCtx()">{{ ctx.pinned ? 'unpin tab' : 'pin tab' }}</button>
      <button class="ctx-item" @click="onClose(ctx.tabId); closeCtx()">close tab</button>
      <button v-if="!ctx.pinned" class="ctx-item" @click="onAddChildTab(ctx.tabId); closeCtx()">open child tab</button>
      <button v-if="ctx.tabId !== activeTab" class="ctx-item" @click="onSplitWith(ctx.tabId); closeCtx()">split with this tab</button>
      <template v-if="ctxCanSendTo()">
        <div class="ctx-divider" />
        <button v-for="d in pairedDevices" :key="d.device_id" class="ctx-item" @click="sendTabTo(d.device_id)">send to {{ d.name }}</button>
      </template>
      <button class="ctx-item" @click="duplicateCtxTab">duplicate tab</button>
      <button class="ctx-item" @click="onMuteTab(ctx.tabId); closeCtx()">mute tab</button>
      <button v-if="!ctx.pinned" class="ctx-item" @click="startRenameCtxTab">rename tab</button>
      <template v-if="workspaces.length > 1">
        <div class="ctx-divider" />
        <div class="ctx-label">move to workspace</div>
        <button v-for="ws in ctxMoveWorkspaces" :key="ws.id" class="ctx-item" @click="onMoveTabToWorkspace(ctx.tabId, ws.id); closeCtx()">
          <span class="ctx-ws-dot" :style="{ background: ws.color }" />{{ ws.name }}
        </button>
      </template>
      <div class="ctx-divider" />
      <button class="ctx-item" @click="closeOtherTabs">close other tabs</button>
      <button class="ctx-item" @click="closeTabsBelow">close tabs below</button>
    </div>
  </div>

  <!-- bookmark context menu -->
  <div v-if="bmCtx" class="ctx-overlay" @click="bmCtx = null">
    <div ref="bmCtxMenuRef" class="ctx-menu" :style="{ top: `${bmCtxPos.top}px`, left: `${bmCtxPos.left}px` }">
      <template v-if="bookmarkFolders.length > 0">
        <div class="ctx-label">move to folder</div>
        <button v-for="f in bookmarkFolders" :key="f.id" class="ctx-item" @click="onMoveBookmarkToFolder(bmCtx.id, f.id); bmCtx = null">{{ f.name }}</button>
        <button class="ctx-item" @click="onMoveBookmarkToFolder(bmCtx.id, ''); bmCtx = null">(no folder)</button>
        <div class="ctx-divider" />
      </template>
      <button v-if="onEditBookmark" class="ctx-item" @click="openEditBookmark">edit bookmark</button>
      <button class="ctx-item ctx-danger" @click="onRemoveBookmark(bmCtx.id); bmCtx = null">remove bookmark</button>
    </div>
  </div>

  <!-- bookmark edit modal -->
  <div v-if="editingBookmark" class="ctx-overlay" @click="editingBookmark = null">
    <div class="bm-edit-modal" @click.stop>
      <div class="bm-edit-title">edit bookmark</div>
      <label class="bm-edit-label">
        title
        <input class="bm-edit-input" v-model="editingBookmark.title" :spellcheck="false" autofocus />
      </label>
      <label class="bm-edit-label">
        url
        <input class="bm-edit-input" v-model="editingBookmark.url" :spellcheck="false" />
      </label>
      <div class="bm-edit-actions">
        <button class="bm-edit-cancel" @click="editingBookmark = null">cancel</button>
        <button class="bm-edit-save" @click="saveEditBookmark">save</button>
      </div>
    </div>
  </div>

  <!-- folder context menu -->
  <div v-if="folderCtx" class="ctx-overlay" @click="folderCtx = null">
    <div ref="folderCtxMenuRef" class="ctx-menu" :style="{ top: `${folderCtxPos.top}px`, left: `${folderCtxPos.left}px` }">
      <button class="ctx-item" @click="startRenameFolderFromCtx">rename folder</button>
      <template v-if="onSetFolderRss">
        <button v-if="folderCtxFolder()?.rssUrl" class="ctx-item" @click="onRemoveFolderRss?.(folderCtx.folderId); folderCtx = null">remove RSS feed</button>
        <button v-else class="ctx-item" @click="setFolderRssFromCtx">set RSS feed...</button>
      </template>
      <button class="ctx-item ctx-danger" @click="onDeleteBookmarkFolder(folderCtx.folderId); folderCtx = null">delete folder</button>
    </div>
  </div>

  <!-- workspace context menu -->
  <div v-if="wsCtx" class="ctx-overlay" @click="closeWsCtx">
    <div ref="wsCtxMenuRef" class="ctx-menu" :style="{ top: `${wsCtxPos.top}px`, left: `${wsCtxPos.left}px` }">
      <button class="ctx-item" @click="startRename(wsCtx.wsId)">rename workspace</button>
      <div class="ctx-divider" />
      <div class="ctx-label">color</div>
      <div class="ctx-color-swatches">
        <button
          v-for="c in WS_COLORS" :key="c"
          class="ctx-swatch" :class="{ active: wsCtxWs()?.color === c }"
          :style="{ background: c }"
          @click="onRecolorWorkspace(wsCtx.wsId, c); closeWsCtx()"
        />
      </div>
      <div class="ctx-divider" />
      <button class="ctx-item" @click="openEmojiPicker">set icon...</button>
      <button v-if="wsCtxWs()?.icon" class="ctx-item" @click="onSetWorkspaceIcon(wsCtx.wsId, undefined); closeWsCtx()">clear icon</button>
      <div class="ctx-divider" />
      <button class="ctx-item" @click="clearWorkspaceDataConfirm">clear workspace data</button>
      <button class="ctx-item" @click="onDuplicateWorkspace(wsCtx.wsId); closeWsCtx()">duplicate workspace</button>
      <template v-if="workspaces.length > 1">
        <div class="ctx-divider" />
        <button class="ctx-item ctx-danger" @click="onDeleteWorkspace(wsCtx.wsId); closeWsCtx()">delete workspace</button>
      </template>
    </div>
  </div>

  <!-- emoji picker -->
  <div v-if="emojiPicker" class="ctx-overlay" @click="emojiPicker = null">
    <div class="emoji-picker" :style="emojiStyle" @click.stop>
      <div v-for="cat in EMOJI_CATEGORIES" :key="cat.label" class="emoji-picker-category">
        <div class="emoji-picker-label">{{ cat.label }}</div>
        <div class="emoji-picker-grid">
          <button v-for="emoji in cat.emojis" :key="emoji" class="emoji-picker-item" @click="onSetWorkspaceIcon(emojiPicker.wsId, emoji); emojiPicker = null">{{ emoji }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
