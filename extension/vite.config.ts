import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.js";

/** Stamped into the bundle so a stale service worker is identifiable at a glance. */
const BUILD_ID = new Date().toISOString().replace("T", " ").slice(0, 19);

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), crx({ manifest })],
  build: {
    target: "chrome114",
    outDir: "dist",
    emptyOutDir: true,
  },
  // crxjs needs a stable port for HMR in the extension context.
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
});
