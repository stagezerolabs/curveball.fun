import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { POST as uploadArtwork } from "./api/artwork.js";
import { existsSync, readFileSync } from "node:fs";

function publicEnvFrom(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("VITE_") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1).trim()];
      }),
  );
}

export default defineConfig(({ mode }) => {
  if (mode === "production") {
    // Read only the production file and explicit build args. Vite's normal
    // loadEnv also reads the root .env, which can contain testnet values.
    const env = { ...publicEnvFrom(".env.production"), ...process.env };
    const localMainnetPreview = process.env.CURVEBALL_LOCAL_PREVIEW === "1";
    const address = /^0x[0-9a-fA-F]{40}$/;
    const hash = /^0x[0-9a-fA-F]{64}$/;
    const required = {
      VITE_CHAIN_ID: env.VITE_CHAIN_ID === "4153",
      VITE_RPC_URL: env.VITE_RPC_URL?.startsWith("https://"),
      VITE_LAUNCHPAD_ADDRESS: address.test(env.VITE_LAUNCHPAD_ADDRESS || ""),
      VITE_DEPLOYMENT_BLOCK: /^[1-9]\d*$/.test(env.VITE_DEPLOYMENT_BLOCK || ""),
      VITE_ICARUS_SWAP_ADAPTER: address.test(
        env.VITE_ICARUS_SWAP_ADAPTER || "",
      ),
      VITE_ICARUS_SWAP_ADAPTER_CODE_HASH: hash.test(
        env.VITE_ICARUS_SWAP_ADAPTER_CODE_HASH || "",
      ),
      VITE_SOCIAL_API_URL:
        env.VITE_SOCIAL_API_URL?.startsWith("https://") ||
        (localMainnetPreview &&
          /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(
            env.VITE_SOCIAL_API_URL || "",
          )),
      VITE_ADMIN_ADDRESS: address.test(env.VITE_ADMIN_ADDRESS || ""),
    };
    const invalid = Object.entries(required)
      .filter(([, valid]) => !valid)
      .map(([key]) => key);
    if (invalid.length)
      throw new Error(
        `Incomplete RISE mainnet frontend configuration: ${invalid.join(", ")}`,
      );
    if (existsSync(".env") || existsSync(".env.local")) {
      const mainnetLocal = publicEnvFrom(".env.mainnet.local");
      for (const key of ["VITE_ADMIN_ADDRESS"]) {
        if (
          !mainnetLocal[key] ||
          mainnetLocal[key].toLowerCase() !== env[key].toLowerCase()
        ) {
          throw new Error(
            `${key} must match .env.mainnet.local in a local mainnet build.`,
          );
        }
      }
    }
    const deploymentPath = "deployments/4153/curveball.json";
    const adapterPath = "deployments/4153/icarus-swap-adapter.json";
    if (!existsSync(deploymentPath) || !existsSync(adapterPath)) {
      throw new Error(
        "Verified RISE mainnet launchpad and Icarus adapter records are required for a production build.",
      );
    }
    const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
    const adapter = JSON.parse(readFileSync(adapterPath, "utf8"));
    if (
      deployment.chainId !== 4153 ||
      adapter.chainId !== 4153 ||
      deployment.launchpad?.toLowerCase() !==
        env.VITE_LAUNCHPAD_ADDRESS.toLowerCase() ||
      deployment.deploymentBlock !== env.VITE_DEPLOYMENT_BLOCK ||
      adapter.launchpad?.toLowerCase() !== deployment.launchpad.toLowerCase() ||
      adapter.adapter?.toLowerCase() !==
        env.VITE_ICARUS_SWAP_ADAPTER.toLowerCase() ||
      adapter.codeHash?.toLowerCase() !==
        env.VITE_ICARUS_SWAP_ADAPTER_CODE_HASH.toLowerCase()
    ) {
      throw new Error(
        "RISE mainnet frontend configuration differs from the verified deployment records.",
      );
    }
    for (const [key, value] of Object.entries(env)) {
      if (key.startsWith("VITE_") && typeof value === "string")
        process.env[key] = value;
    }
  }
  return {
    plugins: [
      react(),
      {
        name: "local-artwork-upload",
        configureServer(server) {
          process.env.PINATA_JWT ||= loadEnv(
            mode,
            process.cwd(),
            "PINATA_JWT",
          ).PINATA_JWT;
          server.middlewares.use("/api/artwork", async (req, res) => {
            try {
              const chunks = [];
              for await (const chunk of req) chunks.push(chunk);
              const origin = `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`;
              const request = new Request(`${origin}/api/artwork`, {
                method: req.method,
                headers: req.headers,
                ...(req.method === "POST"
                  ? { body: Buffer.concat(chunks) }
                  : {}),
              });
              const response = await uploadArtwork(request);
              res.writeHead(
                response.status,
                Object.fromEntries(response.headers),
              );
              res.end(Buffer.from(await response.arrayBuffer()));
            } catch {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Artwork upload failed." }));
            }
          });
        },
      },
    ],
    resolve: {
      dedupe: [
        "react",
        "react-dom",
        "wagmi",
        "@wagmi/core",
        "@privy-io/react-auth",
        "@tanstack/react-query",
      ],
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});
