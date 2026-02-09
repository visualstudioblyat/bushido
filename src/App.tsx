import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Sidebar from "./components/Sidebar";
import WebviewPanel from "./components/WebviewPanel";
import FindBar from "./components/FindBar";
import HistoryPanel from "./components/HistoryPanel";
import { Tab, Workspace, SessionData, HistoryEntry, BookmarkData, FrecencyResult } from "./types";

const NEW_TAB_URL = "https://www.google.com";
const DEFAULT_WS_COLOR = "#6366f1";
const WS_COLORS = ["#6366f1", "#f43f5e", "#22c55e", "#f59e0b", "#06b6d4", "#a855f7", "#ec4899", "#14b8a6"];

// generate short ids
let tabCounter = 0;
const genId = (prefix = "tab") => `${prefix}-${++tabCounter}`;

let wsCounter = 0;
const genWsId = () => `ws-${++wsCounter}`;

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
  const urlBarRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);
  const historyLoaded = useRef(false);
  const bookmarksLoaded = useRef(false);

  // derived state (memoized to avoid recomputing on every render)
  const activeWs = useMemo(() => workspaces.find(w => w.id === activeWorkspaceId), [workspaces, activeWorkspaceId]);
  const activeTab = activeWs?.activeTabId || "";
  const currentWsTabs = useMemo(() => tabs.filter(t => t.workspaceId === activeWorkspaceId), [tabs, activeWorkspaceId]);
  const sidebarW = compactMode ? 3 : sidebarOpen ? 300 : 54;
  const topOffset = 40;
  const pinnedTabs = useMemo(() => currentWsTabs.filter(t => t.pinned), [currentWsTabs]);
  const regularTabs = useMemo(() => currentWsTabs.filter(t => !t.pinned), [currentWsTabs]);

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
        const restoredSidebarW = restoredCompact ? 3 : 300;
        const restoredTopOffset = 40;
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
            invoke("create_tab", { id: t.id, url: t.url, sidebarW: 300, topOffset: 40 });
            clearLoading(t.id);
          });
          invoke("switch_tab", { id: restored[0].id, sidebarW: 300, topOffset: 40 });
        } else {
          const id = genId();
          const tab: Tab = { id, url: NEW_TAB_URL, title: "New Tab", loading: true, workspaceId: wsId };
          ws.activeTabId = id;
          setWorkspaces([ws]);
          setTabs([tab]);
          setActiveWorkspaceId(wsId);
          invoke("create_tab", { id, url: NEW_TAB_URL, sidebarW: 300, topOffset: 40 });
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

  // record history from navigation events
  const recordHistory = useCallback((url: string, title: string, favicon?: string) => {
    if (!historyLoaded.current || url === NEW_TAB_URL || !url.startsWith("http")) return;
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
        recordHistory(e.payload.url, "", favicon);
        if (domain) {
          invoke<boolean>("is_whitelisted", { domain }).then(wl => {
            setTabs(prev => prev.map(t => t.id === e.payload.id ? { ...t, whitelisted: wl } : t));
          });
        }
      }),
      listen<{ id: string; title: string }>("tab-title-changed", (e) => {
        setTabs(prev => {
          const tab = prev.find(t => t.id === e.payload.id);
          if (tab) {
            // update history entry with the title
            setHistoryEntries(hp => hp.map(h => h.url === tab.url ? { ...h, title: e.payload.title } : h));
          }
          return prev.map(t => t.id === e.payload.id ? { ...t, title: e.payload.title, loading: false } : t);
        });
      }),
      listen<{ id: string; loading: boolean }>("tab-loading", (e) => {
        setTabs(prev => prev.map(t => t.id === e.payload.id ? { ...t, loading: e.payload.loading } : t));
      }),
      listen<{ id: string; count: number }>("tab-blocked-count", (e) => {
        setTabs(prev => prev.map(t =>
          t.id === e.payload.id ? { ...t, blockedCount: e.payload.count } : t
        ));
      }),
    ];

    return () => { promises.forEach(p => p.then(u => u())); };
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

  const current = useMemo(() => tabs.find(t => t.id === activeTab), [tabs, activeTab]);

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
  }, [addTab, closeTab, activeTab, currentWsTabs, workspaces, selectTab, switchWorkspace, toggleBookmark]);

  // global shortcut bridge: Rust eval() calls this directly on the main webview
  // also handles child webview shortcuts forwarded via title encoding → global-shortcut event
  useEffect(() => {
    (window as any).__bushidoGlobalShortcut = (action: string) => {
      switch (action) {
        case "toggle-compact": setCompactMode(p => !p); break;
        case "toggle-sidebar": setSidebarOpen(p => !p); break;
        case "bookmark": toggleBookmark(); break;
        case "history": setHistoryOpen(p => !p); break;
        case "new-tab": addTab(); break;
        case "close-tab": closeTab(activeTab); break;
        case "focus-url": urlBarRef.current?.focus(); urlBarRef.current?.select(); break;
        case "find": setFindOpen(true); break;
      }
    };
    return () => { delete (window as any).__bushidoGlobalShortcut; };
  }, [toggleBookmark, addTab, closeTab, activeTab]);

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
  const minimizeWindow = useCallback(() => invoke("minimize_window"), []);
  const maximizeWindow = useCallback(() => invoke("maximize_window"), []);
  const closeWindow = useCallback(() => invoke("close_window"), []);

  return (
    <div className="browser">
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
        />
        {historyOpen && (
          <HistoryPanel
            history={historyEntries}
            onSelect={(url: string) => { selectBookmark(url); setHistoryOpen(false); }}
            onClose={toggleHistory}
            onClear={clearHistory}
          />
        )}
        <div className={`sidebar-spacer ${compactMode ? "compact" : sidebarOpen ? "" : "collapsed"}`} />
        <div className="main">
          {findOpen && activeTab && (
            <FindBar tabId={activeTab} onClose={closeFindBar} />
          )}
          <WebviewPanel />
        </div>
      </div>
    </div>
  );
}
