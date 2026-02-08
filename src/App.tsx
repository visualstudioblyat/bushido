import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import WebviewPanel from "./components/WebviewPanel";
import FindBar from "./components/FindBar";
import { Tab, Workspace, SessionData } from "./types";

const NEW_TAB_URL = "https://www.google.com";
const DEFAULT_WS_COLOR = "#6366f1";
const WS_COLORS = ["#6366f1", "#f43f5e", "#22c55e", "#f59e0b", "#06b6d4", "#a855f7", "#ec4899", "#14b8a6"];

// generate short ids
let tabCounter = 0;
const genId = (prefix = "tab") => `${prefix}-${++tabCounter}`;

let wsCounter = 0;
const genWsId = () => `ws-${++wsCounter}`;

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const urlBarRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);

  // derived state
  const activeWs = workspaces.find(w => w.id === activeWorkspaceId);
  const activeTab = activeWs?.activeTabId || "";
  const currentWsTabs = tabs.filter(t => t.workspaceId === activeWorkspaceId);
  const sidebarW = compactMode ? 3 : sidebarOpen ? 260 : 54;
  const topOffset = compactMode ? 40 : 88;
  const pinnedTabs = currentWsTabs.filter(t => t.pinned);
  const regularTabs = currentWsTabs.filter(t => !t.pinned);

  // clear loading after a delay since webview2 child events are unreliable
  const clearLoading = useCallback((tabId: string, ms = 2000) => {
    setTimeout(() => {
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, loading: false } : t));
    }, ms);
  }, []);

  // restore session or create first tab
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    invoke<string>("load_session").then(json => {
      let parsed: any = null;
      try { parsed = JSON.parse(json); } catch {}

      // detect session format
      if (parsed && parsed.workspaces && Array.isArray(parsed.workspaces)) {
        // new workspace format
        const session = parsed as SessionData;
        const restoredWs: Workspace[] = session.workspaces.map(w => {
          // ensure ws counter stays ahead
          const num = parseInt(w.id.replace("ws-", ""), 10);
          if (num >= wsCounter) wsCounter = num;
          return { id: w.id, name: w.name, color: w.color, activeTabId: w.activeTabId };
        });

        const restoredTabs: Tab[] = session.tabs.map(s => {
          const id = genId();
          return { id, url: s.url, title: s.title || "Tab", loading: true, pinned: s.pinned, workspaceId: s.workspaceId, parentId: s.parentId };
        });

        // fix up activeTabId references (old ids → new ids)
        // tabs were saved in order, so map by workspace + index
        const wsTabMap: Record<string, string[]> = {};
        session.tabs.forEach((_, i) => {
          const tab = restoredTabs[i];
          if (!wsTabMap[tab.workspaceId]) wsTabMap[tab.workspaceId] = [];
          wsTabMap[tab.workspaceId].push(tab.id);
        });

        // For each workspace, set activeTabId to first tab if original doesn't match
        restoredWs.forEach(ws => {
          const wsTabs = wsTabMap[ws.id] || [];
          if (wsTabs.length > 0) {
            // activeTabId saved was from the previous session with old ids, pick first tab
            ws.activeTabId = wsTabs[0];
          }
        });

        const restoredCompact = session.compactMode || false;
        setWorkspaces(restoredWs);
        setTabs(restoredTabs);
        setActiveWorkspaceId(session.activeWorkspaceId);
        setCompactMode(restoredCompact);

        // create webviews for all restored tabs
        const restoredSidebarW = restoredCompact ? 3 : 260;
        const restoredTopOffset = restoredCompact ? 40 : 88;
        const firstActiveWs = restoredWs.find(w => w.id === session.activeWorkspaceId);
        restoredTabs.forEach(t => {
          invoke("create_tab", { id: t.id, url: t.url, sidebarW: restoredSidebarW, topOffset: restoredTopOffset });
          clearLoading(t.id);
        });
        // show the active tab of the active workspace
        if (firstActiveWs?.activeTabId) {
          invoke("switch_tab", { id: firstActiveWs.activeTabId, sidebarW: restoredSidebarW, topOffset: restoredTopOffset });
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
          const restored: Tab[] = saved.map(s => {
            const id = genId();
            return { id, url: s.url, title: s.title || "Tab", loading: true, pinned: s.pinned, workspaceId: wsId };
          });
          ws.activeTabId = restored[0].id;
          setWorkspaces([ws]);
          setTabs(restored);
          setActiveWorkspaceId(wsId);

          restored.forEach(t => {
            invoke("create_tab", { id: t.id, url: t.url, sidebarW: 260, topOffset: 88 });
            clearLoading(t.id);
          });
          invoke("switch_tab", { id: restored[0].id, sidebarW: 260, topOffset: 88 });
        } else {
          const id = genId();
          const tab: Tab = { id, url: NEW_TAB_URL, title: "New Tab", loading: true, workspaceId: wsId };
          ws.activeTabId = id;
          setWorkspaces([ws]);
          setTabs([tab]);
          setActiveWorkspaceId(wsId);
          invoke("create_tab", { id, url: NEW_TAB_URL, sidebarW: 260, topOffset: 88 });
          clearLoading(id);
        }
      }
    });
  }, []);

  // save session when tabs/workspaces change (debounced)
  useEffect(() => {
    if (!initialized.current || tabs.length === 0) return;
    const t = setTimeout(() => {
      const session: SessionData = {
        workspaces: workspaces.map(w => ({ id: w.id, name: w.name, color: w.color, activeTabId: w.activeTabId })),
        tabs: tabs.map(tab => ({ url: tab.url, title: tab.title, pinned: tab.pinned, workspaceId: tab.workspaceId, parentId: tab.parentId })),
        activeWorkspaceId,
        compactMode,
      };
      invoke("save_session", { tabs: JSON.stringify(session) });
    }, 1000);
    return () => clearTimeout(t);
  }, [tabs, workspaces, activeWorkspaceId, compactMode]);

  // listen for webview events from rust
  useEffect(() => {
    const unlisten: (() => void)[] = [];

    listen<{ id: string; url: string }>("tab-url-changed", (e) => {
      let favicon: string | undefined;
      let domain = "";
      try {
        const host = new URL(e.payload.url).hostname;
        if (host) favicon = `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
        domain = host;
      } catch {}
      setTabs(prev => prev.map(t => t.id === e.payload.id ? { ...t, url: e.payload.url, favicon } : t));
      if (domain) {
        invoke<boolean>("is_whitelisted", { domain }).then(wl => {
          setTabs(prev => prev.map(t => t.id === e.payload.id ? { ...t, whitelisted: wl } : t));
        });
      }
    }).then(u => unlisten.push(u));

    listen<{ id: string; title: string }>("tab-title-changed", (e) => {
      setTabs(prev => prev.map(t => t.id === e.payload.id ? { ...t, title: e.payload.title, loading: false } : t));
    }).then(u => unlisten.push(u));

    listen<{ id: string; loading: boolean }>("tab-loading", (e) => {
      setTabs(prev => prev.map(t => t.id === e.payload.id ? { ...t, loading: e.payload.loading } : t));
    }).then(u => unlisten.push(u));

    listen<{ id: string; count: number }>("tab-blocked-count", (e) => {
      setTabs(prev => prev.map(t =>
        t.id === e.payload.id ? { ...t, blockedCount: e.payload.count } : t
      ));
    }).then(u => unlisten.push(u));

    return () => unlisten.forEach(u => u());
  }, []);

  // resize webviews when sidebar/topOffset changes
  // delay so CSS transition (300ms) completes before native resize (blocks compositor)
  useEffect(() => {
    if (!activeTab) return;
    const t = setTimeout(() => {
      invoke("resize_webviews", { activeId: activeTab, sidebarW, topOffset });
    }, 320);
    return () => clearTimeout(t);
  }, [sidebarW, topOffset]);

  useEffect(() => {
    if (!activeTab) return;
    const handler = () => invoke("resize_webviews", { activeId: activeTab, sidebarW, topOffset });
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [activeTab, sidebarW, topOffset]);

  // --- workspace operations ---

  const switchWorkspace = useCallback((wsId: string) => {
    setActiveWorkspaceId(wsId);
    setWorkspaces(prev => {
      const ws = prev.find(w => w.id === wsId);
      if (ws?.activeTabId) {
        invoke("switch_tab", { id: ws.activeTabId, sidebarW, topOffset });
      }
      return prev;
    });
  }, [sidebarW, topOffset]);

  const addWorkspace = useCallback(() => {
    const wsId = genWsId();
    const tabId = genId();
    const colorIdx = workspaces.length % WS_COLORS.length;
    const ws: Workspace = { id: wsId, name: `Space ${workspaces.length + 1}`, color: WS_COLORS[colorIdx], activeTabId: tabId };
    const tab: Tab = { id: tabId, url: NEW_TAB_URL, title: "New Tab", loading: true, workspaceId: wsId };

    setWorkspaces(prev => [...prev, ws]);
    setTabs(prev => [...prev, tab]);
    setActiveWorkspaceId(wsId);
    invoke("create_tab", { id: tabId, url: NEW_TAB_URL, sidebarW, topOffset });
    clearLoading(tabId);
  }, [workspaces.length, clearLoading, sidebarW, topOffset]);

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
        if (newActive.activeTabId) {
          invoke("switch_tab", { id: newActive.activeTabId, sidebarW, topOffset });
        }
      }
      return next;
    });
  }, [workspaces.length, tabs, activeWorkspaceId, sidebarW, topOffset]);

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
          if (sourceWsId === activeWorkspaceId && newActiveId) {
            invoke("switch_tab", { id: newActiveId, sidebarW, topOffset });
          }
          return { ...w, activeTabId: newActiveId };
        }
        if (w.id === targetWsId) {
          return { ...w, activeTabId: tabId };
        }
        return w;
      }));

      return next;
    });
  }, [activeWorkspaceId, sidebarW, topOffset]);

  // --- tab operations (workspace-aware) ---

  const addTab = useCallback((url = NEW_TAB_URL, parentId?: string) => {
    const id = genId();
    const tab: Tab = { id, url, title: "New Tab", loading: true, workspaceId: activeWorkspaceId, parentId };
    setTabs(prev => [...prev, tab]);
    setWorkspaces(prev => prev.map(w => w.id === activeWorkspaceId ? { ...w, activeTabId: id } : w));
    invoke("create_tab", { id, url, sidebarW, topOffset });
    clearLoading(id);
  }, [activeWorkspaceId, clearLoading, sidebarW, topOffset]);

  const closeTab = useCallback((id: string) => {
    invoke("close_tab", { id });
    setTabs(prev => {
      const tab = prev.find(t => t.id === id);
      if (!tab) return prev;
      const wsId = tab.workspaceId;
      const wsTabs = prev.filter(t => t.workspaceId === wsId);
      // promote children to parent's parent
      const next = prev.filter(t => t.id !== id).map(t =>
        t.parentId === id ? { ...t, parentId: tab.parentId } : t
      );

      if (wsTabs.length <= 1) {
        // last tab in workspace — create replacement
        const newId = genId();
        const newTab: Tab = { id: newId, url: NEW_TAB_URL, title: "New Tab", loading: true, workspaceId: wsId };
        invoke("create_tab", { id: newId, url: NEW_TAB_URL, sidebarW, topOffset });
        clearLoading(newId);
        setWorkspaces(ws => ws.map(w => w.id === wsId ? { ...w, activeTabId: newId } : w));
        return [...next, newTab];
      }

      // if closed tab was active in its workspace, switch to adjacent
      setWorkspaces(ws => ws.map(w => {
        if (w.id === wsId && w.activeTabId === id) {
          const wsTabsInNext = next.filter(t => t.workspaceId === wsId);
          const oldIdx = wsTabs.findIndex(t => t.id === id);
          const newActive = wsTabsInNext[Math.min(oldIdx, wsTabsInNext.length - 1)];
          if (newActive && wsId === activeWorkspaceId) {
            invoke("switch_tab", { id: newActive.id, sidebarW, topOffset });
          }
          return { ...w, activeTabId: newActive?.id || "" };
        }
        return w;
      }));

      return next;
    });
  }, [activeWorkspaceId, clearLoading, sidebarW, topOffset]);

  const selectTab = useCallback((id: string) => {
    setWorkspaces(prev => prev.map(w => w.id === activeWorkspaceId ? { ...w, activeTabId: id } : w));
    invoke("switch_tab", { id, sidebarW, topOffset });
  }, [activeWorkspaceId, sidebarW, topOffset]);

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

  const navigate = useCallback((url: string) => {
    if (!activeTab) return;
    let finalUrl = url;
    if (!/^https?:\/\//i.test(url)) {
      if (/\.\w{2,}/.test(url)) {
        finalUrl = "https://" + url;
      } else {
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
      }
    }
    setTabs(prev => prev.map(t => t.id === activeTab ? { ...t, url: finalUrl, loading: true, blockedCount: 0 } : t));
    invoke("navigate_tab", { id: activeTab, url: finalUrl });
    clearLoading(activeTab, 3000);
  }, [activeTab, clearLoading]);

  const current = tabs.find(t => t.id === activeTab);

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

  // keyboard shortcuts (works when React UI has focus)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "t") { e.preventDefault(); addTab(); }
      if (ctrl && e.key === "w") { e.preventDefault(); closeTab(activeTab); }
      if (ctrl && e.key === "l") { e.preventDefault(); urlBarRef.current?.focus(); urlBarRef.current?.select(); }
      if (ctrl && e.shiftKey && e.key === "B") { e.preventDefault(); setCompactMode(p => !p); }
      if (ctrl && e.key === "b" && !e.shiftKey) { e.preventDefault(); setSidebarOpen(p => !p); }
      if (ctrl && e.key === "f") { e.preventDefault(); setFindOpen(true); }
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
  }, [addTab, closeTab, activeTab, currentWsTabs, workspaces, selectTab, switchWorkspace]);

  // global shortcut bridge: Rust eval() calls this directly on the main webview
  useEffect(() => {
    (window as any).__bushidoGlobalShortcut = (action: string) => {
      switch (action) {
        case "toggle-compact": setCompactMode(p => !p); break;
        case "toggle-sidebar": setSidebarOpen(p => !p); break;
      }
    };
    return () => { delete (window as any).__bushidoGlobalShortcut; };
  }, []);

  return (
    <div className="browser">
      <div className="titlebar" data-tauri-drag-region>
        <div className="titlebar-title">{current?.title || "Bushido"}</div>
        <div className="titlebar-controls">
          <button className="win-btn" onClick={() => invoke("minimize_window")} title="Minimize">
            <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
          </button>
          <button className="win-btn" onClick={() => invoke("maximize_window")} title="Maximize">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1"/></svg>
          </button>
          <button className="win-btn win-close" onClick={() => invoke("close_window")} title="Close">
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
          onToggle={() => setSidebarOpen(p => !p)}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSwitchWorkspace={switchWorkspace}
          onAddWorkspace={addWorkspace}
          onDeleteWorkspace={deleteWorkspace}
          onRenameWorkspace={renameWorkspace}
          onRecolorWorkspace={recolorWorkspace}
          onToggleCollapse={toggleCollapse}
          onAddChildTab={(parentId: string) => addTab(NEW_TAB_URL, parentId)}
          onMoveTabToWorkspace={moveTabToWorkspace}
        />
        <div className={`sidebar-spacer ${compactMode ? "compact" : sidebarOpen ? "" : "collapsed"}`} />
        <div className="main">
          <Toolbar
            url={current?.url || ""}
            onNavigate={navigate}
            onBack={() => invoke("go_back", { id: activeTab })}
            onForward={() => invoke("go_forward", { id: activeTab })}
            onReload={() => invoke("reload_tab", { id: activeTab })}
            loading={current?.loading || false}
            inputRef={urlBarRef}
            blockedCount={current?.blockedCount || 0}
            whitelisted={current?.whitelisted || false}
            onToggleWhitelist={toggleWhitelist}
            compact={compactMode}
          />
          {findOpen && activeTab && (
            <FindBar tabId={activeTab} onClose={() => setFindOpen(false)} />
          )}
          <WebviewPanel />
        </div>
      </div>
    </div>
  );
}
