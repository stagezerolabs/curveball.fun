import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const reset = mock(() => {});
const createToken = mock(async () => ({
  token: "0x1111111111111111111111111111111111111111",
}));

mock.module("../lib/web3", () => ({
  apiUrl: "/api",
  activeChainId: 11155931,
  activeContractVersion: "v1",
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
    contractVersion: "v1",
    launchpadAddress: "0x1111111111111111111111111111111111111111",
  } : []), {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
);

const { useStore } = await import("./useStore.js");
const originalFetchTokens = useStore.getState().fetchTokens;
const testForm = { reset };

describe("token creation form lifecycle", () => {
  beforeEach(() => {
    reset.mockClear();
    createToken.mockClear();
    useStore.setState({ fetchTokens: originalFetchTokens });
    useStore.setState({
      actionError: "",
      isPending: false,
      lastCreatedToken: null,
      loading: false,
      tokens: [],
      tradeMessage: "",
    });
  });

  test("publishes the created token for targeted discovery after the API refresh", async () => {
    let release;
    useStore.setState({ fetchTokens: () => new Promise((resolve) => { release = resolve; }) });
    const event = { preventDefault() {}, currentTarget: testForm };
    const submission = useStore.getState().createToken(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useStore.getState().lastCreatedToken).toBeNull();
    release(true);
    await submission;
    expect(useStore.getState().lastCreatedToken).toBe("0x1111111111111111111111111111111111111111");
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
    expect(await useStore.getState().fetchTokens()).toBe(false);
    expect(useStore.getState().tokens).toEqual([]);
    expect(useStore.getState().marketError).toContain("API");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("reports an API failure so the app can use on-chain discovery only then", async () => {
    globalThis.fetch = mock(async () => new Response("unavailable", { status: 503 }));
    expect(await useStore.getState().fetchTokens()).toBe(false);
  });

  test("keeps discovered markets and asks for chain discovery when the indexer is empty", async () => {
    const discovered = { address: "0x2222222222222222222222222222222222222222", name: "Chain market" };
    useStore.setState({ tokens: [discovered] });
    globalThis.fetch = mock(async (url) => new Response(JSON.stringify(url.endsWith("/health") ? {
      chainId: 11155931,
      contractVersion: "v1",
      launchpadAddress: "0x1111111111111111111111111111111111111111",
    } : []), { status: 200 }));

    expect(await useStore.getState().fetchTokens()).toBe(false);
    expect(useStore.getState().tokens).toEqual([discovered]);
    expect(useStore.getState().marketError).toBe("");
  });
});

afterAll(() => {
  globalThis.FormData = OriginalFormData;
  globalThis.fetch = OriginalFetch;
  mock.restore();
});
