import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Same-origin in production (Hono serves ./dist, Netlify redirects /api/* to the
// deployed API), so the client always calls a relative /api. In dev Vite proxies
// that path to the deployed API by default — running the local Hono process needs
// a database. Set API_URL=http://localhost:3001 to hit a local backend instead.
const apiTarget =
  process.env.API_URL || "https://curveball-kamicash-eb63bc77.koyeb.app";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
});
