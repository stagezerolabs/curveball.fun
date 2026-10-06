import { expect, test } from "bun:test";

type Rewrite = { source: string; destination: string };

function route(path: string, rewrites: Rewrite[]): string | undefined {
  for (const { source, destination } of rewrites) {
    if (source === "/api/:path*" && path.startsWith("/api/")) {
      return destination.replace(":path*", path.slice("/api/".length));
    }
    if (source === "/(.*)") return destination;
  }
}

test("Vercel sends API calls to the live V2 backend before the SPA fallback", async () => {
  const config = await Bun.file(new URL("../vercel.json", import.meta.url)).json() as {
    rewrites: Rewrite[];
  };

  expect(route("/api/health", config.rewrites)).toBe(
    "https://curveball-kamicash-7a463851.koyeb.app/api/health",
  );
  expect(route("/api/tokens", config.rewrites)).toBe(
    "https://curveball-kamicash-7a463851.koyeb.app/api/tokens",
  );
  expect(route("/markets/0x1234", config.rewrites)).toBe("/index.html");
});

test("Vercel builds the browser for the recorded V2 testnet deployment", async () => {
  const config = await Bun.file(new URL("../vercel.json", import.meta.url)).json() as {
    buildCommand?: string;
  };
  const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
    scripts: Record<string, string>;
  };
  const deployment = await Bun.file(new URL("../deployments/11155931/curveball-v2.json", import.meta.url)).json();
  expect(config.buildCommand).toBe("bun run build:vercel");
  expect((config.buildCommand ?? "").length).toBeLessThanOrEqual(256);
  const command = packageJson.scripts["build:vercel"] ?? "";
  const variables = Object.fromEntries(
    [...command.matchAll(/\b(VITE_[A-Z_]+)=([^\s]+)/g)].map(([, key, value]) => [key, value]),
  );

  expect(command.endsWith("bun run build")).toBe(true);
  expect(variables).toEqual({
    VITE_CHAIN_ID: String(deployment.chainId),
    VITE_RPC_URL: "https://testnet.riselabs.xyz",
    VITE_CONTRACT_VERSION: deployment.version,
    VITE_LAUNCHPAD_ADDRESS: deployment.factory,
    VITE_DEPLOYMENT_BLOCK: deployment.deploymentBlock,
    VITE_WALLETCONNECT_PROJECT_ID: "831c879216653941caef04cfd3bbc0f0",
  });
});
