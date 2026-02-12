import { useState, useEffect, useMemo, useCallback, memo } from "react";
import { FrecencyResult } from "../types";

interface Props {
  topSites: FrecencyResult[];
  onNavigate: (url: string) => void;
  onSelectSite: (url: string) => void;
  showClock?: boolean;
  showGreeting?: boolean;
}

export default memo(function NewTabPage({ topSites, onNavigate, onSelectSite, showClock = true, showGreeting = true }: Props) {
  const [query, setQuery] = useState("");
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const greeting = useMemo(() => {
    const h = time.getHours();
    if (h < 12) return "Good Morning";
    if (h < 18) return "Good Afternoon";
    return "Good Evening";
  }, [time]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) onNavigate(query.trim());
  }, [query, onNavigate]);

  return (
    <div className="ntp">
      <div className="ntp-center">
        {showClock && (
          <div className="ntp-clock">
            {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
        {showGreeting && <div className="ntp-greeting">{greeting}</div>}
        <form className="ntp-search" onSubmit={handleSubmit}>
          <input
            className="ntp-search-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="search the web..."
            autoFocus
            spellCheck={false}
          />
        </form>
        <div className="ntp-sites">
          {topSites.map(s => {
            let domain = "";
            try { domain = new URL(s.url).hostname.replace("www.", ""); } catch { domain = s.title; }
            return (
              <div
                key={s.url}
                className="ntp-site"
                onClick={() => onSelectSite(s.url)}
              >
                <div className="ntp-site-icon">
                  {s.favicon
                    ? <img src={s.favicon} alt="" width={28} height={28} />
                    : <span className="ntp-site-placeholder">{domain.charAt(0).toUpperCase()}</span>
                  }
                </div>
                <span className="ntp-site-label">{domain || s.title}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
