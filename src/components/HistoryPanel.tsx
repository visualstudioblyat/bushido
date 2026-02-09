import { useState, useMemo, useCallback, memo } from "react";
import { HistoryEntry } from "../types";

interface Props {
  history: HistoryEntry[];
  onSelect: (url: string) => void;
  onClose: () => void;
  onClear: (range: 'hour' | 'today' | 'all') => void;
}

function groupByDate(entries: HistoryEntry[]): { label: string; entries: HistoryEntry[] }[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400_000;

  const groups: Map<string, HistoryEntry[]> = new Map();

  for (const entry of entries) {
    let label: string;
    if (entry.lastVisitAt >= todayStart) {
      label = "today";
    } else if (entry.lastVisitAt >= yesterdayStart) {
      label = "yesterday";
    } else {
      const d = new Date(entry.lastVisitAt);
      const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const dayDiff = Math.floor((todayStart - entry.lastVisitAt) / 86400_000);
      if (dayDiff < 7) {
        label = days[d.getDay()];
      } else {
        label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }
    }
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(entry);
  }

  return Array.from(groups.entries()).map(([label, entries]) => ({ label, entries }));
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default memo(function HistoryPanel({ history, onSelect, onClose, onClear }: Props) {
  const [search, setSearch] = useState("");
  const [clearOpen, setClearOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!search) return history;
    const q = search.toLowerCase();
    return history.filter(h => h.url.toLowerCase().includes(q) || h.title.toLowerCase().includes(q));
  }, [history, search]);

  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  const handleClear = useCallback((range: 'hour' | 'today' | 'all') => {
    onClear(range);
    setClearOpen(false);
  }, [onClear]);

  return (
    <div className="history-panel">
      <div className="history-header">
        <button className="history-back-btn" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="history-title">history</span>
        <div className="history-clear-wrap">
          <button className="history-clear-btn" onClick={() => setClearOpen(p => !p)}>clear</button>
          {clearOpen && (
            <div className="history-clear-dropdown">
              <button className="ctx-item" onClick={() => handleClear('hour')}>last hour</button>
              <button className="ctx-item" onClick={() => handleClear('today')}>today</button>
              <div className="ctx-divider" />
              <button className="ctx-item ctx-danger" onClick={() => handleClear('all')}>all time</button>
            </div>
          )}
        </div>
      </div>

      <div className="history-search">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="search history..."
          spellCheck={false}
        />
        {search && <button className="tab-search-clear" onClick={() => setSearch("")}>×</button>}
      </div>

      <div className="history-list">
        {groups.length === 0 && (
          <div className="history-empty">
            {search ? "no matches" : "no history yet"}
          </div>
        )}
        {groups.map(g => (
          <div key={g.label}>
            <div className="history-group-label">{g.label}</div>
            {g.entries.map((entry, i) => (
              <div
                key={`${entry.url}-${i}`}
                className="history-entry"
                onClick={() => onSelect(entry.url)}
              >
                <div className="tab-favicon">
                  {entry.favicon ? <img src={entry.favicon} alt="" width={14} height={14} /> : <span className="tab-favicon-placeholder" />}
                </div>
                <div className="history-entry-text">
                  <span className="history-entry-title">{entry.title || entry.url}</span>
                  <span className="history-entry-url">{entry.url}</span>
                </div>
                <span className="history-entry-time">{formatTime(entry.lastVisitAt)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});
