import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Parallel Vue build track (migration in progress).
// The default vite.config.ts still builds the shipping React app.
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    outDir: "dist-vue",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      input: "index.vue.html",
    },
  },
});
