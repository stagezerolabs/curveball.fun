import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Wallet providers and hooks must resolve to the same module instances.
  // Bun can retain multiple compatible peer-dependency installations, which
  // otherwise lets RainbowKit consume a different Wagmi React context.
  resolve: {
    dedupe: ["react", "react-dom", "wagmi", "@wagmi/core", "@tanstack/react-query"],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
