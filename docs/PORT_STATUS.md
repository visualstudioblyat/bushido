# Vue Port Status

Per-file migration checklist for the React → Vue port. Strategy and conventions
live in [VUE_MIGRATION.md](./VUE_MIGRATION.md); this doc tracks what's done and what's left.

Snapshot: 2026-11-02 · branch `vue/port-stores` · stores commit `9bcf0f1`

**Legend:** ✅ ported · 🟡 partial (skeleton, not at parity) · ⬜ not started · ➖ shared, imported from `src/` (no port needed)

## Progress

| Area | Done | Total | Notes |
|---|---|---|---|
| Stores | 7/7 | 7 | All zustand stores → Pinia setup stores (`9bcf0f1`) |
| Components | 1/17 | 17 | Only `NewTabPage` |
| Entry/shell | 0/2 | 2 | `main.ts` exists; `App.vue` is a proof-of-concept shell only |
| Shared TS/CSS | ➖ | 5 | Imported directly from `src/`, kept as source of truth |

By line count: ~78 of ~8,736 lines of component/entry code (≈1%). The React app is the shipping entry until parity.

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
| `App.tsx` (2,879 lines) | `App.vue` (53 lines) | 🟡 | Current file is a **vertical-slice proof** (NewTabPage + Tauri IPC status). Real port not started — this is the wiring hub: all 6 stores, ~132 `invoke` calls, Tauri event listeners, tab lifecycle, split layout, permissions |

## Components

| React (`src/components/`) | LOC | Vue | Status | Notes |
|---|---|---|---|---|
| `NewTabPage.tsx` | 76 | `NewTabPage.vue` | ✅ | 1:1 port (clock, greeting, search, top sites) |
| `WebviewPanel.tsx` | 7 | — | ⬜ | Trivial `<webview>` wrapper |
| `SplitOverlay.tsx` | 23 | — | ⬜ | Divider overlay; consumes splitLayout state owned by App |
| `ShareMenu.tsx` | 81 | — | ⬜ | 1 invoke |
| `FindBar.tsx` | 88 | — | ⬜ | 2 invokes (find in page) |
| `GlanceOverlay.tsx` | 94 | — | ⬜ | Prop-driven; pairs with feature store's `glance` |
| `PerfOverlay.tsx` | 116 | — | ⬜ | Metrics via props |
| `HistoryPanel.tsx` | 141 | — | ⬜ | Props from App (history entries) |
| `NetworkPanel.tsx` | 147 | — | ⬜ | Props; exports `NetworkEntry` type |
| `PairingWizard.tsx` | 147 | — | ⬜ | 1 invoke (sync pairing) |
| `CommandPalette.tsx` | 214 | — | ⬜ | Action list via props |
| `DownloadPanel.tsx` | 219 | — | ⬜ | 1 invoke |
| `ScreenshotOverlay.tsx` | 338 | — | ⬜ | 5 invokes (capture/save) |
| `Onboarding.tsx` | 378 | — | ⬜ | Presentational flow |
| `AnnotationEditor.tsx` | 444 | — | ⬜ | Canvas editor; 2 invokes |
| `SettingsPage.tsx` | 1,421 | — | ⬜ | Reads `uiStore` directly; 17 invokes — most IPC-heavy component |
| `Sidebar.tsx` | 1,923 | — | ⬜ | Biggest UI: tab/workspace tree, drag & drop, context menus; 6 invokes |

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

1. **Leaf overlays** (trivial, no cross-deps): `WebviewPanel`, `SplitOverlay`, `ShareMenu`, `FindBar`, `GlanceOverlay`, `PerfOverlay`
2. **Panels**: `HistoryPanel`, `NetworkPanel`, `DownloadPanel`
3. **Interactive**: `CommandPalette`, `PairingWizard`, `Onboarding`
4. **Screenshot flow**: `ScreenshotOverlay` → `AnnotationEditor` (port together, they pair)
5. **Big ones, one PR each**: `Sidebar` (drag & drop is the risk hotspot) → `SettingsPage` (IPC-heavy)
6. **App shell last**: port `App.tsx` into `App.vue` incrementally — tab lifecycle + split layout + Tauri events — wiring each wave as it lands, then cutover per VUE_MIGRATION.md

Update this file (status column + snapshot line) as waves land.
