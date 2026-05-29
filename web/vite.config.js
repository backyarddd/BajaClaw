import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Built UI is served by the gateway; keep asset paths relative.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 5273 },
});
