import { useState, useCallback, useRef } from "react";
import { Tab } from "../types";

interface Props {
  tabs: Tab[];
  pinnedTabs: Tab[];
  activeTab: string;
  open: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onPin: (id: string) => void;
  onNew: () => void;
  onToggle: () => void;
  onReorder: (from: number, to: number) => void;
}

interface CtxMenu {
  x: number;
  y: number;
  tabId: string;
  pinned: boolean;
}

export default function Sidebar({ tabs, pinnedTabs, activeTab, open, onSelect, onClose, onPin, onNew, onToggle, onReorder }: Props) {
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const dragCounter = useRef(0);

  const handleCtx = useCallback((e: React.MouseEvent, tabId: string, pinned: boolean) => {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, tabId, pinned });
  }, []);

  const closeCtx = useCallback(() => setCtx(null), []);

  const renderTab = (tab: Tab, isPinned: boolean, idx?: number) => (
    <div
      key={tab.id}
      className={`tab-item ${tab.id === activeTab ? "active" : ""} ${isPinned ? "pinned" : ""} ${dragIdx === idx ? "dragging" : ""} ${dropIdx === idx ? "drop-target" : ""}`}
      onClick={() => onSelect(tab.id)}
      onContextMenu={e => handleCtx(e, tab.id, isPinned)}
      draggable={!isPinned}
      onDragStart={e => {
        if (isPinned || idx === undefined) return;
        setDragIdx(idx);
        e.dataTransfer.effectAllowed = "move";
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
      <div className={`sidebar ${open ? "" : "collapsed"}`}>
        <div className="sidebar-header">
          <span className="logo">武士道</span>
          <button className="sidebar-toggle" onClick={onToggle}>
            {open ? "‹" : "›"}
          </button>
        </div>

        {open && (
          <>
            {pinnedTabs.length > 0 && (
              <div className="pinned-section">
                <div className="section-label">pinned</div>
                <div className="pinned-grid">
                  {pinnedTabs.map(t => renderTab(t, true))}
                </div>
              </div>
            )}

            <div className="tab-section">
              <div className="section-label">
                <span>tabs</span>
                <span className="tab-count">{tabs.length}</span>
              </div>
              <div className="tab-list">
                {tabs.map((t, i) => renderTab(t, false, i))}
              </div>
            </div>

            <button className="new-tab-btn" onClick={onNew}>
              <span className="new-tab-icon">+</span>
              <span>new tab</span>
            </button>
          </>
        )}
      </div>

      {ctx && (
        <div className="ctx-overlay" onClick={closeCtx}>
          <div className="ctx-menu" style={{ top: ctx.y, left: ctx.x }}>
            <button className="ctx-item" onClick={() => { onPin(ctx.tabId); closeCtx(); }}>
              {ctx.pinned ? "unpin tab" : "pin tab"}
            </button>
            <button className="ctx-item" onClick={() => { onClose(ctx.tabId); closeCtx(); }}>
              close tab
            </button>
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
    </>
  );
}
