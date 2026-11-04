# Vue Port Status

> **Done.** All components + keys have been ported and the cutover has been executed
> (`index.html` → `src/main.ts`, React track removed). Snapshot below is the final
> state at cutover time.

Per-file migration checklist for the React → Vue port. Strategy and conventions
live in [VUE_MIGRATION.md](./VUE_MIGRATION.md); this doc tracks what's done and what's left.

Snapshot: 2026-11-04 · branch `vue/port-stores` · stores `9bcf0f1` · wave 1 `5c5eb25` · wave 2 `e2292a7` · wave 3 `0c9ce6b` · wave 4 (screenshot flow) · wave 5a (Sidebar) · wave 6 (SettingsPage) · wave 7 (App shell)

**Legend:** ✅ ported · 🟡 partial (skeleton, not at parity) · ⬜ not started · ➖ shared, imported from `src/` (no port needed)

## Progress

| Area | Done | Total | Notes |
|---|---|---|---|
| Stores | 7/7 | 7 | All zustand stores → Pinia setup stores (`9bcf0f1`) |
| Components | 17/17 | 17 | + wave 6 `SettingsPage` (all 12 tabs) |
| Entry/shell | 2/2 | 2 | wave 7: `App.tsx` → `App.vue` at parity (`3ab0cbe`) |
| Shared TS/CSS | ➖ | 5 | Imported directly from `src/`, kept as source of truth |

React/Vue parity reached for all component + entry code (~8,736/~8,736 lines). The React app remains the shipping entry until cutover (see VUE_MIGRATION.md).

## Stores

| React (`src/store/`) | Vue (`src-vue/stores/`) | Status | Notes |
|---|---|---|---|
| `tabStore.ts` | `tabs.ts` | ✅ | `updateTab`/`updateWorkspace` kept as actions (mapping logic); trivial setters dropped |
| `dataStore.ts` | `data.ts` | ✅ | Refs only; `DEFAULT_SETTINGS` used for initial value |
| `uiStore.ts` | `ui.ts` | ✅ | `showError` + 4s auto-dismiss kept |
| `featureStore.ts` | `feature.ts` | ✅ | Functional updaters collapsed into direct ref mutation (Set/array are deeply reactive); exports `GlanceState`, `ReaderSettings` |
| `vaultStore.ts` | `vault.ts` | ✅ | All setters trivial → refs only |
| `syncStore.ts` | `sync.ts` | ✅ | All setters trivial → refs only |
| `index.ts` | `index.ts` | ✅ | Barrel, mirrors React layout |

## Entry & shell

| React | Vue | Status | Notes |
|---|---|---|---|
| `main.tsx` | `main.ts` | ✅ | Pinia registered; mounts `App.vue` |
| `App.tsx` (2,879 lines) | `App.vue` (2,894 lines) | ✅ | Full port (wave 7). Session restore + progressive restore, ~30 Tauri event listeners, tab/workspace lifecycle, split layout + divider/drag-to-split, debounced saves, sync CRDT diff, vault/permission/page-ctx UI, keyboard + global-shortcut bridges. React `useRef` mirrors dropped (closures read refs fresh); effects → `watch` with `onCleanup`; intervals/listeners registered once reading fresh state. `inputRef` for Sidebar passed as getter/setter shim (template wouldn't unwrap bare refs). |

## Components

| React (`src/components/`) | LOC | Vue | Status | Notes |
|---|---|---|---|---|
| `NewTabPage.tsx` | 76 | `NewTabPage.vue` | ✅ | 1:1 port (clock, greeting, search, top sites) |
| `WebviewPanel.tsx` | 7 | `WebviewPanel.vue` | ✅ | Trivial `<webview>` wrapper |
| `SplitOverlay.tsx` | 23 | `SplitOverlay.vue` | ✅ | Explicit `px` on style bindings (React auto-px, Vue doesn't) |
| `ShareMenu.tsx` | 81 | `ShareMenu.vue` | ✅ | ESC/click-outside listeners on mount; deferred mousedown preserved |
| `FindBar.tsx` | 88 | `FindBar.vue` | ✅ | `match-count` listener filters by latest `props.tabId` — no re-create on tab change |
| `GlanceOverlay.tsx` | 94 | `GlanceOverlay.vue` | ✅ | `tab-loading` watch w/ cancelled-flag cleanup; keyframes moved to SFC `<style>` |
| `PerfOverlay.tsx` | 116 | `PerfOverlay.vue` | ✅ | FPS loop + poll via two `watch(visible)`; fps loop state non-reactive by design |
| `HistoryPanel.tsx` | 141 | `HistoryPanel.vue` | ✅ | Optional `onRemoveEntry` callback → `removable` prop + `removeEntry` emit |
| `NetworkPanel.tsx` | 147 | `NetworkPanel.vue` | ✅ | `NetworkEntry` type exported via plain `<script>` block (script setup can't export) |
| `PairingWizard.tsx` | 147 | `PairingWizard.vue` | ✅ | Three Tauri listeners mounted once, unlistens collected via `Promise.all` |
| `CommandPalette.tsx` | 214 | `CommandPalette.vue` | ✅ | Fuzzy search computed; scroll-into-view watch uses `flush: "post"`; comment said "top 50" but sliced 200 — fixed comment |
| `DownloadPanel.tsx` | 219 | `DownloadPanel.vue` | ✅ | Drag-reorder fixed to read current `dropIdx` — React stale-closure bug meant reorder never fired (visual-only) |
| `ScreenshotOverlay.tsx` | 338 | `ScreenshotOverlay.vue` | ✅ | Canvas area-select; drag state as plain locals; `watch(phase, flush:post)` rewires mouse listeners |
| `Onboarding.tsx` | 378 | `Onboarding.vue` | ✅ | JSX icon components → functional components via `h()` + `<component :is>`; `useTransition` dropped (scheduling detail) |
| `AnnotationEditor.tsx` | 444 | `AnnotationEditor.vue` | ✅ | React stale-closure mirror refs dropped — listeners read `tool/color/thickness` refs directly; `size` made reactive for template; undo/redo stacks non-reactive, lengths reactive; tool icons via `v-html` constants |
| `SettingsPage.tsx` | 1,421 | `SettingsPage.vue` | ✅ | All 12 tabs via `v-if` chain (mirrors React switch). Inline `Toggle`/`Select` → `settings/SettingsToggle.vue` + `settings/SettingsSelect.vue`. Backup select: React's `getElementById` → `v-model` (`selectedBackupNum`). Shortcut recording: React effect deps `[action, keybindings, onUpdate]` → `watch(recordingAction)` reading fresh props (no stale closure). DEV-only debug section via `isDevMode()`. Inline styles use explicit `px` (React auto-px). About tab says "Vue" not "React". |
| `Sidebar.tsx` | 1,923 | `Sidebar.vue` | ✅ | Callbacks kept as function props (1:1, not emits); `useClampedMenu` → composable fn; DnD handlers as methods; `new URL`/`window`/`Date.now` moved to script (Vue template globals); `inputRef` passed as ref-like object; v-for rename inputs use function refs |

## Shared (no port needed)

Imported directly by `src-vue/` and stays canonical:

- ➖ `src/types.ts`
- ➖ `src/splitLayout.ts` (+ `src/__tests__/splitLayout.test.ts` — pure TS, keeps passing)
- ➖ `src/store/storeTypes.ts`
- ➖ `src/styles/global.css`
- ➖ `src/__tests__/types.test.ts`

React-specific test rewrites (vitest + `@vue/test-utils`) happen at cutover, see VUE_MIGRATION.md.

## Key architectural note

Only `SettingsPage` (uiStore) and `App` (all six stores) touch the store layer.
Everything else is **props-down / callbacks-up**, so the Vue port keeps the same
shape: `defineProps` + `defineEmits`, with `App.vue` as the wiring hub. Don't
push store access down into components during the port — preserve behavior first.

## Suggested port order

Dependency- and risk-aware; each wave is independently verifiable via
`bun run typecheck:vue` + `bun run build:vue`:

1. ~~**Leaf overlays** (trivial, no cross-deps): `WebviewPanel`, `SplitOverlay`, `ShareMenu`, `FindBar`, `GlanceOverlay`, `PerfOverlay`~~ ✅ done (`5c5eb25`)
2. ~~**Panels**: `HistoryPanel`, `NetworkPanel`, `DownloadPanel`~~ ✅ done (`e2292a7`)
3. ~~**Interactive**: `CommandPalette`, `PairingWizard`, `Onboarding`~~ ✅ done (`0c9ce6b`)
4. ~~**Screenshot flow**: `ScreenshotOverlay` → `AnnotationEditor` (port together, they pair)~~ ✅ done
5. **Big ones, one PR each**: ~~`Sidebar` (drag & drop is the risk hotspot)~~ ✅ wave 5a → `SettingsPage` (IPC-heavy) wave 5b
6. ~~**App shell last**: port `App.tsx` into `App.vue` — tab lifecycle + split layout + Tauri events~~ ✅ done (wave 7). Next: cutover per VUE_MIGRATION.md.

Update this file (status column + snapshot line) as waves land.
