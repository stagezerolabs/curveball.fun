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
    CONTRACT_VERSION: "v1",
    ASSETS: {},
  }, {});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, chainId: 11155931, contractVersion: "v1" });
});
