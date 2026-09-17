import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Same-origin in production (Hono serves ./dist), so the client always calls a
// relative /api. In dev Vite proxies that path to the Hono process.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": `http://localhost:${process.env.PORT || 3001}` },
  },
});
