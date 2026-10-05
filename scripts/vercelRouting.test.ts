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
