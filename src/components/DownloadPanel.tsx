import { memo, useCallback } from "react";
import { DownloadItem } from "../types";

interface Props {
  downloads: DownloadItem[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onOpen: (id: string) => void;
  onOpenFolder: (id: string) => void;
  onClearCompleted: () => void;
  onClose: () => void;
  onRetry: (id: string) => void;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  if (bps === 0) return "";
  return `${formatBytes(bps)}/s`;
}

function formatEta(total: number | null, received: number, speed: number): string {
  if (!total || speed === 0) return "";
  const remaining = total - received;
  const secs = Math.ceil(remaining / speed);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export default memo(function DownloadPanel({
  downloads, onPause, onResume, onCancel, onOpen, onOpenFolder, onClearCompleted, onClose, onRetry,
}: Props) {
  const hasCompleted = downloads.some(d => d.state === "completed");

  const progress = useCallback((d: DownloadItem) => {
    if (!d.totalBytes) return 0;
    return Math.min(100, (d.receivedBytes / d.totalBytes) * 100);
  }, []);

  return (
    <div className="download-panel">
      <div className="download-header">
        <button className="history-back-btn" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="download-title">downloads</span>
        {hasCompleted && (
          <button className="download-clear-btn" onClick={onClearCompleted}>clear</button>
        )}
      </div>

      <div className="download-list">
        {downloads.length === 0 && (
          <div className="history-empty">no downloads</div>
        )}
        {downloads.map(d => (
          <div key={d.id} className="download-item">
            <div className="download-item-info">
              <span className="download-item-name" title={d.fileName}>{d.fileName}</span>
              <div className="download-item-meta">
                {d.state === "downloading" && (
                  <>
                    <span>{formatBytes(d.receivedBytes)}{d.totalBytes ? ` / ${formatBytes(d.totalBytes)}` : ""}</span>
                    {d.speed > 0 && <span className="download-speed">{formatSpeed(d.speed)}</span>}
                    {d.segments > 1 && <span className="download-segments">{d.segments}x</span>}
                    {d.speed > 0 && <span className="download-eta">{formatEta(d.totalBytes, d.receivedBytes, d.speed)}</span>}
                  </>
                )}
                {d.state === "paused" && (
                  <span className="download-paused-label">paused — {formatBytes(d.receivedBytes)}{d.totalBytes ? ` / ${formatBytes(d.totalBytes)}` : ""}</span>
                )}
                {d.state === "completed" && (
                  <span className="download-done-label">{d.totalBytes ? formatBytes(d.totalBytes) : "done"}</span>
                )}
                {d.state === "failed" && (
                  <span className="download-error-label">{d.error || "failed"}</span>
                )}
              </div>
            </div>

            {(d.state === "downloading" || d.state === "paused") && d.totalBytes && (
              <div className="download-progress-track">
                <div
                  className="download-progress-fill"
                  style={{ width: `${progress(d)}%` }}
                />
              </div>
            )}

            <div className="download-actions">
              {d.state === "downloading" && (
                <>
                  <button className="download-action-btn" onClick={() => onPause(d.id)} title="pause">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <rect x="2" y="1" width="3" height="10" rx="0.5" fill="currentColor"/>
                      <rect x="7" y="1" width="3" height="10" rx="0.5" fill="currentColor"/>
                    </svg>
                  </button>
                  <button className="download-action-btn danger" onClick={() => onCancel(d.id)} title="cancel">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </>
              )}
              {d.state === "paused" && (
                <>
                  {d.supportsRange && (
                    <button className="download-action-btn" onClick={() => onResume(d.id)} title="resume">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M3 1L10 6L3 11V1Z" fill="currentColor"/>
                      </svg>
                    </button>
                  )}
                  <button className="download-action-btn danger" onClick={() => onCancel(d.id)} title="cancel">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </>
              )}
              {d.state === "completed" && (
                <>
                  <button className="download-action-btn" onClick={() => onOpen(d.id)} title="open file">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 11V1H7L10 4V11H2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                      <path d="M7 1V4H10" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  <button className="download-action-btn" onClick={() => onOpenFolder(d.id)} title="open folder">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M1 3V10H11V4H6L5 3H1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </>
              )}
              {d.state === "failed" && (
                <>
                  <button className="download-action-btn" onClick={() => onRetry(d.id)} title="retry">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M10 6A4 4 0 1 1 6 2M10 2V6H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  <button className="download-action-btn danger" onClick={() => onCancel(d.id)} title="remove">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
