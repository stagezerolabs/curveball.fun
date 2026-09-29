import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Development always uses the local API unless the developer explicitly chooses
// another target. This prevents a mainnet wallet from loading testnet market data.
const apiTarget = process.env.API_URL || "http://127.0.0.1:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
});
