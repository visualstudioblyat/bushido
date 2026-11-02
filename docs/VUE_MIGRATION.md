# Vue Migration

Migrating the Digidaw Space frontend from **React + Zustand** to **Vue 3 + Pinia**,
keeping **Bun + Vite + Tauri**. Done as a parallel track so the shipping React app
(`src/`) stays green until the Vue app (`src-vue/`) reaches full parity.

## Tooling (done)
- Package manager/runtime: **Bun** (`bun.lock`, `packageManager` field).
- Added: `vue`, `pinia`, `@vitejs/plugin-vue`, `vue-tsc`.
- Parallel build: `vite.config.vue.ts` → `dist-vue/`, entry `index.vue.html`.
- Scripts: `dev:vue`, `build:vue`, `typecheck:vue`.
- Verified: `bun run typecheck:vue`, `bun run build:vue`, and the React `bun run build` all pass.

## Conventions
- **Pure TS is shared, not duplicated**: `src/types.ts`, `src/splitLayout.ts`,
  `src/store/storeTypes.ts` are imported directly by `src-vue/`.
- **Stores**: zustand `create<T>()` → Pinia `defineStore(id, setup)` returning refs + actions.
  `set((s)=>...)` toggles become direct `ref.value` mutations.
- **Components**: `.tsx` → `.vue` SFC (`<script setup lang="ts">`).
  - `useState` → `ref`; `useMemo` → `computed`; `useEffect` → `onMounted`/`onUnmounted`/`watch`.
  - Props via `defineProps`/`withDefaults`; callbacks → `defineEmits`.
  - `className` → `class`; `onX={fn}` → `@x="fn"`; conditional render → `v-if`; lists → `v-for` with `:key`.
- **Tauri**: `invoke` from `@tauri-apps/api/core` works unchanged in Vue.

## Ported (vertical slice — proves the stack)
- [x] `stores/*` — all six zustand stores + barrel (commit `9bcf0f1`)
- [x] `components/NewTabPage.vue`
- [x] `App.vue` shell + `main.ts` + `env.d.ts`

## Remaining

Tracked per-file in [PORT_STATUS.md](./PORT_STATUS.md). Short version: leaf overlays →
panels → interactive → screenshot flow → `Sidebar` → `SettingsPage` → `App.tsx` shell last.

## Cutover (final step, one commit)
When `src-vue/` reaches parity:
1. Point `index.html` → `/src-vue/main.ts`; make `vite.config.ts` use `@vitejs/plugin-vue`.
2. Delete `src/` (React), `index.vue.html`, `vite.config.vue.ts`, React deps,
   `babel-plugin-react-compiler`.
3. Rewrite frontend tests (`src/__tests__/*`) for Vue (vitest + `@vue/test-utils`).
4. Update `tsconfig.json` for Vue; drop the parallel `tsconfig.vue.json`.
