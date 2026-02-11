import { useState, useCallback, useRef, useEffect, useMemo, memo, RefObject } from "react";
import { Tab, Workspace, Bookmark, BookmarkFolder, FrecencyResult, WebPanel } from "../types";
import logoSrc from "../assets/logo.png";

const GearIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M9 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M14.7 11.1l.8 1.4a.9.9 0 01-.3 1.2l-1.5.9a.9.9 0 01-1.1-.1l-.6-.6a5.4 5.4 0 01-1.5.4v.8a.9.9 0 01-.9.9h-1.8a.9.9 0 01-.9-.9v-.8a5.4 5.4 0 01-1.5-.4l-.6.6a.9.9 0 01-1.1.1l-1.5-.9a.9.9 0 01-.3-1.2l.8-1.4a5.4 5.4 0 010-4.2l-.8-1.4a.9.9 0 01.3-1.2l1.5-.9a.9.9 0 011.1.1l.6.6A5.4 5.4 0 017.2 3v-.8a.9.9 0 01.9-.9h1.8a.9.9 0 01.9.9V3a5.4 5.4 0 011.5.4l.6-.6a.9.9 0 011.1-.1l1.5.9a.9.9 0 01.3 1.2l-.8 1.4a5.4 5.4 0 010 4.2z" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
);

const WS_COLORS = ["#6366f1", "#f43f5e", "#22c55e", "#f59e0b", "#06b6d4", "#a855f7", "#ec4899", "#14b8a6"];

const PANEL_PRESETS = [
  { name: "ChatGPT", url: "https://chatgpt.com", favicon: "https://www.google.com/s2/favicons?domain=chatgpt.com&sz=32" },
  { name: "Spotify", url: "https://open.spotify.com", favicon: "https://www.google.com/s2/favicons?domain=spotify.com&sz=32" },
  { name: "Discord", url: "https://discord.com/app", favicon: "https://www.google.com/s2/favicons?domain=discord.com&sz=32" },
  { name: "WhatsApp", url: "https://web.whatsapp.com", favicon: "https://www.google.com/s2/favicons?domain=whatsapp.com&sz=32" },
  { name: "YouTube Music", url: "https://music.youtube.com", favicon: "https://www.google.com/s2/favicons?domain=music.youtube.com&sz=32" },
  { name: "Twitter / X", url: "https://x.com", favicon: "https://www.google.com/s2/favicons?domain=x.com&sz=32" },
] as const;

interface Props {
  tabs: Tab[];
  pinnedTabs: Tab[];
  activeTab: string;
  open: boolean;
  compact: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onPin: (id: string) => void;
  onNew: () => void;
  onToggle: () => void;
  onReorder: (from: number, to: number) => void;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onSwitchWorkspace: (id: string) => void;
  onAddWorkspace: () => void;
  onDeleteWorkspace: (id: string) => void;
  onRenameWorkspace: (id: string, name: string) => void;
  onRecolorWorkspace: (id: string, color: string) => void;
  onToggleCollapse: (id: string) => void;
  onAddChildTab: (parentId: string) => void;
  onMoveTabToWorkspace: (tabId: string, targetWsId: string) => void;
  bookmarks: Bookmark[];
  bookmarkFolders: BookmarkFolder[];
  onSelectBookmark: (url: string) => void;
  onRemoveBookmark: (id: string) => void;
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
  onSwitchWorkspace, onAddWorkspace, onDeleteWorkspace, onRenameWorkspace, onRecolorWorkspace,
  onToggleCollapse, onAddChildTab, onMoveTabToWorkspace,
  bookmarks, bookmarkFolders, onSelectBookmark, onRemoveBookmark, onToggleHistory,
  onBack, onForward, onReload,
  url, onNavigate, loading, inputRef,
  blockedCount, whitelisted, onToggleWhitelist,
  suggestions, topSites, onSuggestionSelect, onInputChange,
  isBookmarked, onToggleBookmark,
  onToggleReader, isReaderActive, readerSettings, onUpdateReaderSettings,
  hasVideo, pipActive, onTogglePip,
  onOpenSettings,
  activeDownloadCount, onToggleDownloads,
  paneTabIds, onSplitWith,
  playingTab, onMediaPlayPause, onMediaMute,
  panels, activePanelId, onTogglePanel, onAddPanel, onRemovePanel,
}: Props) {
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const [wsCtx, setWsCtx] = useState<WsCtxMenu | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const dragCounter = useRef(0);
  const [peeking, setPeeking] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // tab search is driven by the URL bar input when focused
  const [wsDropTarget, setWsDropTarget] = useState<string | null>(null);
  const [startIdx, setStartIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [bookmarksExpanded, setBookmarksExpanded] = useState(true);
  const [bmCtx, setBmCtx] = useState<{ x: number; y: number; id: string } | null>(null);
  const bmCtxMenuRef = useRef<HTMLDivElement>(null);
  const bmCtxPos = useClampedMenu(bmCtxMenuRef, bmCtx);
  const [panelPickerOpen, setPanelPickerOpen] = useState(false);
  const [panelCustomUrl, setPanelCustomUrl] = useState("");
  const panelPickerRef = useRef<HTMLDivElement>(null);

  // url bar state (absorbed from Toolbar)
  const [urlInput, setUrlInput] = useState(url);
  const [urlFocused, setUrlFocused] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [extPanelOpen, setExtPanelOpen] = useState(false);
  const extPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!urlFocused) setUrlInput(url);
  }, [url, urlFocused]);

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

  useEffect(() => {
    setSelectedIdx(-1);
  }, [suggestions]);

  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setUrlInput(e.target.value);
    onInputChange(e.target.value);
  }, [onInputChange]);

  const handleUrlSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIdx >= 0 && selectedIdx < suggestions.length) {
      onSuggestionSelect(suggestions[selectedIdx].url);
      inputRef.current?.blur();
      return;
    }
    if (urlInput.trim()) {
      onNavigate(urlInput.trim());
      inputRef.current?.blur();
    }
  }, [urlInput, onNavigate, inputRef, selectedIdx, suggestions, onSuggestionSelect]);

  const handleUrlKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!urlFocused || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(p => Math.min(p + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(p => Math.max(p - 1, -1));
    }
  }, [urlFocused, suggestions.length]);

  const displayUrl = useMemo(() => {
    if (urlFocused) return urlInput;
    try {
      const u = new URL(urlInput);
      return u.hostname + (u.pathname !== "/" ? u.pathname : "");
    } catch { return urlInput; }
  }, [urlFocused, urlInput]);

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
      className={`tab-item ${tab.id === activeTab ? "active" : ""} ${paneTabIds.includes(tab.id) ? "split-active" : ""} ${isPinned ? "pinned" : ""} ${tab.suspended ? "tab-suspended" : ""} ${tab.crashed ? "tab-crashed" : ""} ${dragIdx === idx ? "dragging" : ""} ${dropIdx === idx ? "drop-target" : ""}`}
      style={!isPinned && depth > 0 ? { paddingLeft: `${10 + depth * 16}px` } : undefined}
      onClick={() => onSelect(tab.id)}
      onContextMenu={e => handleCtx(e, tab.id, isPinned)}
      draggable={!isPinned}
      onDragStart={e => {
        if (isPinned || idx === undefined) return;
        setDragIdx(idx);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", tab.id);
      }}
      onDragEnter={() => {
        if (isPinned || idx === undefined || dragIdx === null) return;
        dragCounter.current++;
        setDropIdx(idx);
      }}
      onDragLeave={() => {
        if (isPinned || idx === undefined) return;
        dragCounter.current--;
        if (dragCounter.current === 0) setDropIdx(null);
      }}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={e => {
        e.preventDefault();
        if (dragIdx !== null && idx !== undefined && dragIdx !== idx) {
          onReorder(dragIdx, idx);
        }
        setDragIdx(null);
        setDropIdx(null);
        dragCounter.current = 0;
      }}
      onDragEnd={() => { setDragIdx(null); setDropIdx(null); dragCounter.current = 0; }}
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
        ) : tab.suspended ? (
          <div className="tab-zzz">zzz</div>
        ) : tab.loading ? (
          <div className="tab-spinner" />
        ) : (
          <div className="tab-favicon">
            {tab.favicon
              ? <img src={tab.favicon} alt="" width={14} height={14} />
              : <span className="tab-favicon-placeholder" />
            }
          </div>
        )}
        {!isPinned && <span className="tab-title">{tab.title}</span>}
      </div>
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
                  onFocus={() => { setUrlFocused(true); setUrlInput(""); onInputChange(""); }}
                  onBlur={() => { setUrlFocused(false); onInputChange(""); }}
                  onKeyDown={handleUrlKeyDown}
                  placeholder="search or enter url"
                  spellCheck={false}
                />
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
                    <button className="ext-action-btn" title="Screenshot">
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
                    <button className="ext-action-btn" title="Share">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M8 2V10M8 2L5 5M8 2L11 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M3 9V13H13V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </div>

                  {/* Extensions section */}
                  <div className="ext-section">
                    <div className="ext-section-header">
                      <span className="ext-section-label">Extensions</span>
                      <span className="ext-section-manage">Manage</span>
                    </div>
                    <div className="ext-grid">
                      {/* Shield/blocker as a built-in "extension" */}
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
                      {/* + button */}
                      <button className="ext-tile ext-add" title="Find extensions">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M7 2V12M2 7H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
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
              {urlFocused && suggestions.length === 0 && topSites.length > 0 && (
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
              {/* Typed suggestions list */}
              {urlFocused && suggestions.length > 0 && (
                <div className="url-suggestions">
                  {suggestions.map((s, i) => (
                    <div
                      key={s.url}
                      className={`suggestion-item ${i === selectedIdx ? "selected" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); onSuggestionSelect(s.url); }}
                    >
                      <div className="suggestion-favicon">
                        {s.favicon ? <img src={s.favicon} alt="" width={14} height={14} /> : <span className="tab-favicon-placeholder" />}
                      </div>
                      <div className="suggestion-text">
                        <span className="suggestion-title">{s.title || s.url}</span>
                        <span className="suggestion-url">{s.url}</span>
                      </div>
                      <span className="suggestion-type">{s.type === 'bookmark' ? '★' : '◷'}</span>
                    </div>
                  ))}
                </div>
              )}
            </form>

            {/* workspace switcher */}
            <div className="workspace-switcher">
              {workspaces.map((ws, i) => (
                <button
                  key={ws.id}
                  className={`ws-dot ${ws.id === activeWorkspaceId ? "active" : ""} ${wsDropTarget === ws.id ? "ws-drop-target" : ""}`}
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
              {panels.map(p => (
                <button
                  key={p.id}
                  className={`panel-icon${activePanelId === p.id ? " active" : ""}`}
                  onClick={() => onTogglePanel(p.id)}
                  onContextMenu={e => { e.preventDefault(); onRemovePanel(p.id); }}
                  title={p.title}
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

            {bookmarks.length > 0 && (
              <div className="bookmark-section">
                <div className="section-label section-label-clickable" onClick={() => setBookmarksExpanded(p => !p)}>
                  <span>bookmarks</span>
                  <span className="tab-count">{bookmarks.length}</span>
                </div>
                {bookmarksExpanded && (
                  <div className="bookmark-list">
                    {bookmarks.map(b => (
                      <div
                        key={b.id}
                        className="bookmark-item"
                        onClick={() => onSelectBookmark(b.url)}
                        onContextMenu={e => { e.preventDefault(); setBmCtx({ x: e.clientX, y: e.clientY, id: b.id }); }}
                      >
                        <div className="tab-favicon">
                          {b.favicon ? <img src={b.favicon} alt="" width={14} height={14} /> : <span className="tab-favicon-placeholder" />}
                        </div>
                        <span className="tab-title">{b.title || b.url}</span>
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

            {playingTab && (
              <div className="media-bar" onClick={() => onSelect(playingTab.id)}>
                <div className="media-bar-info">
                  <div className="media-bar-favicon">
                    {playingTab.favicon
                      ? <img src={playingTab.favicon} alt="" width={14} height={14} />
                      : <span className="tab-favicon-placeholder" />
                    }
                  </div>
                  <div className="media-bar-text">
                    <span className="media-bar-title">{playingTab.mediaTitle || playingTab.title}</span>
                    <span className={`media-bar-state ${playingTab.mediaState}`}>{playingTab.mediaState}</span>
                  </div>
                </div>
                <div className="media-bar-controls">
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
                  <button className="media-bar-btn" onClick={e => { e.stopPropagation(); onMediaMute(); }} title="Mute/Unmute">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2 5H4L7 2V12L4 9H2V5Z" fill="currentColor"/>
                      <path d="M9.5 4.5C10.3 5.3 10.8 6.6 10.8 7S10.3 8.7 9.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </button>
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
            <div className="ctx-divider" />
            <button className="ctx-item" onClick={() => {
              tabs.filter(t => t.id !== ctx.tabId).forEach(t => onClose(t.id));
              closeCtx();
            }}>
              close other tabs
            </button>
          </div>
        </div>
      )}

      {/* bookmark context menu */}
      {bmCtx && (
        <div className="ctx-overlay" onClick={() => setBmCtx(null)}>
          <div ref={bmCtxMenuRef} className="ctx-menu" style={{ top: bmCtxPos.top, left: bmCtxPos.left }}>
            <button className="ctx-item ctx-danger" onClick={() => { onRemoveBookmark(bmCtx.id); setBmCtx(null); }}>
              remove bookmark
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
    </>
  );
});
