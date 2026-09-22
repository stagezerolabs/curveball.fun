import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const reset = mock(() => {});
const createToken = mock(async () => ({
  token: "0x1111111111111111111111111111111111111111",
}));

mock.module("../lib/web3", () => ({
  apiUrl: "/api",
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

globalThis.fetch = mock(async () =>
  new Response(JSON.stringify([]), {
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
});

afterAll(() => {
  globalThis.FormData = OriginalFormData;
  globalThis.fetch = OriginalFetch;
  mock.restore();
});
