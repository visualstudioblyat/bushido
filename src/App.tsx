import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import WebviewPanel from "./components/WebviewPanel";
import FindBar from "./components/FindBar";
import { Tab } from "./types";

const NEW_TAB_URL = "https://www.google.com";

// generate short ids for webview labels
let tabCounter = 0;
const genId = () => `tab-${++tabCounter}`;

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [findOpen, setFindOpen] = useState(false);
  const urlBarRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);

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
      let saved: { url: string; title: string; pinned?: boolean }[] = [];
      try { saved = JSON.parse(json); } catch {}

      if (saved.length > 0) {
        const restored: Tab[] = saved.map(s => {
          const id = genId();
          return { id, url: s.url, title: s.title || "Tab", loading: true, pinned: s.pinned };
        });
        setTabs(restored);
        setActiveTab(restored[0].id);
        // create webviews for all restored tabs
        restored.forEach((t, i) => {
          invoke("create_tab", { id: t.id, url: t.url });
          clearLoading(t.id);
          // only show the first tab, hide rest
          if (i > 0) invoke("switch_tab", { id: restored[0].id });
        });
      } else {
        const id = genId();
        setTabs([{ id, url: NEW_TAB_URL, title: "New Tab", loading: true }]);
        setActiveTab(id);
        invoke("create_tab", { id, url: NEW_TAB_URL });
        clearLoading(id);
      }
    });
  }, []);

  // save session when tabs change (debounced)
  useEffect(() => {
    if (!initialized.current || tabs.length === 0) return;
    const t = setTimeout(() => {
      const data = tabs.map(tab => ({ url: tab.url, title: tab.title, pinned: tab.pinned }));
      invoke("save_session", { tabs: JSON.stringify(data) });
    }, 1000);
    return () => clearTimeout(t);
  }, [tabs]);

  // listen for webview events from rust
  useEffect(() => {
    const unlisten: (() => void)[] = [];

    listen<{ id: string; url: string }>("tab-url-changed", (e) => {
      let favicon: string | undefined;
      try {
        const host = new URL(e.payload.url).hostname;
        if (host) favicon = `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
      } catch {}
      setTabs(prev => prev.map(t => t.id === e.payload.id ? { ...t, url: e.payload.url, favicon } : t));
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

  // resize webviews when sidebar toggles or window resizes
  useEffect(() => {
    if (!activeTab) return;
    invoke("resize_webviews", { activeId: activeTab, sidebarOpen });
  }, [sidebarOpen]);

  useEffect(() => {
    if (!activeTab) return;
    const handler = () => invoke("resize_webviews", { activeId: activeTab, sidebarOpen });
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [activeTab, sidebarOpen]);

  const addTab = useCallback((url = NEW_TAB_URL) => {
    const id = genId();
    setTabs(prev => [...prev, { id, url, title: "New Tab", loading: true }]);
    setActiveTab(id);
    invoke("create_tab", { id, url });
    clearLoading(id);
  }, [clearLoading]);

  const closeTab = useCallback((id: string) => {
    invoke("close_tab", { id });
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) {
        const newId = genId();
        setActiveTab(newId);
        invoke("create_tab", { id: newId, url: NEW_TAB_URL });
        clearLoading(newId);
        return [{ id: newId, url: NEW_TAB_URL, title: "New Tab", loading: true }];
      }
      if (activeTab === id) {
        const idx = prev.findIndex(t => t.id === id);
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveTab(newActive.id);
        invoke("switch_tab", { id: newActive.id });
      }
      return next;
    });
  }, [activeTab, clearLoading]);

  const selectTab = useCallback((id: string) => {
    setActiveTab(id);
    invoke("switch_tab", { id });
  }, []);

  const pinTab = useCallback((id: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, pinned: !t.pinned } : t));
  }, []);

  const reorderTabs = useCallback((from: number, to: number) => {
    setTabs(prev => {
      const unpinned = prev.filter(t => !t.pinned);
      const pinned = prev.filter(t => t.pinned);
      const item = unpinned[from];
      if (!item) return prev;
      unpinned.splice(from, 1);
      unpinned.splice(to, 0, item);
      return [...pinned, ...unpinned];
    });
  }, []);

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
  const pinnedTabs = tabs.filter(t => t.pinned);
  const regularTabs = tabs.filter(t => !t.pinned);

  // keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "t") { e.preventDefault(); addTab(); }
      if (ctrl && e.key === "w") { e.preventDefault(); closeTab(activeTab); }
      if (ctrl && e.key === "l") { e.preventDefault(); urlBarRef.current?.focus(); urlBarRef.current?.select(); }
      if (ctrl && e.key === "b") { e.preventDefault(); setSidebarOpen(p => !p); }
      if (ctrl && e.key === "f") { e.preventDefault(); setFindOpen(true); }
      if (ctrl && e.key === "Tab") {
        e.preventDefault();
        const idx = tabs.findIndex(t => t.id === activeTab);
        const next = e.shiftKey
          ? (idx - 1 + tabs.length) % tabs.length
          : (idx + 1) % tabs.length;
        selectTab(tabs[next].id);
      }
      if (ctrl && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < tabs.length) selectTab(tabs[idx].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [addTab, closeTab, activeTab, tabs, selectTab]);

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
          onSelect={selectTab}
          onClose={closeTab}
          onPin={pinTab}
          onNew={addTab}
          onReorder={reorderTabs}
          onToggle={() => setSidebarOpen(p => !p)}
        />
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
