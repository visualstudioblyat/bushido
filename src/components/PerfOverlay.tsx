import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Metrics {
  tabCount: number;
  memoryWorkingSetMB: number;
  memoryPrivateMB: number;
  fps: number;
  domNodes: number;
  jsHeapMB: number;
  renderMs: number;
}

interface BenchResult {
  name: string;
  iterations: number;
  total_ms: number;
  avg_us: number;
  min_us: number;
  max_us: number;
  p99_us: number;
}

export default function PerfOverlay({ visible }: { visible: boolean }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [benchResults, setBenchResults] = useState<BenchResult[] | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);
  const frameRef = useRef(0);
  const lastTime = useRef(performance.now());
  const frameCount = useRef(0);
  const fpsRef = useRef(0);

  const measureFps = useCallback(() => {
    frameCount.current++;
    const now = performance.now();
    if (now - lastTime.current >= 1000) {
      fpsRef.current = Math.round(frameCount.current * 1000 / (now - lastTime.current));
      frameCount.current = 0;
      lastTime.current = now;
    }
    if (visible) frameRef.current = requestAnimationFrame(measureFps);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    frameRef.current = requestAnimationFrame(measureFps);
    return () => cancelAnimationFrame(frameRef.current);
  }, [visible, measureFps]);

  useEffect(() => {
    if (!visible) return;
    const poll = async () => {
      try {
        const rust = await invoke<{ tabCount: number; memoryWorkingSetMB: number; memoryPrivateMB: number }>("get_perf_metrics");
        const perf = (performance as any);
        const heap = perf.memory ? perf.memory.usedJSHeapSize / 1_048_576 : 0;
        const domNodes = document.querySelectorAll("*").length;

        const renderStart = performance.now();
        await new Promise(r => requestAnimationFrame(r));
        const renderMs = Math.round((performance.now() - renderStart) * 10) / 10;

        setMetrics({
          ...rust,
          fps: fpsRef.current,
          domNodes,
          jsHeapMB: Math.round(heap * 10) / 10,
          renderMs,
        });
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [visible]);

  const runBenchmarks = useCallback(async () => {
    setBenchRunning(true);
    try {
      const results = await invoke<BenchResult[]>("run_benchmarks");
      setBenchResults(results);
    } catch (e) {
      console.error("Benchmark failed:", e);
    }
    setBenchRunning(false);
  }, []);

  if (!visible || !metrics) return null;

  const formatUs = (us: number) => us < 1 ? `${(us * 1000).toFixed(0)}ns` : us < 1000 ? `${us.toFixed(1)}us` : `${(us / 1000).toFixed(2)}ms`;

  return (
    <div className="perf-overlay" style={{ pointerEvents: "auto" }}>
      <div className="perf-title">Live Metrics</div>
      <div className="perf-row"><span>FPS</span><span className={metrics.fps < 30 ? "perf-bad" : metrics.fps < 55 ? "perf-warn" : "perf-good"}>{metrics.fps}</span></div>
      <div className="perf-row"><span>Render</span><span className={metrics.renderMs > 16 ? "perf-bad" : "perf-good"}>{metrics.renderMs}ms</span></div>
      <div className="perf-row"><span>Tabs</span><span>{metrics.tabCount}</span></div>
      <div className="perf-row"><span>DOM nodes</span><span className={metrics.domNodes > 3000 ? "perf-warn" : "perf-good"}>{metrics.domNodes}</span></div>
      <div className="perf-row"><span>Process mem</span><span>{metrics.memoryWorkingSetMB}MB</span></div>
      <div className="perf-row"><span>Private mem</span><span>{metrics.memoryPrivateMB}MB</span></div>
      {metrics.jsHeapMB > 0 && <div className="perf-row"><span>JS heap</span><span>{metrics.jsHeapMB}MB</span></div>}

      <div className="perf-divider" />
      <div className="perf-title">Benchmarks</div>
      <button className="perf-bench-btn" onClick={runBenchmarks} disabled={benchRunning}>
        {benchRunning ? "Running..." : "Run Benchmarks"}
      </button>
      {benchResults && benchResults.map(r => (
        <div key={r.name} className="perf-bench-row">
          <span className="perf-bench-name">{r.name.replace(/_/g, " ")}</span>
          <span className="perf-bench-val">avg {formatUs(r.avg_us)} | p99 {formatUs(r.p99_us)}</span>
        </div>
      ))}
    </div>
  );
}
