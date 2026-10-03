import { expect, test } from "bun:test";
import { createRnsClient } from "./rns";

const address = "0x78d2e9d2b81d94ed27310d61e5f9e1c4db35fba5";
const otherAddress = "0x1111111111111111111111111111111111111111";
const shortAddress = "0x78d…fba5";
const reverse = {
  chainId: 4153,
  address,
  primaryName: "werise.rise",
  resolvedAddress: address,
  isExpired: false,
};

test("returns a validated primary RISE name for a wallet", async () => {
  const requests: string[] = [];
  const client = createRnsClient({
    fetchFn: async (input) => {
      requests.push(String(input));
      return Response.json({
        chainId: 4153,
        address,
        primaryName: "werise.rise",
        resolvedAddress: address,
        isExpired: false,
      });
    },
  });

  expect(await client.getReverse(address)).toEqual({
    address,
    displayName: "werise.rise",
    names: [],
    indexedAt: null,
  });
  expect(requests).toEqual([`https://rns.stage0.xyz/v1/reverse/${address}`]);
});

test("uses the address fallback when no primary name exists", async () => {
  const client = createRnsClient({ fetchFn: async () => Response.json({ ...reverse, primaryName: null }) });
  expect((await client.getReverse(address)).displayName).toBeNull();
  expect(await client.getWalletLabel(address)).toBe(shortAddress);
});

test("rejects a wrong chain, expired name, or mismatched resolution", async () => {
  for (const change of [
    { chainId: 1 },
    { isExpired: true },
    { resolvedAddress: otherAddress },
  ]) {
    const client = createRnsClient({ fetchFn: async () => Response.json({ ...reverse, ...change }) });
    expect(await client.getWalletLabel(address)).toBe(shortAddress);
  }
});

test("rejects malformed reverse fields and an invalid name", async () => {
  for (const payload of [
    { ...reverse, address: otherAddress },
    { ...reverse, primaryName: "Upper.rise" },
    { ...reverse, primaryName: "too.long.a.rise" },
    { ...reverse, primaryName: 42 },
    { ...reverse, resolvedAddress: 42 },
    { ...reverse, isExpired: "false" },
    [],
  ]) {
    const client = createRnsClient({ fetchFn: async () => Response.json(payload), log: () => {} });
    expect(await client.getWalletLabel(address)).toBe(shortAddress);
  }
});

test("validates addresses before making requests", async () => {
  let calls = 0;
  const client = createRnsClient({ fetchFn: async () => { calls++; return Response.json(reverse); }, log: () => {} });
  expect(await client.getWalletLabel("not-an-address")).toBe("not-an-address");
  expect(calls).toBe(0);
});

test("uses fallback for HTTP 400, 404, and 500 and logs header request ID first", async () => {
  for (const status of [400, 404, 500]) {
    const logs: string[] = [];
    const client = createRnsClient({
      fetchFn: async () => Response.json({ error: "unavailable", requestId: "body-id" }, {
        status,
        headers: { "X-Request-Id": "header-id" },
      }),
      log: (message) => logs.push(message),
    });
    expect(await client.getWalletLabel(address)).toBe(shortAddress);
    expect(logs).toEqual([`Stage0 RNS HTTP ${status} requestId=header-id`]);
  }
});

test("uses an error body request ID when the header is absent", async () => {
  const logs: string[] = [];
  const client = createRnsClient({
    fetchFn: async () => Response.json({ error: "invalid_address", requestId: "body-id" }, { status: 400 }),
    log: (message) => logs.push(message),
  });
  await client.getWalletLabel(address);
  expect(logs).toEqual(["Stage0 RNS HTTP 400 requestId=body-id"]);
});

test("respects Retry-After on HTTP 429 before trying again", async () => {
  let now = 1_000;
  let calls = 0;
  const client = createRnsClient({
    now: () => now,
    fetchFn: async () => {
      calls++;
      return calls === 1
        ? Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "3" } })
        : Response.json(reverse);
    },
    log: () => {},
  });
  expect(await client.getWalletLabel(address)).toBe(shortAddress);
  now += 2_999;
  expect(await client.getWalletLabel(address)).toBe(shortAddress);
  expect(calls).toBe(1);
  now++;
  expect(await client.getWalletLabel(address)).toBe("werise.rise");
  expect(calls).toBe(2);
});

test("uses a short cooldown when a 429 has no Retry-After", async () => {
  let calls = 0;
  const client = createRnsClient({
    now: () => 1_000,
    fetchFn: async () => { calls++; return Response.json({ error: "rate_limited" }, { status: 429 }); },
    log: () => {},
  });
  expect(await client.getWalletLabel(address)).toBe(shortAddress);
  expect(await client.getWalletLabel(otherAddress)).toBe("0x111…1111");
  expect(calls).toBe(1);
});

test("uses fallback for network rejection, timeout, and invalid JSON", async () => {
  const failureClients = [
    createRnsClient({ fetchFn: async () => { throw new Error("offline"); }, log: () => {} }),
    createRnsClient({
      fetchFn: async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
      timeoutMs: 1,
      log: () => {},
    }),
    createRnsClient({ fetchFn: async () => new Response("{", { status: 200 }), log: () => {} }),
  ];
  for (const client of failureClients) expect(await client.getWalletLabel(address)).toBe(shortAddress);
});

test("caches successful reverse responses for 15 seconds and refetches afterward", async () => {
  let now = 1_000;
  let calls = 0;
  const client = createRnsClient({
    now: () => now,
    fetchFn: async () => {
      calls++;
      return Response.json({ ...reverse, primaryName: calls === 1 ? "werise.rise" : "updated.rise" });
    },
  });
  expect(await client.getWalletLabel(address)).toBe("werise.rise");
  now += 14_999;
  expect(await client.getWalletLabel(address)).toBe("werise.rise");
  expect(calls).toBe(1);
  now++;
  expect(await client.getWalletLabel(address)).toBe("updated.rise");
  expect(calls).toBe(2);
});

test("does not retain HTTP errors in the success cache", async () => {
  let calls = 0;
  const client = createRnsClient({
    fetchFn: async () => {
      calls++;
      return calls === 1 ? Response.json({ error: "server" }, { status: 500 }) : Response.json(reverse);
    },
    log: () => {},
  });
  expect(await client.getWalletLabel(address)).toBe(shortAddress);
  expect(await client.getWalletLabel(address)).toBe("werise.rise");
  expect(calls).toBe(2);
});

test("coalesces concurrent duplicate lookups for the same lowercase address", async () => {
  let calls = 0;
  let release: ((response: Response) => void) | undefined;
  const client = createRnsClient({
    fetchFn: async () => {
      calls++;
      return new Promise<Response>((resolve) => { release = resolve; });
    },
  });
  const first = client.getWalletLabel(address);
  const second = client.getWalletLabel(address.toUpperCase().replace(/^0X/, "0x"));
  expect(calls).toBe(1);
  release?.(Response.json(reverse));
  expect(await Promise.all([first, second])).toEqual(["werise.rise", "werise.rise"]);
});

test("normalizes owned names and ignores unknown upstream fields", async () => {
  const client = createRnsClient({
    baseUrl: "https://example.test/v1/",
    fetchFn: async (input) => {
      expect(input).toBe(`https://example.test/v1/addresses/${address}/names`);
      return Response.json({
        chainId: 4153,
        owner: address,
        count: 1,
        names: [{ name: "werise.rise", owner: address, resolvedAddress: address,
          expiry: "1820072349", custody: "marketplace", lastIndexedAt: "2026-09-19T14:05:30.446Z", extra: "ignored" }],
      });
    },
  });
  expect(await client.getOwnedNames(address)).toEqual({
    address,
    displayName: null,
    names: [{ name: "werise.rise", custody: "marketplace", resolvedAddress: address, expiresAt: "1820072349" }],
    indexedAt: "2026-09-19T14:05:30.446Z",
  });
});

test("caches successful owned-name reads independently of reverse reads", async () => {
  let calls = 0;
  const client = createRnsClient({
    fetchFn: async (input) => {
      calls++;
      return input.includes("/reverse/")
        ? Response.json(reverse)
        : Response.json({ chainId: 4153, owner: address, count: 0, names: [] });
    },
  });
  await client.getOwnedNames(address);
  await client.getOwnedNames(address);
  await client.getReverse(address);
  expect(calls).toBe(2);
});

test("owned names: empty list is normal; malformed top-level and item shapes fall back", async () => {
  const empty = createRnsClient({ fetchFn: async () => Response.json({ chainId: 4153, owner: address, count: 0, names: [] }) });
  expect((await empty.getOwnedNames(address)).names).toEqual([]);
  for (const payload of [
    { chainId: 1, owner: address, count: 0, names: [] },
    { chainId: 4153, owner: address, count: 1, names: [] },
    { chainId: 4153, owner: address, count: 1, names: [{ name: "Bad.rise" }] },
  ]) {
    const client = createRnsClient({ fetchFn: async () => Response.json(payload), log: () => {} });
    expect((await client.getOwnedNames(address)).names).toEqual([]);
  }
});
