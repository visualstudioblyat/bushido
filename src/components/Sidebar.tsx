import { useState, useCallback, useRef, useEffect, useMemo, memo, RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Tab, Workspace, Bookmark, BookmarkFolder, FrecencyResult, WebPanel, SyncTab } from "../types";
import logoSrc from "../assets/logo.png";

const GearIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M9 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M14.7 11.1l.8 1.4a.9.9 0 01-.3 1.2l-1.5.9a.9.9 0 01-1.1-.1l-.6-.6a5.4 5.4 0 01-1.5.4v.8a.9.9 0 01-.9.9h-1.8a.9.9 0 01-.9-.9v-.8a5.4 5.4 0 01-1.5-.4l-.6.6a.9.9 0 01-1.1.1l-1.5-.9a.9.9 0 01-.3-1.2l.8-1.4a5.4 5.4 0 010-4.2l-.8-1.4a.9.9 0 01.3-1.2l1.5-.9a.9.9 0 011.1.1l.6.6A5.4 5.4 0 017.2 3v-.8a.9.9 0 01.9-.9h1.8a.9.9 0 01.9.9V3a5.4 5.4 0 011.5.4l.6-.6a.9.9 0 011.1-.1l1.5.9a.9.9 0 01.3 1.2l-.8 1.4a5.4 5.4 0 010 4.2z" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
);

const WS_COLORS = ["#6366f1", "#f43f5e", "#22c55e", "#f59e0b", "#06b6d4", "#a855f7", "#ec4899", "#14b8a6"];

const EMOJI_CATEGORIES = [
  { label: "Work", emojis: "\uD83D\uDCBC \uD83D\uDCCA \uD83D\uDCC8 \uD83D\uDCA1 \uD83C\uDFAF \u2705 \uD83D\uDCDD \uD83D\uDCCB \uD83D\uDCCC \uD83D\uDDC2\uFE0F".split(" ") },
  { label: "Tech", emojis: "\uD83D\uDCBB \uD83D\uDDA5\uFE0F \u2328\uFE0F \uD83D\uDD27 \u2699\uFE0F \uD83D\uDEE0\uFE0F \uD83D\uDD0C \uD83D\uDCF1 \uD83C\uDF10 \uD83D\uDD12".split(" ") },
  { label: "Social", emojis: "\uD83D\uDCAC \uD83D\uDCE7 \uD83C\uDFB5 \uD83C\uDFAE \uD83D\uDCFA \uD83C\uDFAC \uD83D\uDCF8 \uD83C\uDFA8 \u2708\uFE0F \uD83C\uDFE0".split(" ") },
  { label: "Nature", emojis: "\uD83C\uDF19 \u2B50 \uD83D\uDD25 \uD83C\uDF0A \uD83C\uDF3F \uD83C\uDF38 \uD83C\uDF40 \u2600\uFE0F \uD83C\uDF08 \u2744\uFE0F".split(" ") },
  { label: "Objects", emojis: "\uD83D\uDCDA \uD83C\uDF93 \uD83D\uDCB0 \uD83C\uDFE6 \uD83D\uDED2 \uD83C\uDF55 \u2615 \uD83C\uDF81 \uD83C\uDFC6 \uD83D\uDC8E".split(" ") },
  { label: "Symbols", emojis: "\u26A1 \uD83D\uDC9C \uD83D\uDC99 \uD83D\uDC9A \u2764\uFE0F \uD83E\uDDE1 \uD83D\uDC9B \uD83D\uDDA4 \u2B1B \u2B1C".split(" ") },
  { label: "Fun", emojis: "\uD83D\uDE80 \uD83D\uDC7E \uD83E\uDD16 \uD83C\uDFAA \uD83C\uDFAD \uD83E\uDD8A \uD83D\uDC31 \uD83E\uDD84 \uD83D\uDC19 \uD83D\uDC7B".split(" ") },
];

const PANEL_PRESETS = [
  { name: "ChatGPT", url: "https://chatgpt.com", favicon: "https://www.google.com/s2/favicons?domain=chatgpt.com&sz=32" },
  { name: "Spotify", url: "https://open.spotify.com", favicon: "https://www.google.com/s2/favicons?domain=spotify.com&sz=32" },
  { name: "Discord", url: "https://discord.com/app", favicon: "https://www.google.com/s2/favicons?domain=discord.com&sz=32" },
  { name: "WhatsApp", url: "https://web.whatsapp.com", favicon: "https://www.google.com/s2/favicons?domain=whatsapp.com&sz=32" },
  { name: "YouTube Music", url: "https://music.youtube.com", favicon: "https://www.google.com/s2/favicons?domain=music.youtube.com&sz=32" },
  { name: "Twitter / X", url: "https://x.com", favicon: "https://www.google.com/s2/favicons?domain=x.com&sz=32" },
] as const;

// --- Quick Actions ---
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

const ACTION_SCORES_KEY = "bushido-action-scores";

function getActionScores(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(ACTION_SCORES_KEY) || "{}"); } catch { return {}; }
}

function bumpActionScore(actionId: string) {
  const scores = getActionScores();
  scores[actionId] = (scores[actionId] || 0) + 1;
  localStorage.setItem(ACTION_SCORES_KEY, JSON.stringify(scores));
}

// Decay scores on session start (called once)
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
      // keyword matching
      for (const kw of a.keywords) {
        if (kw.startsWith(q)) matchScore = Math.max(matchScore, 100);
        else if (kw.includes(q)) matchScore = Math.max(matchScore, 50);
      }
      // label matching
      if (label.startsWith(q)) matchScore = Math.max(matchScore, 100);
      else if (label.includes(q)) matchScore = Math.max(matchScore, 50);
      // subsequence match on label
      if (matchScore === 0) {
        let qi = 0;
        for (let li = 0; li < label.length && qi < q.length; li++) {
          if (label[li] === q[qi]) qi++;
        }
        if (qi === q.length) matchScore = 25;
      }
      // boost from learned scores
      matchScore += (scores[a.id] || 0) * 2;
      return { ...a, matchScore };
    })
    .filter(a => a.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 6);
}

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
  inputRef: RefObject<HTMLInputElement>;
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
  readerSettings: { fontSize: number; font: "serif" | "sans"; theme: "dark" | "light" | "sepia"; lineWidth: number };
  onUpdateReaderSettings: (update: Partial<{ fontSize: number; font: "serif" | "sans"; theme: "dark" | "light" | "sepia"; lineWidth: number }>) => void;
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

interface CtxMenu {
  x: number;
  y: number;
  tabId: string;
  pinned: boolean;
}

interface WsCtxMenu {
  x: number;
  y: number;
  wsId: string;
}

// hook: measure a context menu ref and clamp to viewport
function useClampedMenu(menuRef: React.RefObject<HTMLDivElement | null>, anchor: { x: number; y: number } | null) {
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!anchor) return;
    // start off-screen so we can measure without flash
    setPos({ top: -9999, left: -9999 });
    // measure after render
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

interface TabNode {
  tab: Tab;
  children: TabNode[];
  depth: number;
}

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

export default memo(function Sidebar({
  tabs, pinnedTabs, activeTab, open, compact,
  onSelect, onClose, onPin, onNew, onToggle, onReorder,
  workspaces, activeWorkspaceId,
  onSwitchWorkspace, onAddWorkspace, onDeleteWorkspace, onClearWorkspaceData, onRenameWorkspace, onRecolorWorkspace, onSetWorkspaceIcon,
  onToggleCollapse, onAddChildTab, onMoveTabToWorkspace, onDuplicateWorkspace, onReorderWorkspaces, onMuteTab, onRenameTab,
  bookmarks, bookmarkFolders, onSelectBookmark, onRemoveBookmark,
  onAddBookmarkFolder, onRenameBookmarkFolder, onDeleteBookmarkFolder, onMoveBookmarkToFolder,
  onReorderBookmarks, onReorderFolders,
  onSetFolderRss, onRemoveFolderRss,
  onToggleHistory,
  onBack, onForward, onReload,
  url, onNavigate, loading, inputRef,
  blockedCount, whitelisted, onToggleWhitelist,
  suggestions, topSites, onSuggestionSelect, onInputChange,
  isBookmarked, onToggleBookmark,
  onToggleReader, isReaderActive, readerSettings, onUpdateReaderSettings,
  hasVideo, pipActive, onTogglePip,
  onOpenSettings,
  activeDownloadCount, onToggleDownloads, onToggleNetwork,
  paneTabIds, onSplitWith,
  playingTab, onMediaPlayPause, onMediaMute,
  panels, activePanelId, onTogglePanel, onAddPanel, onRemovePanel, onReorderPanels,
  onScreenshot, onShareUrl,
  syncEnabled, pairedDevices,
  onTabSplitDrag,
  zoomLevel, onZoomReset, onEditBookmark, onQuickAction,
  showDomainOnly, showMediaControls,
}: Props) {
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const [wsCtx, setWsCtx] = useState<WsCtxMenu | null>(null);
  const [emojiPicker, setEmojiPicker] = useState<{ wsId: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [peeking, setPeeking] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // tab search is driven by the URL bar input when focused
  const [wsDropTarget, setWsDropTarget] = useState<string | null>(null);
  const [startIdx, setStartIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [bookmarksExpanded, setBookmarksExpanded] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [bmCtx, setBmCtx] = useState<{ x: number; y: number; id: string } | null>(null);
  const bmCtxMenuRef = useRef<HTMLDivElement>(null);
  const bmCtxPos = useClampedMenu(bmCtxMenuRef, bmCtx);
  const [folderCtx, setFolderCtx] = useState<{ x: number; y: number; folderId: string } | null>(null);
  const folderCtxMenuRef = useRef<HTMLDivElement>(null);
  const folderCtxPos = useClampedMenu(folderCtxMenuRef, folderCtx);
  const [bmDragId, setBmDragId] = useState<string | null>(null);
  const [bmDropId, setBmDropId] = useState<string | null>(null);
  const [editingBookmark, setEditingBookmark] = useState<{ id: string; title: string; url: string } | null>(null);
  const editBmTitleRef = useRef<HTMLInputElement>(null);
  const [bmDragType, setBmDragType] = useState<"bookmark" | "folder" | null>(null);
  const bmListRef = useRef<HTMLDivElement>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState("");
  const renameFolderRef = useRef<HTMLInputElement>(null);
  const [mediaDismissed, setMediaDismissed] = useState(false);
  const [panelDragIdx, setPanelDragIdx] = useState<number | null>(null);
  const [panelDropIdx, setPanelDropIdx] = useState<number | null>(null);
  const prevPlayingTabId = useRef<string | undefined>(undefined);

  // Reset dismiss when a different tab starts playing
  useEffect(() => {
    if (playingTab?.id !== prevPlayingTabId.current) {
      prevPlayingTabId.current = playingTab?.id;
      setMediaDismissed(false);
    }
  }, [playingTab?.id]);

  const [panelPickerOpen, setPanelPickerOpen] = useState(false);
  const [panelCustomUrl, setPanelCustomUrl] = useState("");
  const panelPickerRef = useRef<HTMLDivElement>(null);
  const [syncedTabsOpen, setSyncedTabsOpen] = useState(false);
  const [syncedTabs, setSyncedTabs] = useState<{ device_id: string; device_name?: string; tabs: SyncTab[]; timestamp: number }[]>([]);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameTabValue, setRenameTabValue] = useState("");
  const renameTabRef = useRef<HTMLInputElement>(null);
  const [wsDragIdx, setWsDragIdx] = useState<number | null>(null);
  const [wsDropIdx, setWsDropIdx] = useState<number | null>(null);
  const wsScrollCooldown = useRef(false);

  // url bar state (absorbed from Toolbar)
  const [urlInput, setUrlInput] = useState(url);
  const [urlFocused, setUrlFocused] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [extPanelOpen, setExtPanelOpen] = useState(false);
  const extPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!urlFocused) setUrlInput(url);
  }, [url, urlFocused]);

  // poll synced tabs from other devices
  useEffect(() => {
    if (!syncEnabled) return;
    const fetch = () => {
      invoke<string>("sync_get_all_tabs").then(json => {
        try {
          const raw = JSON.parse(json) as { device_id: string; tabs: string; timestamp: number }[];
          setSyncedTabs(raw.map(d => ({
            device_id: d.device_id,
            device_name: pairedDevices?.find(p => p.device_id === d.device_id)?.name,
            tabs: (() => { try { return JSON.parse(d.tabs) as SyncTab[]; } catch { return []; } })(),
            timestamp: d.timestamp,
          })));
        } catch {}
      }).catch(e => console.warn("[bushido]", e));
    };
    fetch();
    const iv = setInterval(fetch, 10000);
    const unlisten = listen("sync-tabs-changed", fetch);
    return () => { clearInterval(iv); unlisten.then(u => u()); };
  }, [syncEnabled, pairedDevices]);

  // close extensions panel on click outside
  useEffect(() => {
    if (!extPanelOpen) return;
    const handler = (e: MouseEvent) => {
      if (extPanelRef.current && !extPanelRef.current.contains(e.target as Node)) {
        setExtPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [extPanelOpen]);

  // close panel picker on click outside
  useEffect(() => {
    if (!panelPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelPickerRef.current && !panelPickerRef.current.contains(e.target as Node)) {
        setPanelPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [panelPickerOpen]);

  // Quick actions matching
  const isCommandMode = urlInput.startsWith(">");
  const actionQuery = isCommandMode ? urlInput.slice(1) : urlInput;
  const quickActions = useMemo(() => {
    if (!urlFocused || !actionQuery.trim()) return [];
    return matchQuickActions(actionQuery);
  }, [urlFocused, actionQuery]);

  // Total selectable items = suggestions + quick actions
  const totalItems = suggestions.length + quickActions.length;

  useEffect(() => {
    setSelectedIdx(-1);
  }, [suggestions, quickActions.length]);

  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setUrlInput(e.target.value);
    onInputChange(e.target.value);
  }, [onInputChange]);

  const executeQuickAction = useCallback((qa: QuickAction) => {
    bumpActionScore(qa.id);
    onQuickAction?.(qa.action);
    inputRef.current?.blur();
  }, [onQuickAction, inputRef]);

  const handleUrlSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIdx >= 0 && selectedIdx < suggestions.length) {
      onSuggestionSelect(suggestions[selectedIdx].url);
      inputRef.current?.blur();
      return;
    }
    if (selectedIdx >= suggestions.length && selectedIdx < totalItems) {
      const qa = quickActions[selectedIdx - suggestions.length];
      if (qa) { executeQuickAction(qa); return; }
    }
    // If in command mode and there are actions, execute the top one
    if (isCommandMode && quickActions.length > 0) {
      executeQuickAction(quickActions[0]);
      return;
    }
    if (urlInput.trim()) {
      onNavigate(urlInput.trim());
      inputRef.current?.blur();
    }
  }, [urlInput, onNavigate, inputRef, selectedIdx, suggestions, onSuggestionSelect, totalItems, quickActions, isCommandMode, executeQuickAction]);

  const handleUrlKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!urlFocused || totalItems === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(p => Math.min(p + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(p => Math.max(p - 1, -1));
    }
  }, [urlFocused, totalItems]);

  const displayUrl = useMemo(() => {
    if (urlFocused) return urlInput;
    try {
      const u = new URL(urlInput);
      if (showDomainOnly) return u.hostname;
      return u.hostname + (u.pathname !== "/" ? u.pathname : "");
    } catch { return urlInput; }
  }, [urlFocused, urlInput, showDomainOnly]);

  // memoize tree building + filtering — URL bar input filters tabs when focused
  const tabFilter = urlFocused ? urlInput : "";
  const { filteredPinned, flatTabs } = useMemo(() => {
    const q = tabFilter.toLowerCase();
    const fp = tabFilter ? pinnedTabs.filter(t => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q)) : pinnedTabs;
    const ft = tabFilter ? tabs.filter(t => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q)) : tabs;
    const tree = buildTree(ft);
    const flat = flattenTree(tree);
    return { filteredPinned: fp, flatTabs: flat };
  }, [tabs, pinnedTabs, tabFilter]);

  // tab list virtualization — only re-render when visible window shifts
  const TAB_HEIGHT = 36;
  const visibleCount = Math.ceil((listRef.current?.clientHeight || 400) / TAB_HEIGHT) + 4;
  const endIdx = Math.min(startIdx + visibleCount, flatTabs.length);
  const visibleTabs = flatTabs.slice(startIdx, endIdx);
  const topPad = startIdx * TAB_HEIGHT;
  const bottomPad = Math.max(0, (flatTabs.length - endIdx) * TAB_HEIGHT);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const idx = Math.floor(e.currentTarget.scrollTop / TAB_HEIGHT);
    setStartIdx(prev => prev !== idx ? idx : prev);
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (!compact) return;
    if (peekTimer.current) { clearTimeout(peekTimer.current); peekTimer.current = null; }
    setPeeking(true);
  }, [compact]);

  const handleMouseLeave = useCallback(() => {
    if (!compact) return;
    peekTimer.current = setTimeout(() => {
      setPeeking(false);
    }, 800);
  }, [compact]);

  useEffect(() => {
    return () => { if (peekTimer.current) clearTimeout(peekTimer.current); };
  }, []);

  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const wsCtxMenuRef = useRef<HTMLDivElement>(null);
  const ctxPos = useClampedMenu(ctxMenuRef, ctx);
  const wsCtxPos = useClampedMenu(wsCtxMenuRef, wsCtx);

  // focus rename input when it appears
  useEffect(() => {
    if (renaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (renamingFolder && renameFolderRef.current) {
      renameFolderRef.current.focus();
      renameFolderRef.current.select();
    }
  }, [renamingFolder]);

  useEffect(() => {
    if (renamingTabId && renameTabRef.current) {
      renameTabRef.current.focus();
      renameTabRef.current.select();
    }
  }, [renamingTabId]);

  const toggleFolderExpand = useCallback((folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const handlePanelPreset = useCallback((url: string) => {
    onAddPanel(url);
    setPanelPickerOpen(false);
    setPanelCustomUrl("");
  }, [onAddPanel]);

  const handlePanelCustomSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (panelCustomUrl.trim()) {
      onAddPanel(panelCustomUrl.trim());
      setPanelPickerOpen(false);
      setPanelCustomUrl("");
    }
  }, [panelCustomUrl, onAddPanel]);

  const handleCtx = useCallback((e: React.MouseEvent, tabId: string, pinned: boolean) => {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, tabId, pinned });
  }, []);

  const closeCtx = useCallback(() => setCtx(null), []);
  const closeWsCtx = useCallback(() => setWsCtx(null), []);

  const handleWsCtx = useCallback((e: React.MouseEvent, wsId: string) => {
    e.preventDefault();
    setWsCtx({ x: e.clientX, y: e.clientY, wsId });
  }, []);

  const startRename = useCallback((wsId: string) => {
    const ws = workspaces.find(w => w.id === wsId);
    setRenameValue(ws?.name || "");
    setRenaming(wsId);
    closeWsCtx();
  }, [workspaces, closeWsCtx]);

  const commitRename = useCallback(() => {
    if (renaming && renameValue.trim()) {
      onRenameWorkspace(renaming, renameValue.trim());
    }
    setRenaming(null);
  }, [renaming, renameValue, onRenameWorkspace]);

  const renderTab = (tab: Tab, isPinned: boolean, idx?: number, depth = 0, childCount = 0) => (
    <div
      key={tab.id}
      className={`tab-item ${tab.id === activeTab ? "active" : ""} ${paneTabIds.includes(tab.id) ? "split-active" : ""} ${isPinned ? "pinned" : ""} ${tab.suspended || tab.memoryState === "suspended" || tab.memoryState === "destroyed" ? "tab-suspended" : ""} ${tab.crashed ? "tab-crashed" : ""} ${dragIdx === idx ? "dragging" : ""} ${dropIdx === idx ? "drop-target" : ""}`}
      style={!isPinned && depth > 0 ? { paddingLeft: `${10 + depth * 16}px` } : undefined}
      onClick={() => onSelect(tab.id)}
      onContextMenu={e => handleCtx(e, tab.id, isPinned)}
      onMouseDown={e => {
        if (isPinned || idx === undefined || e.button !== 0) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const fromIdx = idx;
        let mode: "none" | "reorder" | "split" = "none";
        let currentDropIdx = -1;

        const onMove = (me: MouseEvent) => {
          const dx = me.clientX - startX;
          const dy = me.clientY - startY;
          if (mode === "none" && dx * dx + dy * dy < 25) return; // 5px threshold

          if (mode === "none") {
            if (Math.abs(dx) > Math.abs(dy) && dx > 0) {
              mode = "split";
              setDragIdx(fromIdx);
              onTabSplitDrag?.(tab.id);
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
              return;
            } else {
              mode = "reorder";
              setDragIdx(fromIdx);
            }
          }

          if (mode === "reorder") {
            const els = listRef.current?.querySelectorAll(".tab-item");
            if (els) {
              for (let i = 0; i < els.length; i++) {
                const r = els[i].getBoundingClientRect();
                if (me.clientY >= r.top && me.clientY < r.bottom) {
                  currentDropIdx = i;
                  setDropIdx(i);
                  break;
                }
              }
            }
          }
        };

        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          if (mode === "reorder" && currentDropIdx >= 0 && fromIdx !== currentDropIdx) {
            onReorder(fromIdx, currentDropIdx);
          }
          setDragIdx(null);
          setDropIdx(null);
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      }}
    >
      {!isPinned && childCount > 0 && (
        <button
          className="tab-collapse-btn"
          onClick={e => { e.stopPropagation(); onToggleCollapse(tab.id); }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            {tab.collapsed
              ? <path d="M3 1L8 5L3 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              : <path d="M1 3L5 8L9 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            }
          </svg>
        </button>
      )}
      <div className="tab-info">
        {tab.crashed ? (
          <div className="tab-crash-badge">!</div>
        ) : (tab.suspended || tab.memoryState === "suspended" || tab.memoryState === "destroyed") ? (
          <div className="tab-zzz">zzz</div>
        ) : tab.loading ? (
          <div className="tab-spinner" />
        ) : (
          <div className="tab-favicon">
            {tab.favicon
              ? <img src={tab.favicon} alt="" width={14} height={14} />
              : <span className="tab-favicon-placeholder">{(tab.title || tab.url || '?')[0]}</span>
            }
          </div>
        )}
        {!isPinned && (
          renamingTabId === tab.id ? (
            <input
              ref={renameTabRef}
              className="tab-rename-input"
              value={renameTabValue}
              onChange={e => setRenameTabValue(e.target.value)}
              onBlur={() => { onRenameTab(tab.id, renameTabValue.trim()); setRenamingTabId(null); }}
              onKeyDown={e => {
                if (e.key === "Enter") { onRenameTab(tab.id, renameTabValue.trim()); setRenamingTabId(null); }
                if (e.key === "Escape") setRenamingTabId(null);
              }}
              onClick={e => e.stopPropagation()}
              spellCheck={false}
            />
          ) : (
            <span className="tab-title">{tab.customTitle || tab.title}</span>
          )
        )}
      </div>
      {tab.mediaState === "playing" && (
        <svg className="tab-audio-icon" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, opacity: 0.5 }}>
          <path d="M8 1.5a.5.5 0 0 0-.5.5v12a.5.5 0 0 0 1 0V2a.5.5 0 0 0-.5-.5zM5 4.5a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5zM11 4.5a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5zM2 6.5a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 1 0V7a.5.5 0 0 0-.5-.5zM14 6.5a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 1 0V7a.5.5 0 0 0-.5-.5z"/>
        </svg>
      )}
      {!isPinned && (
        <button
          className="tab-close"
          onClick={e => { e.stopPropagation(); onClose(tab.id); }}
        >
          ×
        </button>
      )}
    </div>
  );

  return (
    <>
      <div
        className={`sidebar ${open ? "" : "collapsed"} ${compact ? "compact" : ""} ${peeking ? "peeking" : ""}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {!open && !compact && (
          <div className="sidebar-collapsed-logo">
            <img src={logoSrc} alt="Bushido" width={22} height={22} />
            <button className="sidebar-toggle" onClick={onToggle}>›</button>
          </div>
        )}
        {(open || compact) && (
          <>
            {/* top row: logo left, star + shield right */}
            <div className="sidebar-header-row">
              <button className="settings-btn" onClick={onOpenSettings} title="Settings">
                <GearIcon />
              </button>
              <div className="nav-right">
                <div
                  className={`bookmark-btn ${isBookmarked ? "bookmarked" : ""}`}
                  onClick={onToggleBookmark}
                  title={isBookmarked ? "Remove bookmark (Ctrl+D)" : "Bookmark this page (Ctrl+D)"}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 2L9.8 5.6L14 6.2L11 9.1L11.7 13.2L8 11.3L4.3 13.2L5 9.1L2 6.2L6.2 5.6L8 2Z"
                          stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
                          fill={isBookmarked ? "var(--accent)" : "none"} />
                  </svg>
                </div>
                <div
                  className={`shield-badge ${whitelisted ? "shield-off" : ""}`}
                  title={whitelisted ? "shields down (click to enable)" : `${blockedCount} tracker${blockedCount !== 1 ? 's' : ''} blocked (click to disable for this site)`}
                  onClick={onToggleWhitelist}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1L2 4V7.5C2 11.1 4.5 14.4 8 15.2C11.5 14.4 14 11.1 14 7.5V4L8 1Z"
                          stroke={whitelisted ? "var(--text-dim)" : blockedCount > 0 ? "var(--success)" : "var(--text-dim)"}
                          strokeWidth="1.3" strokeLinejoin="round" fill="none"/>
                    {whitelisted ? (
                      <path d="M5 5.5L11 10.5M11 5.5L5 10.5" stroke="var(--text-dim)" strokeWidth="1.2" strokeLinecap="round"/>
                    ) : blockedCount > 0 ? (
                      <path d="M5.5 8L7 9.5L10.5 6" stroke="var(--success)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    ) : null}
                  </svg>
                  {!whitelisted && blockedCount > 0 && (
                    <span className="shield-count">{blockedCount > 99 ? '99+' : blockedCount}</span>
                  )}
                </div>
              </div>
            </div>

            {/* nav buttons — ghost style, reload pushed right */}
            <div className="sidebar-nav-row">
              <button className="nav-btn" onClick={onBack} title="Back (Alt+←)">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button className="nav-btn" onClick={onForward} title="Forward (Alt+→)">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button className="nav-btn" onClick={onReload} title="Reload (Ctrl+R)">
                {loading ? (
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                    <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                    <path d="M13 8A5 5 0 1 1 8 3M13 3V8H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            </div>

            {/* url bar with search icon */}
            <form className="sidebar-url-form" onSubmit={handleUrlSubmit}>
              <div className={`sidebar-url-bar ${urlFocused ? "focused" : ""}`}>
                <svg className="url-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <input
                  ref={inputRef}
                  className="url-input"
                  value={urlFocused ? urlInput : displayUrl}
                  onChange={handleUrlChange}
                  onFocus={(e) => { setUrlFocused(true); setUrlInput(url); onInputChange(""); e.target.select(); }}
                  onBlur={() => { setUrlFocused(false); onInputChange(""); }}
                  onKeyDown={handleUrlKeyDown}
                  placeholder="search or enter url"
                  spellCheck={false}
                />
                {!urlFocused && zoomLevel != null && Math.round(zoomLevel * 100) !== 100 && (
                  <button
                    className="zoom-badge"
                    onClick={(e) => { e.preventDefault(); onZoomReset?.(); }}
                    title="Reset zoom to 100%"
                    type="button"
                  >
                    {Math.round(zoomLevel * 100)}%
                  </button>
                )}
                {!urlFocused && (
                  <button
                    className={`ext-trigger ${extPanelOpen ? "open" : ""}`}
                    onClick={(e) => { e.preventDefault(); setExtPanelOpen(p => !p); }}
                    title="Extensions & quick actions"
                    type="button"
                  >
                    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M10.75 9.5V13M5.25 11.25H8.25M10.75 11.25H12.75M7.25 5V8.5M5.25 6.75H7.25M9.75 6.75H12.75M5.25 3H13.75C14.858 3 15.75 3.892 15.75 5V13.5C15.75 14.608 14.858 15.5 13.75 15.5H5.25C4.142 15.5 3.25 14.608 3.25 13.5V5C3.25 3.892 4.142 3 5.25 3Z"/>
                    </svg>
                  </button>
                )}
              </div>
              {/* Extensions panel */}
              {extPanelOpen && (
                <div className="ext-panel" ref={extPanelRef}>
                  {/* Quick actions header */}
                  <div className="ext-header">
                    <button className="ext-action-btn" onClick={onToggleBookmark} title="Bookmark">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M4 2H12V14L8 11L4 14V2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill={isBookmarked ? "currentColor" : "none"}/>
                      </svg>
                    </button>
                    <button className="ext-action-btn" onClick={onScreenshot} title="Screenshot">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <rect x="1.5" y="3.5" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                        <circle cx="8" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
                        <path d="M5.5 3.5V2.5H10.5V3.5" stroke="currentColor" strokeWidth="1.3"/>
                      </svg>
                    </button>
                    <button className={`ext-action-btn ${isReaderActive ? "ext-active" : ""}`} onClick={onToggleReader} title="Reader mode (Ctrl+Shift+R)">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M2 3H6C7.1 3 8 3.9 8 5V14C8 13 7 12 6 12H2V3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                        <path d="M14 3H10C8.9 3 8 3.9 8 5V14C8 13 9 12 10 12H14V3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    {hasVideo && (
                      <button className={`ext-action-btn ${pipActive ? "ext-active" : ""}`} onClick={onTogglePip} title="Picture in Picture">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <rect x="1" y="2.5" width="14" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                          <rect x="8" y="7" width="6" height="5" rx="1" fill="currentColor" opacity="0.3" stroke="currentColor" strokeWidth="1"/>
                        </svg>
                      </button>
                    )}
                    <button className="ext-action-btn" onClick={onShareUrl} title="Share">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M8 2V10M8 2L5 5M8 2L11 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M3 9V13H13V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </div>

                  {/* Built-in protections */}
                  <div className="ext-section">
                    <div className="ext-section-header">
                      <span className="ext-section-label">Protections</span>
                    </div>
                    <div className="ext-grid">
                      <button
                        className={`ext-tile ${!whitelisted && blockedCount > 0 ? "active" : ""}`}
                        onClick={onToggleWhitelist}
                        title={whitelisted ? "Shields down" : `${blockedCount} blocked`}
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <path d="M8 1L2 4V7.5C2 11.1 4.5 14.4 8 15.2C11.5 14.4 14 11.1 14 7.5V4L8 1Z"
                                stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                          {!whitelisted && blockedCount > 0 && (
                            <path d="M5.5 8L7 9.5L10.5 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                          )}
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Reader settings (shown when reader is active) */}
                  {isReaderActive && (
                    <div className="reader-settings">
                      <div className="reader-settings-row">
                        <button className="reader-size-btn" onClick={() => onUpdateReaderSettings({ fontSize: Math.max(12, readerSettings.fontSize - 2) })}>A-</button>
                        <span className="reader-size-label">{readerSettings.fontSize}px</span>
                        <button className="reader-size-btn" onClick={() => onUpdateReaderSettings({ fontSize: Math.min(28, readerSettings.fontSize + 2) })}>A+</button>
                        <button className={`reader-font-btn ${readerSettings.font === "serif" ? "active" : ""}`} onClick={() => onUpdateReaderSettings({ font: "serif" })}>Serif</button>
                        <button className={`reader-font-btn ${readerSettings.font === "sans" ? "active" : ""}`} onClick={() => onUpdateReaderSettings({ font: "sans" })}>Sans</button>
                      </div>
                      <div className="reader-settings-row">
                        <button className={`reader-theme-dot ${readerSettings.theme === "dark" ? "active" : ""}`} style={{ background: "#09090b" }} onClick={() => onUpdateReaderSettings({ theme: "dark" })} />
                        <button className={`reader-theme-dot ${readerSettings.theme === "light" ? "active" : ""}`} style={{ background: "#fafafa" }} onClick={() => onUpdateReaderSettings({ theme: "light" })} />
                        <button className={`reader-theme-dot ${readerSettings.theme === "sepia" ? "active" : ""}`} style={{ background: "#f4ecd8" }} onClick={() => onUpdateReaderSettings({ theme: "sepia" })} />
                      </div>
                    </div>
                  )}

                  {/* Footer */}
                  <div className="ext-footer">
                    <div className="ext-security">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <rect x="3" y="6" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                        <path d="M5 6V4.5a2 2 0 1 1 4 0V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      </svg>
                      <span>{(() => { try { return new URL(url).hostname; } catch { return "secure"; } })()}</span>
                    </div>
                  </div>
                </div>
              )}
              {loading && <div className="url-progress" />}
              {/* Top sites grid — shows on focus with no typed query */}
              {urlFocused && suggestions.length === 0 && quickActions.length === 0 && topSites.length > 0 && (
                <div className="url-topsites">
                  {topSites.map(s => {
                    let domain = "";
                    try { domain = new URL(s.url).hostname.replace("www.", ""); } catch { domain = s.title; }
                    return (
                      <div
                        key={s.url}
                        className="topsite-tile"
                        onMouseDown={(e) => { e.preventDefault(); onSuggestionSelect(s.url); }}
                      >
                        <div className="topsite-icon">
                          {s.favicon
                            ? <img src={s.favicon} alt="" width={28} height={28} />
                            : <span className="topsite-placeholder">{domain.charAt(0).toUpperCase()}</span>
                          }
                        </div>
                        <span className="topsite-label">{domain || s.title}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Typed suggestions + quick actions */}
              {urlFocused && totalItems > 0 && (
                <div className="url-suggestions">
                  {!isCommandMode && suggestions.map((s, i) => (
                    <div
                      key={s.url}
                      className={`suggestion-item ${i === selectedIdx ? "selected" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); onSuggestionSelect(s.url); }}
                    >
                      <div className="suggestion-favicon">
                        {s.favicon ? <img src={s.favicon} alt="" width={14} height={14} /> : <span className="tab-favicon-placeholder">{(s.title || s.url || '?')[0]}</span>}
                      </div>
                      <div className="suggestion-text">
                        <span className="suggestion-title">{s.title || s.url}</span>
                        <span className="suggestion-url">{s.url}</span>
                      </div>
                      <span className="suggestion-type">{s.type === 'bookmark' ? '\u2605' : '\u25F7'}</span>
                    </div>
                  ))}
                  {quickActions.map((qa, i) => {
                    const idx = isCommandMode ? i : suggestions.length + i;
                    return (
                      <div
                        key={qa.id}
                        className={`suggestion-item suggestion-action ${idx === selectedIdx ? "selected" : ""}`}
                        onMouseDown={(e) => { e.preventDefault(); executeQuickAction(qa); }}
                      >
                        <div className="suggestion-favicon action-icon">{"\u26A1"}</div>
                        <div className="suggestion-text">
                          <span className="suggestion-title">{qa.label}</span>
                        </div>
                        {qa.shortcut && <span className="suggestion-shortcut">{qa.shortcut}</span>}
                        <span className="suggestion-type">action</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </form>

            {/* workspace switcher */}
            <div className="workspace-switcher" onWheel={e => {
              if (wsScrollCooldown.current || workspaces.length <= 1) return;
              wsScrollCooldown.current = true;
              setTimeout(() => { wsScrollCooldown.current = false; }, 200);
              const curIdx = workspaces.findIndex(w => w.id === activeWorkspaceId);
              const nextIdx = e.deltaY > 0
                ? Math.min(curIdx + 1, workspaces.length - 1)
                : Math.max(curIdx - 1, 0);
              if (nextIdx !== curIdx) onSwitchWorkspace(workspaces[nextIdx].id);
            }}>
              {workspaces.map((ws, i) => (
                <button
                  key={ws.id}
                  className={`ws-dot ${ws.id === activeWorkspaceId ? "active" : ""} ${wsDropTarget === ws.id ? "ws-drop-target" : ""} ${wsDragIdx === i ? "ws-dragging" : ""} ${wsDropIdx === i ? "ws-reorder-target" : ""}`}
                  style={{ "--ws-color": ws.color } as React.CSSProperties}
                  onClick={() => onSwitchWorkspace(ws.id)}
                  onContextMenu={e => handleWsCtx(e, ws.id)}
                  title={`${ws.name} (Ctrl+${i + 1})`}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                  onDragEnter={() => setWsDropTarget(ws.id)}
                  onDragLeave={() => { if (wsDropTarget === ws.id) setWsDropTarget(null); }}
                  onDrop={e => {
                    e.preventDefault();
                    const tabId = e.dataTransfer.getData("text/plain");
                    if (tabId && ws.id !== activeWorkspaceId) {
                      onMoveTabToWorkspace(tabId, ws.id);
                    }
                    setWsDropTarget(null);
                  }}
                  onMouseDown={e => {
                    if (e.button !== 0 || renaming === ws.id) return;
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const fromIdx = i;
                    let dragging = false;
                    let currentDrop = -1;
                    const onMove = (me: MouseEvent) => {
                      const dx = me.clientX - startX;
                      const dy = me.clientY - startY;
                      if (!dragging && dx * dx + dy * dy < 25) return;
                      if (!dragging) { dragging = true; setWsDragIdx(fromIdx); }
                      const container = (e.target as HTMLElement).closest(".workspace-switcher");
                      if (container) {
                        const dots = container.querySelectorAll(".ws-dot:not(.ws-add)");
                        for (let di = 0; di < dots.length; di++) {
                          const r = dots[di].getBoundingClientRect();
                          if (me.clientX >= r.left && me.clientX < r.right) {
                            currentDrop = di;
                            setWsDropIdx(di);
                            break;
                          }
                        }
                      }
                    };
                    const onUp = () => {
                      document.removeEventListener("mousemove", onMove);
                      document.removeEventListener("mouseup", onUp);
                      if (dragging && currentDrop >= 0 && currentDrop !== fromIdx) {
                        onReorderWorkspaces(fromIdx, currentDrop);
                      }
                      setWsDragIdx(null);
                      setWsDropIdx(null);
                    };
                    document.addEventListener("mousemove", onMove);
                    document.addEventListener("mouseup", onUp);
                  }}
                >
                  {renaming === ws.id ? (
                    <input
                      ref={renameRef}
                      className="ws-rename-input"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : ws.icon ? (
                    <span className="ws-dot-emoji">{ws.icon}</span>
                  ) : (
                    ws.name.charAt(0).toUpperCase()
                  )}
                </button>
              ))}
              <button
                className="ws-dot ws-add"
                onClick={onAddWorkspace}
                title="New workspace"
              >
                +
              </button>
            </div>

            <div className="panel-icons">
              {panels.map((p, i) => (
                <button
                  key={p.id}
                  className={`panel-icon${activePanelId === p.id ? " active" : ""}${panelDragIdx === i ? " dragging" : ""}`}
                  style={{
                    opacity: panelDragIdx === i ? 0.6 : 1,
                    ...(panelDropIdx !== null && panelDragIdx !== null && panelDropIdx === i && panelDragIdx !== i
                      ? { [panelDragIdx < panelDropIdx ? 'marginBottom' : 'marginTop']: 24 }
                      : {}),
                    transition: panelDragIdx !== null ? 'margin 0.15s' : undefined,
                  }}
                  onClick={() => onTogglePanel(p.id)}
                  onContextMenu={e => { e.preventDefault(); onRemovePanel(p.id); }}
                  title={p.title}
                  draggable
                  onDragStart={e => {
                    setPanelDragIdx(i);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={e => {
                    e.preventDefault();
                    if (panelDragIdx !== null && panelDragIdx !== i) setPanelDropIdx(i);
                  }}
                  onDragEnd={() => {
                    if (panelDragIdx !== null && panelDropIdx !== null && panelDragIdx !== panelDropIdx) {
                      const next = [...panels];
                      const [moved] = next.splice(panelDragIdx, 1);
                      next.splice(panelDropIdx, 0, moved);
                      onReorderPanels(next);
                    }
                    setPanelDragIdx(null);
                    setPanelDropIdx(null);
                  }}
                  onDragLeave={() => setPanelDropIdx(null)}
                >
                  {p.favicon ? <img src={p.favicon} alt="" width={18} height={18} /> : <span className="panel-icon-fallback">{(p.title || "?")[0]}</span>}
                </button>
              ))}
              <div className="panel-picker-wrap" ref={panelPickerRef}>
                <button className="panel-icon add" onClick={() => setPanelPickerOpen(p => !p)} title="Add web panel">
                  <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>
                {panelPickerOpen && (
                  <div className="panel-picker">
                    <div className="panel-picker-label">add panel</div>
                    <div className="panel-picker-presets">
                      {PANEL_PRESETS.map(p => (
                        <button key={p.url} className="panel-picker-item" onClick={() => handlePanelPreset(p.url)}>
                          <img src={p.favicon} alt="" width={16} height={16} />
                          <span>{p.name}</span>
                        </button>
                      ))}
                    </div>
                    <form className="panel-picker-custom" onSubmit={handlePanelCustomSubmit}>
                      <input
                        className="panel-picker-input"
                        value={panelCustomUrl}
                        onChange={e => setPanelCustomUrl(e.target.value)}
                        placeholder="enter url..."
                        spellCheck={false}
                        autoFocus
                      />
                    </form>
                  </div>
                )}
              </div>
            </div>

            {filteredPinned.length > 0 && (
              <div className="pinned-section">
                <div className="pinned-grid">
                  {filteredPinned.map(t => renderTab(t, true))}
                </div>
              </div>
            )}

            <div className="bookmark-section">
              <div className="section-label section-label-clickable" onClick={() => setBookmarksExpanded(p => !p)}>
                <span>bookmarks</span>
              </div>
              {bookmarksExpanded && (
                <div className="bookmark-list">
                  {bookmarks.length === 0 && bookmarkFolders.length === 0 ? (
                    <div className="bm-empty" onClick={onToggleBookmark}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M8 2L9.8 5.6L14 6.2L11 9.1L11.7 13.2L8 11.3L4.3 13.2L5 9.1L2 6.2L6.2 5.6L8 2Z"
                              stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
                      </svg>
                      <span>Press Ctrl+D to bookmark a page</span>
                    </div>
                  ) : (
                    <div ref={bmListRef}>
                      {/* Folders */}
                      {[...bookmarkFolders].sort((a, b) => a.order - b.order).map(folder => {
                        const folderBookmarks = bookmarks.filter(b => b.folderId === folder.id).sort((a, b) => a.order - b.order);
                        const isExpanded = expandedFolders.has(folder.id);
                        return (
                          <div key={folder.id}>
                            <div
                              className={`bm-folder-row ${bmDragId === folder.id && bmDragType === "folder" ? "bm-dragging" : ""} ${bmDropId === folder.id ? "bm-drop-target" : ""}`}
                              data-bm-folder={folder.id}
                              onClick={() => toggleFolderExpand(folder.id)}
                              onContextMenu={e => { e.preventDefault(); setFolderCtx({ x: e.clientX, y: e.clientY, folderId: folder.id }); }}
                              onMouseDown={e => {
                                if (e.button !== 0 || renamingFolder === folder.id) return;
                                const startY = e.clientY;
                                let dragging = false;
                                let currentDrop: string | null = null;
                                const onMove = (me: MouseEvent) => {
                                  if (!dragging && Math.abs(me.clientY - startY) < 5) return;
                                  if (!dragging) { dragging = true; setBmDragId(folder.id); setBmDragType("folder"); }
                                  const els = bmListRef.current?.querySelectorAll("[data-bm-folder]");
                                  let found: string | null = null;
                                  if (els) for (let i = 0; i < els.length; i++) {
                                    const r = els[i].getBoundingClientRect();
                                    if (me.clientY >= r.top && me.clientY < r.bottom && els[i].getAttribute("data-bm-folder") !== folder.id) {
                                      found = els[i].getAttribute("data-bm-folder"); break;
                                    }
                                  }
                                  currentDrop = found;
                                  setBmDropId(found);
                                };
                                const onUp = (me: MouseEvent) => {
                                  document.removeEventListener("mousemove", onMove);
                                  document.removeEventListener("mouseup", onUp);
                                  if (dragging && currentDrop) {
                                    const targetEl = bmListRef.current?.querySelector(`[data-bm-folder="${currentDrop}"]`);
                                    if (targetEl) {
                                      const r = targetEl.getBoundingClientRect();
                                      const pos = me.clientY < r.top + r.height / 2 ? "before" : "after";
                                      onReorderFolders(folder.id, currentDrop, pos);
                                    }
                                  }
                                  setBmDragId(null); setBmDropId(null); setBmDragType(null);
                                };
                                document.addEventListener("mousemove", onMove);
                                document.addEventListener("mouseup", onUp);
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 150ms ease" }}>
                                <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <path d="M2 3h3.5l1.5 1.5H12v7H2V3z" stroke="var(--text-dim)" strokeWidth="1.2" fill={isExpanded ? "var(--accent-soft)" : "none"}/>
                              </svg>
                              {renamingFolder === folder.id ? (
                                <input
                                  ref={renameFolderRef}
                                  className="bm-folder-rename"
                                  value={renameFolderValue}
                                  onChange={e => setRenameFolderValue(e.target.value)}
                                  onBlur={() => { if (renameFolderValue.trim()) onRenameBookmarkFolder(folder.id, renameFolderValue.trim()); setRenamingFolder(null); }}
                                  onKeyDown={e => { if (e.key === "Enter") { if (renameFolderValue.trim()) onRenameBookmarkFolder(folder.id, renameFolderValue.trim()); setRenamingFolder(null); } if (e.key === "Escape") setRenamingFolder(null); }}
                                  onClick={e => e.stopPropagation()}
                                  spellCheck={false}
                                />
                              ) : (
                                <span className="bm-folder-name">{folder.name}</span>
                              )}
                              {folder.rssUrl && <span className="bm-rss-icon" title="Live Folder (RSS)">&#128225;</span>}
                              <span className="bm-folder-count">{folderBookmarks.length + (folder.autoItems?.length || 0)}</span>
                            </div>
                            {isExpanded && folderBookmarks.map(b => (
                              <div
                                key={b.id}
                                className={`bookmark-item bm-indented ${bmDragId === b.id ? "bm-dragging" : ""} ${bmDropId === b.id ? "bm-drop-target" : ""}`}
                                data-bm-id={b.id}
                                onClick={() => onSelectBookmark(b.url)}
                                onContextMenu={e => { e.preventDefault(); setBmCtx({ x: e.clientX, y: e.clientY, id: b.id }); }}
                                onMouseDown={e => {
                                  if (e.button !== 0) return;
                                  e.stopPropagation();
                                  const startY = e.clientY;
                                  let dragging = false;
                                  let currentDrop: string | null = null;
                                  const onMove = (me: MouseEvent) => {
                                    if (!dragging && Math.abs(me.clientY - startY) < 5) return;
                                    if (!dragging) { dragging = true; setBmDragId(b.id); setBmDragType("bookmark"); }
                                    const els = bmListRef.current?.querySelectorAll("[data-bm-id], [data-bm-folder]");
                                    let found: string | null = null;
                                    if (els) for (let i = 0; i < els.length; i++) {
                                      const r = els[i].getBoundingClientRect();
                                      if (me.clientY >= r.top && me.clientY < r.bottom) {
                                        const id = els[i].getAttribute("data-bm-id") || els[i].getAttribute("data-bm-folder");
                                        if (id && id !== b.id) { found = id; break; }
                                      }
                                    }
                                    currentDrop = found;
                                    setBmDropId(found);
                                  };
                                  const onUp = (me: MouseEvent) => {
                                    document.removeEventListener("mousemove", onMove);
                                    document.removeEventListener("mouseup", onUp);
                                    if (dragging && currentDrop) {
                                      const isFolder = bookmarkFolders.some(f => f.id === currentDrop);
                                      if (isFolder) {
                                        onMoveBookmarkToFolder(b.id, currentDrop!);
                                      } else {
                                        const targetEl = bmListRef.current?.querySelector(`[data-bm-id="${currentDrop}"]`);
                                        if (targetEl) {
                                          const r = targetEl.getBoundingClientRect();
                                          const pos = me.clientY < r.top + r.height / 2 ? "before" : "after";
                                          onReorderBookmarks(b.id, currentDrop!, pos);
                                        }
                                      }
                                    }
                                    setBmDragId(null); setBmDropId(null); setBmDragType(null);
                                  };
                                  document.addEventListener("mousemove", onMove);
                                  document.addEventListener("mouseup", onUp);
                                }}
                              >
                                <div className="tab-favicon">
                                  {b.favicon ? <img src={b.favicon} alt="" width={14} height={14} /> : <span className="tab-favicon-placeholder">{(b.title || b.url || '?')[0]}</span>}
                                </div>
                                <span className="tab-title">{b.title || b.url}</span>
                              </div>
                            ))}
                            {/* RSS auto-items */}
                            {isExpanded && folder.autoItems && folder.autoItems.length > 0 && (
                              <>
                                {folderBookmarks.length > 0 && <div className="bm-rss-separator" />}
                                {folder.autoItems.map(item => (
                                  <div
                                    key={item.id}
                                    className="bookmark-item bm-indented bm-rss-item"
                                    onClick={() => onSelectBookmark(item.url)}
                                    title={item.url}
                                  >
                                    <span className="bm-rss-dot" />
                                    <span className="tab-title">{item.title}</span>
                                  </div>
                                ))}
                              </>
                            )}
                          </div>
                        );
                      })}
                      {/* Unfiled bookmarks (no folder) */}
                      {bookmarks.filter(b => !b.folderId || !bookmarkFolders.some(f => f.id === b.folderId)).sort((a, b) => a.order - b.order).map(b => (
                        <div
                          key={b.id}
                          className={`bookmark-item ${bmDragId === b.id ? "bm-dragging" : ""} ${bmDropId === b.id ? "bm-drop-target" : ""}`}
                          data-bm-id={b.id}
                          onClick={() => onSelectBookmark(b.url)}
                          onContextMenu={e => { e.preventDefault(); setBmCtx({ x: e.clientX, y: e.clientY, id: b.id }); }}
                          onMouseDown={e => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            const startY = e.clientY;
                            let dragging = false;
                            let currentDrop: string | null = null;
                            const onMove = (me: MouseEvent) => {
                              if (!dragging && Math.abs(me.clientY - startY) < 5) return;
                              if (!dragging) { dragging = true; setBmDragId(b.id); setBmDragType("bookmark"); }
                              const els = bmListRef.current?.querySelectorAll("[data-bm-id], [data-bm-folder]");
                              let found: string | null = null;
                              if (els) for (let i = 0; i < els.length; i++) {
                                const r = els[i].getBoundingClientRect();
                                if (me.clientY >= r.top && me.clientY < r.bottom) {
                                  const id = els[i].getAttribute("data-bm-id") || els[i].getAttribute("data-bm-folder");
                                  if (id && id !== b.id) { found = id; break; }
                                }
                              }
                              currentDrop = found;
                              setBmDropId(found);
                            };
                            const onUp = (me: MouseEvent) => {
                              document.removeEventListener("mousemove", onMove);
                              document.removeEventListener("mouseup", onUp);
                              if (dragging && currentDrop) {
                                const isFolder = bookmarkFolders.some(f => f.id === currentDrop);
                                if (isFolder) {
                                  onMoveBookmarkToFolder(b.id, currentDrop!);
                                } else {
                                  const targetEl = bmListRef.current?.querySelector(`[data-bm-id="${currentDrop}"]`);
                                  if (targetEl) {
                                    const r = targetEl.getBoundingClientRect();
                                    const pos = me.clientY < r.top + r.height / 2 ? "before" : "after";
                                    onReorderBookmarks(b.id, currentDrop!, pos);
                                  }
                                }
                              }
                              setBmDragId(null); setBmDropId(null); setBmDragType(null);
                            };
                            document.addEventListener("mousemove", onMove);
                            document.addEventListener("mouseup", onUp);
                          }}
                        >
                          <div className="tab-favicon">
                            {b.favicon ? <img src={b.favicon} alt="" width={14} height={14} /> : <span className="tab-favicon-placeholder">{(b.title || b.url || '?')[0]}</span>}
                          </div>
                          <span className="tab-title">{b.title || b.url}</span>
                        </div>
                      ))}
                      {/* New folder button */}
                      <div
                        className="bm-new-folder"
                        onClick={() => {
                          const id = onAddBookmarkFolder("New Folder");
                          setRenameFolderValue("New Folder");
                          setRenamingFolder(id);
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                        </svg>
                        <span>new folder</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {syncEnabled && syncedTabs.length > 0 && (
              <div className="bookmark-section">
                <div className="section-label section-label-clickable" onClick={() => setSyncedTabsOpen(p => !p)} style={{ justifyContent: "flex-start", gap: 6 }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: syncedTabsOpen ? "rotate(90deg)" : "", transition: "transform 0.15s", flexShrink: 0 }}>
                    <path d="M3 1L7 5L3 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>synced tabs</span>
                </div>
                {syncedTabsOpen && (
                  <div className="bookmark-list">
                    {syncedTabs.map(device => (
                      <div key={device.device_id}>
                        <div className="section-label" style={{ fontSize: 10, opacity: 0.5, paddingLeft: 12 }}>
                          {device.device_name || device.device_id.substring(0, 8)}
                          <span style={{ marginLeft: 4, fontSize: 9 }}>
                            {Date.now() - device.timestamp < 300000 ? "  online" : ""}
                          </span>
                        </div>
                        {device.tabs.slice(0, 5).map((st, i) => (
                          <div key={i} className="bookmark-item" onClick={() => onSelectBookmark(st.url)} title={st.url}>
                            {st.favicon && <img src={st.favicon} alt="" width={14} height={14} style={{ marginRight: 6, borderRadius: 2 }} />}
                            <span className="bookmark-title">{st.title || st.url}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="tab-section">
              <div className="tab-list" ref={listRef} onScroll={handleScroll}>
                <div style={{ height: topPad }} />
                {visibleTabs.map((node, i) => renderTab(node.tab, false, startIdx + i, node.depth, node.children.length))}
                <div style={{ height: bottomPad }} />
              </div>
            </div>

            {playingTab && !mediaDismissed && showMediaControls !== false && (
              <div className="media-bar" onClick={() => onSelect(playingTab.id)}>
                <button className="media-bar-dismiss" onClick={e => { e.stopPropagation(); setMediaDismissed(true); }} title="Dismiss">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                </button>
                <div className="media-bar-compact">
                  <div className="media-bar-favicon">
                    {playingTab.favicon
                      ? <img src={playingTab.favicon} alt="" width={14} height={14} />
                      : <span className="tab-favicon-placeholder">{(playingTab.title || '?')[0]}</span>
                    }
                  </div>
                  <div className="media-bar-title-wrap">
                    <span className="media-bar-title">{playingTab.mediaTitle || playingTab.title}</span>
                  </div>
                  <button className="media-bar-btn" onClick={e => { e.stopPropagation(); onMediaPlayPause(); }} title={playingTab.mediaState === "playing" ? "Pause" : "Play"}>
                    {playingTab.mediaState === "playing" ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <rect x="3" y="2" width="3" height="10" rx="0.5" fill="currentColor"/>
                        <rect x="8" y="2" width="3" height="10" rx="0.5" fill="currentColor"/>
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M4 2L12 7L4 12V2Z" fill="currentColor"/>
                      </svg>
                    )}
                  </button>
                </div>
                <div className="media-bar-expanded">
                  {playingTab.mediaArtist && (
                    <span className="media-bar-artist">{playingTab.mediaArtist}</span>
                  )}
                  {(playingTab.mediaDuration != null && playingTab.mediaDuration > 0) && (
                    <div
                      className="media-bar-progress"
                      onClick={e => {
                        e.stopPropagation();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        const targetTime = pct * (playingTab.mediaDuration || 0);
                        invoke("media_seek", { id: playingTab.id, time: targetTime });
                      }}
                      onMouseMove={e => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        const indicator = (e.currentTarget as HTMLElement).querySelector('.media-bar-progress-hover') as HTMLElement;
                        if (indicator) { indicator.style.left = `${pct * 100}%`; indicator.style.opacity = '1'; }
                      }}
                      onMouseLeave={e => {
                        const indicator = (e.currentTarget as HTMLElement).querySelector('.media-bar-progress-hover') as HTMLElement;
                        if (indicator) indicator.style.opacity = '0';
                      }}
                      style={{ cursor: 'pointer', position: 'relative' }}
                    >
                      <div className="media-bar-progress-fill" style={{ width: `${((playingTab.mediaCurrentTime || 0) / playingTab.mediaDuration) * 100}%` }} />
                      <div className="media-bar-progress-hover" style={{ position: 'absolute', top: 0, width: '1px', height: '100%', background: 'var(--text-primary, #fff)', opacity: 0, pointerEvents: 'none', transition: 'opacity 0.15s' }} />
                    </div>
                  )}
                  <div className="media-bar-controls">
                    <button className="media-bar-btn" onClick={e => { e.stopPropagation(); invoke("media_command", { id: playingTab.id, cmd: "prev" }); }} title="Previous track">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <rect x="2" y="3" width="2" height="8" rx="0.5" fill="currentColor"/>
                        <path d="M12 3L6 7L12 11V3Z" fill="currentColor"/>
                      </svg>
                    </button>
                    <button className="media-bar-btn" onClick={e => { e.stopPropagation(); onMediaPlayPause(); }} title={playingTab.mediaState === "playing" ? "Pause" : "Play"}>
                      {playingTab.mediaState === "playing" ? (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <rect x="3" y="2" width="3" height="10" rx="0.5" fill="currentColor"/>
                          <rect x="8" y="2" width="3" height="10" rx="0.5" fill="currentColor"/>
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M4 2L12 7L4 12V2Z" fill="currentColor"/>
                        </svg>
                      )}
                    </button>
                    <button className="media-bar-btn" onClick={e => { e.stopPropagation(); invoke("media_command", { id: playingTab.id, cmd: "next" }); }} title="Next track">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 3L8 7L2 11V3Z" fill="currentColor"/>
                        <rect x="10" y="3" width="2" height="8" rx="0.5" fill="currentColor"/>
                      </svg>
                    </button>
                    <button className="media-bar-btn" onClick={e => { e.stopPropagation(); onMediaMute(); }} title="Mute/Unmute">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 5H4L7 2V12L4 9H2V5Z" fill="currentColor"/>
                        <path d="M9.5 4.5C10.3 5.3 10.8 6.6 10.8 7S10.3 8.7 9.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="sidebar-bottom-btns">
              <button className="new-tab-btn" onClick={() => onNew()}>
                <span className="new-tab-icon">+</span>
                <span>new tab</span>
              </button>
              <button className="history-btn" onClick={onToggleHistory} title="History (Ctrl+H)">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M8 5V8.5L10.5 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button className="download-btn" onClick={onToggleDownloads} title="Downloads">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2V10M8 10L5 7M8 10L11 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3 12H13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                {activeDownloadCount > 0 && (
                  <span className="download-badge">{activeDownloadCount}</span>
                )}
              </button>
              <button className="network-btn" onClick={onToggleNetwork} title="Network Inspector">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 4H14M2 8H14M2 12H14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <circle cx="5" cy="4" r="1" fill="currentColor"/>
                  <circle cx="9" cy="8" r="1" fill="currentColor"/>
                  <circle cx="7" cy="12" r="1" fill="currentColor"/>
                </svg>
              </button>
              {hasVideo && (
                <button className={`pip-shortcut-btn${pipActive ? " pip-active" : ""}`} onClick={onTogglePip} title="Picture in Picture">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="1" y="2.5" width="14" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                    <rect x="8" y="7" width="6" height="5" rx="1" fill="currentColor" opacity="0.3" stroke="currentColor" strokeWidth="1"/>
                  </svg>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* tab context menu */}
      {ctx && (
        <div className="ctx-overlay" onClick={closeCtx}>
          <div ref={ctxMenuRef} className="ctx-menu" style={{ top: ctxPos.top, left: ctxPos.left }}>
            <button className="ctx-item" onClick={() => { onPin(ctx.tabId); closeCtx(); }}>
              {ctx.pinned ? "unpin tab" : "pin tab"}
            </button>
            <button className="ctx-item" onClick={() => { onClose(ctx.tabId); closeCtx(); }}>
              close tab
            </button>
            {!ctx.pinned && (
              <button className="ctx-item" onClick={() => { onAddChildTab(ctx.tabId); closeCtx(); }}>
                open child tab
              </button>
            )}
            {ctx.tabId !== activeTab && (
              <button className="ctx-item" onClick={() => { onSplitWith(ctx.tabId); closeCtx(); }}>
                split with this tab
              </button>
            )}
            {syncEnabled && pairedDevices && pairedDevices.length > 0 && (() => {
              const tab = [...tabs, ...pinnedTabs].find(t => t.id === ctx.tabId);
              return tab && tab.url.startsWith("http") ? (
                <>
                  <div className="ctx-divider" />
                  {pairedDevices.map(d => (
                    <button key={d.device_id} className="ctx-item" onClick={() => {
                      invoke("send_tab_to_device", { deviceId: d.device_id, url: tab.url, title: tab.title });
                      closeCtx();
                    }}>
                      send to {d.name}
                    </button>
                  ))}
                </>
              ) : null;
            })()}
            <button className="ctx-item" onClick={() => {
              const tab = [...tabs, ...pinnedTabs].find(t => t.id === ctx.tabId);
              if (tab) onNew(tab.url);
              closeCtx();
            }}>
              duplicate tab
            </button>
            <button className="ctx-item" onClick={() => { onMuteTab(ctx.tabId); closeCtx(); }}>
              mute tab
            </button>
            {!ctx.pinned && (
              <button className="ctx-item" onClick={() => {
                const tab = [...tabs, ...pinnedTabs].find(t => t.id === ctx.tabId);
                setRenameTabValue(tab?.customTitle || tab?.title || "");
                setRenamingTabId(ctx.tabId);
                closeCtx();
              }}>
                rename tab
              </button>
            )}
            {workspaces.length > 1 && (
              <>
                <div className="ctx-divider" />
                <div className="ctx-label">move to workspace</div>
                {workspaces.filter(ws => ws.id !== (
                  [...tabs, ...pinnedTabs].find(t => t.id === ctx.tabId)?.workspaceId || activeWorkspaceId
                )).map(ws => (
                  <button key={ws.id} className="ctx-item" onClick={() => { onMoveTabToWorkspace(ctx.tabId, ws.id); closeCtx(); }}>
                    <span className="ctx-ws-dot" style={{ background: ws.color }} />{ws.name}
                  </button>
                ))}
              </>
            )}
            <div className="ctx-divider" />
            <button className="ctx-item" onClick={() => {
              tabs.filter(t => t.id !== ctx.tabId).forEach(t => onClose(t.id));
              closeCtx();
            }}>
              close other tabs
            </button>
            <button className="ctx-item" onClick={() => {
              const idx = tabs.findIndex(t => t.id === ctx.tabId);
              if (idx >= 0) tabs.slice(idx + 1).forEach(t => onClose(t.id));
              closeCtx();
            }}>
              close tabs below
            </button>
          </div>
        </div>
      )}

      {/* bookmark context menu */}
      {bmCtx && (
        <div className="ctx-overlay" onClick={() => setBmCtx(null)}>
          <div ref={bmCtxMenuRef} className="ctx-menu" style={{ top: bmCtxPos.top, left: bmCtxPos.left }}>
            {bookmarkFolders.length > 0 && (
              <>
                <div className="ctx-label">move to folder</div>
                {bookmarkFolders.map(f => (
                  <button key={f.id} className="ctx-item" onClick={() => { onMoveBookmarkToFolder(bmCtx.id, f.id); setBmCtx(null); }}>
                    {f.name}
                  </button>
                ))}
                <button className="ctx-item" onClick={() => { onMoveBookmarkToFolder(bmCtx.id, ""); setBmCtx(null); }}>
                  (no folder)
                </button>
                <div className="ctx-divider" />
              </>
            )}
            {onEditBookmark && (
              <button className="ctx-item" onClick={() => {
                const bm = bookmarks.find(b => b.id === bmCtx.id);
                if (bm) setEditingBookmark({ id: bm.id, title: bm.title, url: bm.url });
                setBmCtx(null);
              }}>
                edit bookmark
              </button>
            )}
            <button className="ctx-item ctx-danger" onClick={() => { onRemoveBookmark(bmCtx.id); setBmCtx(null); }}>
              remove bookmark
            </button>
          </div>
        </div>
      )}

      {/* bookmark edit modal */}
      {editingBookmark && (
        <div className="ctx-overlay" onClick={() => setEditingBookmark(null)}>
          <div className="bm-edit-modal" onClick={e => e.stopPropagation()}>
            <div className="bm-edit-title">edit bookmark</div>
            <label className="bm-edit-label">
              title
              <input
                ref={editBmTitleRef}
                className="bm-edit-input"
                value={editingBookmark.title}
                onChange={e => setEditingBookmark(prev => prev ? { ...prev, title: e.target.value } : null)}
                spellCheck={false}
                autoFocus
              />
            </label>
            <label className="bm-edit-label">
              url
              <input
                className="bm-edit-input"
                value={editingBookmark.url}
                onChange={e => setEditingBookmark(prev => prev ? { ...prev, url: e.target.value } : null)}
                spellCheck={false}
              />
            </label>
            <div className="bm-edit-actions">
              <button className="bm-edit-cancel" onClick={() => setEditingBookmark(null)}>cancel</button>
              <button className="bm-edit-save" onClick={() => {
                if (editingBookmark && onEditBookmark) {
                  onEditBookmark(editingBookmark.id, editingBookmark.title, editingBookmark.url);
                }
                setEditingBookmark(null);
              }}>save</button>
            </div>
          </div>
        </div>
      )}

      {/* folder context menu */}
      {folderCtx && (
        <div className="ctx-overlay" onClick={() => setFolderCtx(null)}>
          <div ref={folderCtxMenuRef} className="ctx-menu" style={{ top: folderCtxPos.top, left: folderCtxPos.left }}>
            <button className="ctx-item" onClick={() => {
              const folder = bookmarkFolders.find(f => f.id === folderCtx.folderId);
              setRenameFolderValue(folder?.name || "");
              setRenamingFolder(folderCtx.folderId);
              setFolderCtx(null);
            }}>
              rename folder
            </button>
            {onSetFolderRss && (() => {
              const f = bookmarkFolders.find(f => f.id === folderCtx.folderId);
              return f?.rssUrl ? (
                <button className="ctx-item" onClick={() => { onRemoveFolderRss?.(folderCtx.folderId); setFolderCtx(null); }}>
                  remove RSS feed
                </button>
              ) : (
                <button className="ctx-item" onClick={() => {
                  const url = window.prompt("Enter RSS feed URL:");
                  if (url?.trim()) onSetFolderRss(folderCtx.folderId, url.trim());
                  setFolderCtx(null);
                }}>
                  set RSS feed...
                </button>
              );
            })()}
            <button className="ctx-item ctx-danger" onClick={() => { onDeleteBookmarkFolder(folderCtx.folderId); setFolderCtx(null); }}>
              delete folder
            </button>
          </div>
        </div>
      )}

      {/* workspace context menu */}
      {wsCtx && (
        <div className="ctx-overlay" onClick={closeWsCtx}>
          <div ref={wsCtxMenuRef} className="ctx-menu" style={{ top: wsCtxPos.top, left: wsCtxPos.left }}>
            <button className="ctx-item" onClick={() => startRename(wsCtx.wsId)}>
              rename workspace
            </button>
            <div className="ctx-divider" />
            <div className="ctx-label">color</div>
            <div className="ctx-color-swatches">
              {WS_COLORS.map(c => (
                <button
                  key={c}
                  className={`ctx-swatch ${workspaces.find(w => w.id === wsCtx.wsId)?.color === c ? "active" : ""}`}
                  style={{ background: c }}
                  onClick={() => { onRecolorWorkspace(wsCtx.wsId, c); closeWsCtx(); }}
                />
              ))}
            </div>
            <div className="ctx-divider" />
            <button className="ctx-item" onClick={() => {
              setEmojiPicker({ wsId: wsCtx.wsId, x: wsCtxPos.left + 190, y: wsCtxPos.top });
              closeWsCtx();
            }}>
              set icon...
            </button>
            {workspaces.find(w => w.id === wsCtx.wsId)?.icon && (
              <button className="ctx-item" onClick={() => { onSetWorkspaceIcon(wsCtx.wsId, undefined); closeWsCtx(); }}>
                clear icon
              </button>
            )}
            <div className="ctx-divider" />
            <button className="ctx-item" onClick={() => {
              if (window.confirm("Clear all browsing data for this workspace? You will be logged out of all sites.")) {
                onClearWorkspaceData(wsCtx.wsId);
              }
              closeWsCtx();
            }}>
              clear workspace data
            </button>
            <button className="ctx-item" onClick={() => { onDuplicateWorkspace(wsCtx.wsId); closeWsCtx(); }}>
              duplicate workspace
            </button>
            {workspaces.length > 1 && (
              <>
                <div className="ctx-divider" />
                <button className="ctx-item ctx-danger" onClick={() => { onDeleteWorkspace(wsCtx.wsId); closeWsCtx(); }}>
                  delete workspace
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* emoji picker for workspace icon */}
      {emojiPicker && (
        <div className="ctx-overlay" onClick={() => setEmojiPicker(null)}>
          <div className="emoji-picker" style={{ top: Math.min(emojiPicker.y, window.innerHeight - 360), left: Math.min(emojiPicker.x, window.innerWidth - 220) }} onClick={e => e.stopPropagation()}>
            {EMOJI_CATEGORIES.map(cat => (
              <div key={cat.label} className="emoji-picker-category">
                <div className="emoji-picker-label">{cat.label}</div>
                <div className="emoji-picker-grid">
                  {cat.emojis.map(emoji => (
                    <button
                      key={emoji}
                      className="emoji-picker-item"
                      onClick={() => {
                        onSetWorkspaceIcon(emojiPicker.wsId, emoji);
                        setEmojiPicker(null);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
});
