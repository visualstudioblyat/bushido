import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import App from "./App";
import "./styles/global.css";

// catch fire-and-forget invoke() failures
window.onunhandledrejection = (e: PromiseRejectionEvent) => {
  console.warn("unhandled rejection:", e.reason);
};

function Fallback({ resetErrorBoundary }: { resetErrorBoundary: () => void }) {
  return (
    <div style={{ padding: 48, color: "#d4d4d8", fontFamily: "system-ui", textAlign: "center" }}>
      <h1 style={{ fontSize: 20, marginBottom: 12 }}>Something went wrong</h1>
      <p style={{ color: "#71717a", marginBottom: 24 }}>Bushido hit an unexpected error.</p>
      <button
        onClick={resetErrorBoundary}
        style={{ padding: "10px 24px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600 }}
      >
        Try again
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary FallbackComponent={Fallback}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
