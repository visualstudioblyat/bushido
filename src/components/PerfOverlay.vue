<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { invoke } from "@tauri-apps/api/core";

// Vue port of src/components/PerfOverlay.tsx.
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

const props = defineProps<{ visible: boolean }>();

const metrics = ref<Metrics | null>(null);
const benchResults = ref<BenchResult[] | null>(null);
const benchRunning = ref(false);

// fps loop state — deliberately non-reactive, only read when metrics snapshot
let frame = 0;
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;

function measureFps() {
  frameCount++;
  const now = performance.now();
  if (now - lastTime >= 1000) {
    fps = Math.round(frameCount * 1000 / (now - lastTime));
    frameCount = 0;
    lastTime = now;
  }
  if (props.visible) frame = requestAnimationFrame(measureFps);
}

watch(() => props.visible, (v, _prev, onCleanup) => {
  if (!v) return;
  frame = requestAnimationFrame(measureFps);
  onCleanup(() => cancelAnimationFrame(frame));
}, { immediate: true });

watch(() => props.visible, (v, _prev, onCleanup) => {
  if (!v) return;
  const poll = async () => {
    try {
      const rust = await invoke<{ tabCount: number; memoryWorkingSetMB: number; memoryPrivateMB: number }>("get_perf_metrics");
      const perf = performance as any;
      const heap = perf.memory ? perf.memory.usedJSHeapSize / 1_048_576 : 0;
      const domNodes = document.querySelectorAll("*").length;

      const renderStart = performance.now();
      await new Promise(r => requestAnimationFrame(r));
      const renderMs = Math.round((performance.now() - renderStart) * 10) / 10;

      metrics.value = {
        ...rust,
        fps,
        domNodes,
        jsHeapMB: Math.round(heap * 10) / 10,
        renderMs,
      };
    } catch {}
  };
  poll();
  const interval = setInterval(poll, 2000);
  onCleanup(() => clearInterval(interval));
}, { immediate: true });

onBeforeUnmount(() => cancelAnimationFrame(frame));

async function runBenchmarks() {
  benchRunning.value = true;
  try {
    benchResults.value = await invoke<BenchResult[]>("run_benchmarks");
  } catch (e) {
    console.error("Benchmark failed:", e);
  }
  benchRunning.value = false;
}

function formatUs(us: number) {
  return us < 1 ? `${(us * 1000).toFixed(0)}ns` : us < 1000 ? `${us.toFixed(1)}us` : `${(us / 1000).toFixed(2)}ms`;
}
</script>

<template>
  <div v-if="visible && metrics" class="perf-overlay" style="pointer-events: auto;">
    <div class="perf-title">Live Metrics</div>
    <div class="perf-row"><span>FPS</span><span :class="metrics.fps < 30 ? 'perf-bad' : metrics.fps < 55 ? 'perf-warn' : 'perf-good'">{{ metrics.fps }}</span></div>
    <div class="perf-row"><span>Render</span><span :class="metrics.renderMs > 16 ? 'perf-bad' : 'perf-good'">{{ metrics.renderMs }}ms</span></div>
    <div class="perf-row"><span>Tabs</span><span>{{ metrics.tabCount }}</span></div>
    <div class="perf-row"><span>DOM nodes</span><span :class="metrics.domNodes > 3000 ? 'perf-warn' : 'perf-good'">{{ metrics.domNodes }}</span></div>
    <div class="perf-row"><span>Process mem</span><span>{{ metrics.memoryWorkingSetMB }}MB</span></div>
    <div class="perf-row"><span>Private mem</span><span>{{ metrics.memoryPrivateMB }}MB</span></div>
    <div v-if="metrics.jsHeapMB > 0" class="perf-row"><span>JS heap</span><span>{{ metrics.jsHeapMB }}MB</span></div>

    <div class="perf-divider" />
    <div class="perf-title">Benchmarks</div>
    <button class="perf-bench-btn" :disabled="benchRunning" @click="runBenchmarks">
      {{ benchRunning ? "Running..." : "Run Benchmarks" }}
    </button>
    <div v-for="r in benchResults" :key="r.name" class="perf-bench-row">
      <span class="perf-bench-name">{{ r.name.replace(/_/g, " ") }}</span>
      <span class="perf-bench-val">avg {{ formatUs(r.avg_us) }} | p99 {{ formatUs(r.p99_us) }}</span>
    </div>
  </div>
</template>
