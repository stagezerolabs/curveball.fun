import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { POST as uploadArtwork } from "./api/artwork.js";

export default defineConfig(({ mode }) => ({
  plugins: [react(), {
    name: "local-artwork-upload",
    configureServer(server) {
      process.env.PINATA_JWT ||= loadEnv(mode, process.cwd(), "PINATA_JWT").PINATA_JWT;
      server.middlewares.use("/api/artwork", async (req, res) => {
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const origin = `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`;
          const request = new Request(`${origin}/api/artwork`, {
            method: req.method,
            headers: req.headers,
            ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
          });
          const response = await uploadArtwork(request);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Artwork upload failed." }));
        }
      });
    },
  }],
  server: {
    proxy: {
      "/api/rns/primary/": {
        target: "https://api.stage0.xyz",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/rns\/primary\//, "/api/public/rns/resolve/address/") + "?chainId=4153",
      },
    },
  },
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
}));
