import { memo, useState, useMemo, useCallback } from "react";

export interface NetworkEntry {
  url: string;
  resource_type: string;
  blocked: boolean;
  filter_rule: string | null;
  timestamp_ms: number;
}

interface Props {
  entries: NetworkEntry[];
  onClose: () => void;
  onClear: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  xmlhttprequest: "xhr",
  stylesheet: "css",
  script: "js",
  image: "img",
  font: "font",
  document: "doc",
  media: "media",
  fetch: "fetch",
  websocket: "ws",
  ping: "ping",
  other: "other",
};

const FILTERS = ["all", "js", "xhr", "img", "css", "font", "other"] as const;
type Filter = typeof FILTERS[number];

const FILTER_TYPES: Record<Filter, string[]> = {
  all: [],
  js: ["script"],
  xhr: ["xmlhttprequest", "fetch"],
  img: ["image"],
  css: ["stylesheet"],
  font: ["font"],
  other: ["document", "media", "websocket", "ping", "other"],
};

export default memo(function NetworkPanel({ entries, onClose, onClear }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<number | null>(null);

  const blockedCount = useMemo(() => entries.filter(e => e.blocked).length, [entries]);

  const filtered = useMemo(() => {
    let result = entries;
    if (filter !== "all") {
      const types = FILTER_TYPES[filter];
      result = result.filter(e => types.includes(e.resource_type));
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(e => e.url.toLowerCase().includes(q));
    }
    return result;
  }, [entries, filter, search]);

  const copyUrl = useCallback((url: string, idx: number) => {
    navigator.clipboard.writeText(url);
    setCopied(idx);
    setTimeout(() => setCopied(null), 1200);
  }, []);

  return (
    <div className="history-panel">
      <div className="history-header">
        <button className="history-back-btn" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="history-title">network</span>
        <span className="network-stats">
          {entries.length}{blockedCount > 0 && <span className="network-blocked-count"> / {blockedCount} blocked</span>}
        </span>
        <div className="history-clear-wrap">
          <button className="history-clear-btn" onClick={onClear}>clear</button>
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
          placeholder="filter requests..."
          spellCheck={false}
        />
        {search && <button className="tab-search-clear" onClick={() => setSearch("")}>×</button>}
      </div>

      <div className="network-filter-row">
        {FILTERS.map(f => (
          <button
            key={f}
            className={`network-filter-pill${filter === f ? " active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="history-list">
        {filtered.length === 0 && (
          <div className="history-empty">
            {entries.length === 0 ? "no requests yet" : "no matches"}
          </div>
        )}
        {filtered.map((e, i) => (
          <div
            key={i}
            className={`history-entry${e.blocked ? " network-blocked" : ""}`}
            onClick={() => copyUrl(e.url, i)}
            title={e.blocked && e.filter_rule ? `blocked: ${e.filter_rule}` : e.url}
          >
            <span className={`network-tag ${e.blocked ? "blocked" : e.resource_type}`}>
              {e.blocked ? "x" : (TYPE_LABELS[e.resource_type] || e.resource_type)}
            </span>
            <div className="history-entry-text">
              <span className="history-entry-title">
                {copied === i ? "copied!" : (() => {
                  try {
                    const u = new URL(e.url);
                    return u.pathname + u.search || "/";
                  } catch { return e.url; }
                })()}
              </span>
              <span className="history-entry-url">
                {(() => { try { return new URL(e.url).hostname; } catch { return ""; } })()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
