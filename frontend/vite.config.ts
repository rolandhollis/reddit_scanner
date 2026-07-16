import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    // Dev port. Picked so Waypoint (which uses the Vite default 5173)
    // can run at the same time without a port collision. Production is
    // served from the same origin as the API via the Docker image, so
    // this port only matters for local dev.
    port: 5273,
    proxy: {
      "/api": {
        target: "http://localhost:4100",
        changeOrigin: true,
      },
    },
  },
});
