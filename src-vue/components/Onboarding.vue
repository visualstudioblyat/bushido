<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { h, type Component } from "vue";
import { invoke } from "@tauri-apps/api/core";
import logoSrc from "../../src/assets/logo.png";

// Vue port of src/components/Onboarding.tsx.

/* ── Types ── */
interface BrowserInfo { name: string; has_bookmarks: boolean; has_history: boolean; }
interface ImportedBookmark { title: string; url: string; folder: string; }
interface ImportedHistory { title: string; url: string; visit_count: number; last_visit: number; }

const props = defineProps<{
  initialAccent: string;
  initialMode: "dark" | "light";
}>();
const emit = defineEmits<{
  complete: [];
  importBookmarks: [bookmarks: ImportedBookmark[]];
  importHistory: [history: ImportedHistory[]];
  themeChange: [accent: string, mode: "dark" | "light"];
}>();

/* ── Constants ── */
const ACCENT_COLORS = [
  "#6366f1", "#f43f5e", "#22c55e", "#f59e0b",
  "#06b6d4", "#a855f7", "#ec4899", "#14b8a6",
];

const STEPS = 5;

/* ── SVG icons as functional components ── */
const iconAttrs = { width: 28, height: 28, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round" };

const ChromeIcon: Component = () => h("svg", iconAttrs, [
  h("circle", { cx: 12, cy: 12, r: 10 }), h("circle", { cx: 12, cy: 12, r: 4 }),
  h("line", { x1: 12, y1: 8, x2: 12, y2: 2 }),
  h("line", { x1: 8.54, y1: 14, x2: 3.07, y2: 17 }),
  h("line", { x1: 15.46, y1: 14, x2: 20.93, y2: 17 }),
]);

const EdgeIcon: Component = () => h("svg", iconAttrs, [
  h("path", { d: "M12 2C6.48 2 2 6.48 2 12c0 2.85 1.2 5.42 3.12 7.24" }),
  h("path", { d: "M20.5 14.5c.32-.8.5-1.62.5-2.5 0-4.97-4.03-9-9-9-2.07 0-3.98.7-5.5 1.88" }),
  h("path", { d: "M12 22c3.04 0 5.76-1.51 7.39-3.83" }),
  h("circle", { cx: 14, cy: 13, r: 4 }),
]);

const FirefoxIcon: Component = () => h("svg", iconAttrs, [
  h("circle", { cx: 12, cy: 12, r: 10 }),
  h("path", { d: "M17 8c-1-2-3-3-5-3s-4 1.5-4.5 3.5c-.3 1.2 0 2.5.8 3.5 1 1.2 2.5 2 4.2 2 2.5 0 4.5-1.5 5-3.5.3-1-.1-2-.5-2.5z" }),
]);

const GlobeIcon: Component = () => h("svg", iconAttrs, [
  h("circle", { cx: 12, cy: 12, r: 10 }), h("line", { x1: 2, y1: 12, x2: 22, y2: 12 }),
  h("path", { d: "M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" }),
]);

const BROWSER_ICONS: Record<string, Component> = { Chrome: ChromeIcon, Edge: EdgeIcon, Firefox: FirefoxIcon };

const featureAttrs = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" };

const FEATURES: { icon: Component; title: string; desc: string }[] = [
  {
    icon: () => h("svg", featureAttrs, [h("path", { d: "M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3H6a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3 3 3 0 003 3h12a3 3 0 003-3 3 3 0 00-3-3z" })]),
    title: "Command Palette",
    desc: "Ctrl+K to search tabs, bookmarks, history, and run actions instantly.",
  },
  {
    icon: () => h("svg", featureAttrs, [h("rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }), h("line", { x1: 12, y1: 3, x2: 12, y2: 21 })]),
    title: "Split View",
    desc: "View two pages side-by-side. Drag a tab to split your workspace.",
  },
  {
    icon: () => h("svg", featureAttrs, [h("path", { d: "M4 19.5A2.5 2.5 0 016.5 17H20" }), h("path", { d: "M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" })]),
    title: "Reader Mode",
    desc: "Ctrl+Shift+R strips clutter for distraction-free reading.",
  },
  {
    icon: () => h("svg", featureAttrs, [h("path", { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" }), h("polyline", { points: "9 12 11 14 15 10" })]),
    title: "Ad Blocker",
    desc: "Built-in tracker & ad blocking at the network level. Unbypassable.",
  },
];

/* ── State ── */
const step = ref(0);
const exiting = ref(false);

const browsers = ref<BrowserInfo[]>([]);
const selectedBrowser = ref<string | null>(null);
const importBookmarks = ref(true);
const importHistoryFlag = ref(true);
const importing = ref(false);
const importDone = ref(false);
const importStatus = ref("");

const accent = ref(props.initialAccent);
const mode = ref<"dark" | "light">(props.initialMode);

/* Detect browsers on mount */
onMounted(() => {
  invoke<BrowserInfo[]>("detect_browsers").then(list => {
    browsers.value = list;
    if (list.length > 0) selectedBrowser.value = list[0].name;
  }).catch(() => {});
});

/* Navigation */
function goNext() { step.value = Math.min(step.value + 1, STEPS - 1); }
function goBack() { step.value = Math.max(step.value - 1, 0); }

function handleFinish() {
  if (exiting.value) return;
  exiting.value = true;
  setTimeout(() => emit("complete"), 600);
}

/* Import (React's startTransition dropped — Vue schedules fine without it) */
async function handleImport() {
  if (!selectedBrowser.value || importing.value) return;
  importing.value = true;
  importStatus.value = "Importing...";
  try {
    if (importBookmarks.value) {
      importStatus.value = "Importing bookmarks...";
      const bm = await invoke<ImportedBookmark[]>("import_bookmarks", { browser: selectedBrowser.value });
      emit("importBookmarks", bm);
    }
    if (importHistoryFlag.value) {
      importStatus.value = "Importing history...";
      const hist = await invoke<ImportedHistory[]>("import_history", { browser: selectedBrowser.value });
      emit("importHistory", hist);
    }
    importDone.value = true;
    importStatus.value = "Import complete!";
  } catch (e: any) {
    importStatus.value = `Import failed: ${e?.message || e}`;
  }
  importing.value = false;
}

/* Theme */
function handleAccent(color: string) {
  accent.value = color;
  emit("themeChange", color, mode.value);
}

function handleMode(m: "dark" | "light") {
  mode.value = m;
  emit("themeChange", accent.value, m);
}

/* Keyboard */
function onKey(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    if (step.value === 1 && importing.value) return;
    if (step.value === STEPS - 1) handleFinish();
    else goNext();
  } else if (e.key === "Escape") {
    e.preventDefault();
    if (step.value === STEPS - 1) handleFinish();
    else step.value = STEPS - 1;
  } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    e.preventDefault(); goNext();
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault(); goBack();
  }
}
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div :class="`ob-overlay${exiting ? ' ob-exiting' : ''}`">
    <div class="ob-container">
      <div class="ob-track" :style="{ transform: `translateX(-${step * 100}%)` }">

        <!-- ── Welcome ── -->
        <div class="ob-step">
          <img :src="logoSrc" alt="Digidaw" class="ob-logo-img" />
          <h1 class="ob-wordmark">Digidaw</h1>
          <p class="ob-tagline">your browser. your rules.</p>
          <p class="ob-subtitle">Private by default. No accounts. No tracking. No compromises.</p>
          <button class="ob-btn-primary" @click="goNext">Get Started</button>
        </div>

        <!-- ── Import ── -->
        <div class="ob-step">
          <h2 class="ob-screen-title">Import Your Data</h2>
          <p class="ob-subtitle">Bring your bookmarks and history from another browser.</p>

          <p v-if="browsers.length === 0" class="ob-subtitle">No browsers detected.</p>
          <div v-else class="ob-browsers">
            <div
              v-for="b in browsers"
              :key="b.name"
              :class="`ob-browser-row${selectedBrowser === b.name ? ' selected' : ''}`"
              @click="selectedBrowser = b.name"
            >
              <div class="ob-browser-icon"><component :is="BROWSER_ICONS[b.name] || GlobeIcon" /></div>
              <div class="ob-browser-name">{{ b.name }}</div>
              <div class="ob-browser-meta">
                {{ b.has_bookmarks ? (b.has_history ? "bookmarks + history" : "bookmarks") : (b.has_history ? "history" : "") }}
              </div>
              <div class="ob-radio">
                <svg v-if="selectedBrowser === b.name" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
            </div>
          </div>

          <div v-if="selectedBrowser" class="ob-import-opts">
            <div :class="`ob-import-opt${importBookmarks ? ' selected' : ''}`" @click="importBookmarks = !importBookmarks">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect v-if="importBookmarks" x="1" y="1" width="12" height="12" rx="3" fill="var(--accent)" stroke="var(--accent)" stroke-width="1.5"/>
                <rect v-else x="1" y="1" width="12" height="12" rx="3" fill="none" stroke="var(--text-dim)" stroke-width="1.5"/>
                <path v-if="importBookmarks" d="M4 7L6 9L10 5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Bookmarks
            </div>
            <div :class="`ob-import-opt${importHistoryFlag ? ' selected' : ''}`" @click="importHistoryFlag = !importHistoryFlag">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect v-if="importHistoryFlag" x="1" y="1" width="12" height="12" rx="3" fill="var(--accent)" stroke="var(--accent)" stroke-width="1.5"/>
                <rect v-else x="1" y="1" width="12" height="12" rx="3" fill="none" stroke="var(--text-dim)" stroke-width="1.5"/>
                <path v-if="importHistoryFlag" d="M4 7L6 9L10 5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              History
            </div>
          </div>

          <div v-if="importing" class="ob-progress">
            <div class="ob-progress-fill" :style="{ width: importDone ? '100%' : '60%' }" />
          </div>
          <div class="ob-import-status">{{ importStatus }}</div>

          <div class="ob-btn-row">
            <button class="ob-btn-secondary" @click="goBack">Back</button>
            <button
              v-if="!importDone"
              class="ob-btn-primary"
              :disabled="importing || !selectedBrowser || (!importBookmarks && !importHistoryFlag)"
              :style="{ opacity: importing || !selectedBrowser ? 0.5 : 1 }"
              @click="handleImport"
            >{{ importing ? "Importing..." : "Import" }}</button>
            <button v-else class="ob-btn-primary" @click="goNext">Continue</button>
            <button class="ob-skip" @click="goNext">Skip</button>
          </div>
        </div>

        <!-- ── Theme ── -->
        <div class="ob-step">
          <h2 class="ob-screen-title">Make It Yours</h2>
          <p class="ob-subtitle">Pick an accent color and theme.</p>

          <div class="ob-colors">
            <button
              v-for="c in ACCENT_COLORS"
              :key="c"
              :class="`ob-color${accent === c ? ' active' : ''}`"
              :style="{ background: c }"
              @click="handleAccent(c)"
            />
          </div>

          <div class="ob-theme-toggle">
            <div :class="`ob-theme-pill${mode === 'light' ? ' right' : ''}`" />
            <button :class="`ob-theme-btn${mode === 'dark' ? ' active' : ''}`" @click="handleMode('dark')">Dark</button>
            <button :class="`ob-theme-btn${mode === 'light' ? ' active' : ''}`" @click="handleMode('light')">Light</button>
          </div>

          <!-- Live preview — miniature Digidaw layout -->
          <div class="ob-preview">
            <div class="ob-preview-browser" :data-theme="mode">
              <!-- Titlebar -->
              <div class="ob-preview-titlebar">
                <span class="ob-preview-title">Digidaw</span>
                <div class="ob-preview-winctrls">
                  <div class="ob-preview-winbtn"/>
                  <div class="ob-preview-winbtn"/>
                  <div class="ob-preview-winbtn ob-preview-winbtn-close"/>
                </div>
              </div>
              <div class="ob-preview-body">
                <!-- Sidebar -->
                <div class="ob-preview-sidebar">
                  <div class="ob-preview-nav">
                    <div class="ob-preview-navbtn"/><div class="ob-preview-navbtn"/><div class="ob-preview-navbtn"/>
                  </div>
                  <div class="ob-preview-urlbar" :style="{ borderColor: `${accent}44` }">
                    <div class="ob-preview-urlbar-icon"/>
                  </div>
                  <div class="ob-preview-tabs">
                    <div class="ob-preview-tab ob-preview-tab-active" :style="{ borderLeftColor: accent, background: `${accent}18` }"/>
                    <div class="ob-preview-tab"/>
                    <div class="ob-preview-tab"/>
                    <div class="ob-preview-tab"/>
                  </div>
                  <div class="ob-preview-newtab">+ New Tab</div>
                </div>
                <!-- Content area -->
                <div class="ob-preview-content">
                  <div class="ob-preview-block" :style="{ width: '50%', height: '10px' }"/>
                  <div class="ob-preview-block" :style="{ height: '32px' }"/>
                  <div class="ob-preview-block" :style="{ width: '75%', height: '8px' }"/>
                  <div class="ob-preview-block" :style="{ width: '60%', height: '8px' }"/>
                </div>
              </div>
            </div>
          </div>

          <div class="ob-btn-row">
            <button class="ob-btn-secondary" @click="goBack">Back</button>
            <button class="ob-btn-primary" @click="goNext">Continue</button>
          </div>
        </div>

        <!-- ── Tour ── -->
        <div class="ob-step">
          <h2 class="ob-screen-title">Power Features</h2>
          <p class="ob-subtitle">A few things that make Digidaw different.</p>

          <div class="ob-features">
            <div v-for="f in FEATURES" :key="f.title" class="ob-feature">
              <div class="ob-feature-icon"><component :is="f.icon" /></div>
              <div class="ob-feature-title">{{ f.title }}</div>
              <div class="ob-feature-desc">{{ f.desc }}</div>
            </div>
          </div>

          <div class="ob-btn-row">
            <button class="ob-btn-secondary" @click="goBack">Back</button>
            <button class="ob-btn-primary" @click="goNext">Continue</button>
          </div>
        </div>

        <!-- ── Done ── -->
        <div class="ob-step">
          <div class="ob-done-check">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="28" stroke="var(--accent)" stroke-width="2.5" opacity="0.2"/>
              <circle cx="32" cy="32" r="28" stroke="var(--accent)" stroke-width="2.5" class="ob-check-circle"/>
              <path d="M20 33L28 41L44 23" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="ob-check-mark"/>
            </svg>
          </div>
          <h1 class="ob-wordmark">You're all set.</h1>
          <p class="ob-tagline">Welcome to Digidaw.</p>
          <button class="ob-btn-primary" @click="handleFinish">Start Browsing</button>
        </div>

      </div>

      <!-- Dots -->
      <div class="ob-dots">
        <button
          v-for="(_, i) in STEPS"
          :key="i"
          :class="`ob-dot${step === i ? ' active' : ''}`"
          @click="step = i"
        />
      </div>
    </div>
  </div>
</template>
