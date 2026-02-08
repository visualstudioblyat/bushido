import { useState, useCallback, useRef, useEffect } from "react";
import { Tab, Workspace } from "../types";
import logoSrc from "../assets/logo.png";

const WS_COLORS = ["#6366f1", "#f43f5e", "#22c55e", "#f59e0b", "#06b6d4", "#a855f7", "#ec4899", "#14b8a6"];

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

export default function Sidebar({
  tabs, pinnedTabs, activeTab, open, compact,
  onSelect, onClose, onPin, onNew, onToggle, onReorder,
  workspaces, activeWorkspaceId,
  onSwitchWorkspace, onAddWorkspace, onDeleteWorkspace, onRenameWorkspace, onRecolorWorkspace,
  onToggleCollapse, onAddChildTab, onMoveTabToWorkspace,
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
  const [search, setSearch] = useState("");
  const [wsDropTarget, setWsDropTarget] = useState<string | null>(null);

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
      className={`tab-item ${tab.id === activeTab ? "active" : ""} ${isPinned ? "pinned" : ""} ${dragIdx === idx ? "dragging" : ""} ${dropIdx === idx ? "drop-target" : ""}`}
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
        {tab.loading ? (
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
        <div className="sidebar-header">
          <div className="logo">
            <img src={logoSrc} alt="Bushido" width={22} height={22} />
            {(open || compact) && <span>BUSHIDO</span>}
          </div>
          {!compact && (
            <button className="sidebar-toggle" onClick={onToggle}>
              {open ? "‹" : "›"}
            </button>
          )}
        </div>

        {(open || compact) && (
          <>
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

            <div className="tab-search">
              <svg className="tab-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              <input
                className="tab-search-input"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="search tabs..."
                spellCheck={false}
              />
              {search && (
                <button className="tab-search-clear" onClick={() => setSearch("")}>×</button>
              )}
            </div>

            {(() => {
              const q = search.toLowerCase();
              const filteredPinned = search ? pinnedTabs.filter(t => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q)) : pinnedTabs;
              const filteredTabs = search ? tabs.filter(t => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q)) : tabs;
              return (
                <>
                  {filteredPinned.length > 0 && (
                    <div className="pinned-section">
                      <div className="section-label">pinned</div>
                      <div className="pinned-grid">
                        {filteredPinned.map(t => renderTab(t, true))}
                      </div>
                    </div>
                  )}

                  <div className="tab-section">
                    <div className="section-label">
                      <span>tabs</span>
                      <span className="tab-count">{filteredTabs.length}</span>
                    </div>
                    <div className="tab-list">
                      {(() => {
                        const tree = buildTree(filteredTabs);
                        const flat = flattenTree(tree);
                        return flat.map((node, i) => renderTab(node.tab, false, i, node.depth, node.children.length));
                      })()}
                    </div>
                  </div>
                </>
              );
            })()}

            <button className="new-tab-btn" onClick={onNew}>
              <span className="new-tab-icon">+</span>
              <span>new tab</span>
            </button>
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
}
