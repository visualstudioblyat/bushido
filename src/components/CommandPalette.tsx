import { useState, useCallback, useMemo, useEffect, useRef, memo } from "react";
import { Tab, Bookmark, HistoryEntry } from "../types";

interface CmdResult {
  id: string;
  type: "tab" | "bookmark" | "history" | "action";
  title: string;
  subtitle: string;
  favicon?: string;
}

interface Props {
  tabs: Tab[];
  bookmarks: Bookmark[];
  history: HistoryEntry[];
  sidebarW: number;
  onSelectTab: (id: string) => void;
  onNavigate: (url: string) => void;
  onAction: (action: string) => void;
  onClose: () => void;
}

const ACTIONS: CmdResult[] = [
  { id: "action-new-tab", type: "action", title: "New Tab", subtitle: "Ctrl+T" },
  { id: "action-close-tab", type: "action", title: "Close Tab", subtitle: "Ctrl+W" },
  { id: "action-toggle-compact", type: "action", title: "Toggle Compact Mode", subtitle: "Ctrl+Shift+B" },
  { id: "action-toggle-sidebar", type: "action", title: "Toggle Sidebar", subtitle: "Ctrl+B" },
  { id: "action-history", type: "action", title: "Open History", subtitle: "Ctrl+H" },
  { id: "action-bookmark", type: "action", title: "Bookmark Page", subtitle: "Ctrl+D" },
  { id: "action-clear-history", type: "action", title: "Clear All History", subtitle: "" },
];

function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 100;
  if (t.includes(q)) return 50;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length ? 25 : 0;
}

export default memo(function CommandPalette({
  tabs, bookmarks, history, sidebarW, onSelectTab, onNavigate, onAction, onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo((): CmdResult[] => {
    if (!query.trim()) return ACTIONS;

    const q = query.trim();
    const items: (CmdResult & { score: number })[] = [];

    // tabs
    for (const t of tabs) {
      const s = Math.max(fuzzyScore(q, t.title), fuzzyScore(q, t.url));
      if (s > 0) items.push({ id: `tab-${t.id}`, type: "tab", title: t.title, subtitle: t.url, favicon: t.favicon, score: s + 10 });
    }

    // bookmarks
    for (const b of bookmarks) {
      const s = Math.max(fuzzyScore(q, b.title), fuzzyScore(q, b.url));
      if (s > 0) items.push({ id: `bm-${b.id}`, type: "bookmark", title: b.title, subtitle: b.url, favicon: b.favicon, score: s + 5 });
    }

    // history (top 50 to keep it fast)
    const histSlice = history.slice(0, 200);
    for (const h of histSlice) {
      const s = Math.max(fuzzyScore(q, h.title), fuzzyScore(q, h.url));
      if (s > 0) items.push({ id: `hist-${h.url}`, type: "history", title: h.title || h.url, subtitle: h.url, favicon: h.favicon, score: s });
    }

    // actions
    for (const a of ACTIONS) {
      const s = fuzzyScore(q, a.title);
      if (s > 0) items.push({ ...a, score: s + 20 });
    }

    // dedupe by url for bookmarks/history
    const seen = new Set<string>();
    const deduped = items.filter(item => {
      if (item.type === "tab") return true;
      if (item.type === "action") return true;
      if (seen.has(item.subtitle)) return false;
      seen.add(item.subtitle);
      return true;
    });

    return deduped.sort((a, b) => b.score - a.score).slice(0, 12);
  }, [query, tabs, bookmarks, history]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [results]);

  // scroll selected into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.children[selectedIdx] as HTMLElement;
    if (selected) selected.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const executeResult = useCallback((result: CmdResult) => {
    if (result.type === "tab") {
      onSelectTab(result.id.replace("tab-", ""));
    } else if (result.type === "bookmark" || result.type === "history") {
      onNavigate(result.subtitle);
    } else if (result.type === "action") {
      onAction(result.id);
    }
    onClose();
  }, [onSelectTab, onNavigate, onAction, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(p => Math.min(p + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(p => Math.max(p - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selectedIdx]) executeResult(results[selectedIdx]);
    } else if (e.key === "Escape") {
      onClose();
    }
  }, [results, selectedIdx, executeResult, onClose]);

  const typeLabel = (type: string) => {
    switch (type) {
      case "tab": return "tab";
      case "bookmark": return "bookmark";
      case "history": return "history";
      case "action": return "action";
      default: return "";
    }
  };

  return (
    <div className="cmd-overlay" onClick={onClose} style={{ paddingLeft: sidebarW }}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        <div className="cmd-input-wrap">
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className="cmd-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="search tabs, bookmarks, history, or actions..."
            spellCheck={false}
          />
        </div>
        <div className="cmd-results" ref={listRef}>
          {results.length === 0 ? (
            <div className="cmd-empty">no results found</div>
          ) : (
            results.map((r, i) => (
              <div
                key={r.id}
                className={`cmd-result ${i === selectedIdx ? "selected" : ""}`}
                onClick={() => executeResult(r)}
                onMouseEnter={() => setSelectedIdx(i)}
              >
                <span className="cmd-result-type">{typeLabel(r.type)}</span>
                {r.favicon && r.type !== "action" ? (
                  <div className="cmd-result-icon">
                    <img src={r.favicon} alt="" width={14} height={14} />
                  </div>
                ) : r.type === "action" ? (
                  <div className="cmd-result-icon cmd-action-icon">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                ) : null}
                <div className="cmd-result-text">
                  <span className="cmd-result-title">{r.title}</span>
                  {r.subtitle && r.type !== "action" && (
                    <span className="cmd-result-subtitle">{r.subtitle}</span>
                  )}
                </div>
                {r.type === "action" && r.subtitle && (
                  <span className="cmd-result-shortcut">{r.subtitle}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});
