import { expect, mock, test } from "bun:test";

class MockClient {
    async connect() {}
    async end() {}
    async query() { return { rows: [{ '?column?': 1 }] }; }
}

mock.module("pg", () => ({ Client: MockClient, default: { Client: MockClient } }));

test("Cloudflare V1 health identifies its contract version to the frontend", async () => {
  const { default: worker } = await import("./worker");
  const response = await worker.fetch(new Request("http://localhost/api/health"), {
    DB: { connectionString: "postgresql://example.invalid/curveball" },
    EXPECTED_CHAIN_ID: "11155931",
    CONTRACT_VERSION: "v1" as const,
    ASSETS: {},
  }, {});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, chainId: 11155931, contractVersion: "v1" });
});

test("Cloudflare serves static assets and falls back to the SPA entrypoint", async () => {
  const { default: worker } = await import("./worker");
  const requested: string[] = [];
  const env = {
    DB: { connectionString: "postgresql://example.invalid/curveball" },
    EXPECTED_CHAIN_ID: "11155931",
    CONTRACT_VERSION: "v1" as const,
    ASSETS: {
      async fetch(request: Request) {
        requested.push(request.url);
        return new URL(request.url).pathname === "/index.html"
          ? new Response("app", { status: 200 })
          : new Response("missing", { status: 404 });
      },
    },
  };
  const response = await worker.fetch(new Request("https://curveball.example/markets"), env, {});
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("app");
  expect(requested).toEqual(["https://curveball.example/markets", "https://curveball.example/index.html"]);
});

test("Cloudflare does not expose curve trade estimates as wallet holdings", async () => {
  const { default: worker } = await import("./worker");
  const response = await worker.fetch(new Request("https://curveball.example/api/tokens/0x1111111111111111111111111111111111111111/holders"), {
    DB: { connectionString: "postgresql://example.invalid/curveball" },
    EXPECTED_CHAIN_ID: "11155931",
    CONTRACT_VERSION: "v1",
    ASSETS: {},
  }, {});
  expect(response.status).toBe(501);
  expect(await response.json()).toMatchObject({ error: "Wallet holdings are not indexed yet." });
});
