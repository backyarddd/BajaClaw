import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";

// Single source of truth for the version: the package.json one folder up.
const version = createRequire(import.meta.url)("../package.json").version;

// Built UI is served by the gateway; keep asset paths relative.
export default defineConfig({
  plugins: [react()],
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 5273 },
});
