import { useState, useEffect, useRef, useCallback, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Props {
  tabId: string;
  onClose: () => void;
}

export default memo(function FindBar({ tabId, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const p = listen<{ id: string; count: number }>("match-count", (e) => {
      if (e.payload.id === tabId) setMatchCount(e.payload.count);
    });
    return () => { p.then(u => u()); };
  }, [tabId]);

  const find = useCallback((forward = true) => {
    invoke("find_in_page", { id: tabId, query, forward });
  }, [tabId, query]);

  const close = useCallback(() => {
    invoke("find_in_page", { id: tabId, query: "", forward: true });
    setMatchCount(null);
    onClose();
  }, [tabId, onClose]);

  useEffect(() => {
    if (!query) setMatchCount(null);
  }, [query]);

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        className="find-input"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") find(!e.shiftKey);
          if (e.key === "Escape") close();
        }}
        placeholder="find in page..."
        spellCheck={false}
      />
      {matchCount !== null && (
        <span className="find-count">{matchCount > 0 ? `${matchCount} found` : "no matches"}</span>
      )}
      <button className="find-btn" onClick={() => find(false)} title="Previous">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 8L6 4L10 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <button className="find-btn" onClick={() => find(true)} title="Next">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <button className="find-btn" onClick={close} title="Close (Esc)">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
});
