import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const reset = mock(() => {});
const createToken = mock(async () => ({
  token: "0x1111111111111111111111111111111111111111",
}));

mock.module("../lib/web3", () => ({
  apiUrl: "/api",
  activeChainId: 11155931,
  launchpadAddress: "0x1111111111111111111111111111111111111111",
  requireCurveballSdk: () => ({ createToken }),
}));

const OriginalFormData = globalThis.FormData;
const OriginalFetch = globalThis.fetch;

globalThis.FormData = class {
  constructor(form) {
    if (form !== testForm) throw new Error("unexpected form");
  }

  get(name) {
    return { name: "LONGNICO", symbol: "NICO", uri: "" }[name] ?? null;
  }
};

globalThis.fetch = mock(async (url) =>
  new Response(JSON.stringify(url.endsWith("/health") ? {
    chainId: 11155931,
    launchpadAddress: "0x1111111111111111111111111111111111111111",
  } : []), {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
);

const { useStore } = await import("./useStore.js");
const testForm = { reset };

describe("token creation form lifecycle", () => {
  beforeEach(() => {
    reset.mockClear();
    createToken.mockClear();
    useStore.setState({
      actionError: "",
      isPending: false,
      lastCreatedToken: null,
      loading: false,
      tokens: [],
      tradeMessage: "",
    });
  });

  test("resets the submitted form after an asynchronous wallet transaction", async () => {
    let currentTarget = testForm;
    const event = {
      preventDefault() {},
      get currentTarget() {
        return currentTarget;
      },
    };

    const submission = useStore.getState().createToken(event);
    currentTarget = null;
    await submission;

    expect(useStore.getState().actionError).toBe("");
    expect(reset).toHaveBeenCalledTimes(1);
  });

  test("merges on-chain launches without replacing richer API market data", () => {
    const address = "0x1111111111111111111111111111111111111111";
    useStore.setState({
      tokens: [{ address, name: "API name", symbol: "API", marketCapUsd: 42 }],
    });

    useStore.getState().mergeTokens([
      { address, name: "Chain name", symbol: "CHAIN" },
      {
        address: "0x2222222222222222222222222222222222222222",
        name: "New chain token",
        symbol: "NEW",
      },
    ]);

    expect(useStore.getState().tokens).toHaveLength(2);
    expect(useStore.getState().tokens[0]).toMatchObject({
      name: "API name",
      marketCapUsd: 42,
    });
  });

  test("rejects indexed markets from another deployment", async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      chainId: 4153,
      launchpadAddress: "0x2222222222222222222222222222222222222222",
    }), { status: 200 }));
    await useStore.getState().fetchTokens();
    expect(useStore.getState().tokens).toEqual([]);
    expect(useStore.getState().marketError).toContain("API");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

afterAll(() => {
  globalThis.FormData = OriginalFormData;
  globalThis.fetch = OriginalFetch;
  mock.restore();
});
