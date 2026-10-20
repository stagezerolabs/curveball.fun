import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { formatEther, parseEther } from "viem";
import {
  discoverAllTokens,
  discoverCreatorTokens,
  discoverToken,
} from "../creatorTokens";
import {
  activeChainId,
  launchpadAddress,
  requireCurveballSdk,
} from "../lib/web3";
import { readableError } from "../lib/errors";
import { PendingTransactionError } from "../sdk/sdk";
import { hasPublishedArtwork } from "../lib/launchForm";
import { sdkForMarket } from "../lib/marketFactories";
import { fetchCreatorMarkets, fetchMarket as fetchIndexedMarket, fetchMarkets as fetchIndexedMarkets } from "../markets/api";
import { socialApiBaseUrl } from "../social/api";

const MARKET_CACHE_TTL_MS = 30_000;
let marketsRequest = null;
const tokenRequests = new Map();
const creatorRequests = new Map();

// The market cache can hold hundreds of tokens; zustand serializes and writes it
// synchronously on every set(), and polling updates tokenLoading/tokenFetchedAt
// a dozen times a minute. Batching writes into one commit every few seconds (and
// flushing when the tab hides) removes that main-thread jank on the market pages.
function createDebouncedLocalStorage(delayMs = 3_000) {
  let pending = null;
  let timer = null;
  let flushBound = false;

  const commit = () => {
    timer = null;
    if (!pending) return;
    const { name, value } = pending;
    pending = null;
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Quota or blocked storage: the in-memory store keeps working regardless.
    }
  };

  const flush = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    commit();
  };

  const schedule = () => {
    if (timer !== null) return;
    if (!flushBound && typeof window !== "undefined" && typeof document !== "undefined") {
      flushBound = true;
      window.addEventListener("pagehide", flush);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
      });
    }
    timer = window.setTimeout(commit, delayMs);
  };

  return {
    getItem: (name) => {
      try {
        return window.localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending = { name, value };
      schedule();
    },
    removeItem: (name) => {
      if (pending?.name === name) pending = null;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      try {
        window.localStorage.removeItem(name);
      } catch {
        // Ignore storage errors; the in-memory store is unaffected.
      }
    },
  };
}

const cacheKey = (address) => address.toLowerCase();
const isFresh = (fetchedAt) =>
  Boolean(fetchedAt) && Date.now() - fetchedAt < MARKET_CACHE_TTL_MS;

function cacheTokens(current, discovered, fetchedAt = Date.now()) {
  const tokenCache = { ...current.tokenCache };
  const tokenFetchedAt = { ...current.tokenFetchedAt };
  for (const token of discovered) {
    const key = cacheKey(token.address);
    tokenCache[key] = token;
    tokenFetchedAt[key] = fetchedAt;
  }
  return { tokenCache, tokenFetchedAt };
}

function mergeTokenLists(current, discovered) {
  const merged = new Map(
    discovered.map((token) => [token.address.toLowerCase(), token]),
  );
  for (const token of current) {
    if (!merged.has(token.address.toLowerCase())) {
      merged.set(token.address.toLowerCase(), token);
    }
  }
  return [...merged.values()];
}

export function rehydrateMarketCache(persisted, current) {
  const configured = (token) => token?.factory?.toLowerCase() === launchpadAddress?.toLowerCase();
  const tokens = validCachedTokens(persisted?.tokens).filter(configured);
  const tokenCache = Object.fromEntries(Object.entries(persisted?.tokenCache ?? {}).filter(([, token]) => configured(token)));
  const creatorTokens = Object.fromEntries(Object.entries(persisted?.creatorTokens ?? {}).map(([creator, entries]) => [creator, validCachedTokens(entries).filter(configured)]));
  return { ...current, ...persisted, tokens, tokenCache, creatorTokens, marketsFetchedAt: 0 };
}

const validCachedTokens = (tokens) => Array.isArray(tokens)
  ? tokens.filter((item) => typeof item?.address === "string")
  : [];

export function createdTokenCacheUpdate(state, token) {
  const tokenKey = cacheKey(token.address);
  const creatorKey = cacheKey(token.creator);
  const creatorTokens = state.creatorTokens && typeof state.creatorTokens === "object" ? state.creatorTokens : {};
  const creatorWasLoaded = Object.prototype.hasOwnProperty.call(creatorTokens, creatorKey);
  return {
    tokenCache: { ...state.tokenCache, [tokenKey]: token },
    tokenFetchedAt: { ...state.tokenFetchedAt, [tokenKey]: 0 },
    tokens: state.marketsFetchedAt
      ? [token, ...validCachedTokens(state.tokens).filter((item) => cacheKey(item.address) !== tokenKey)]
      : state.tokens,
    creatorTokens: creatorWasLoaded
      ? { ...creatorTokens, [creatorKey]: [token, ...validCachedTokens(creatorTokens[creatorKey]).filter((item) => cacheKey(item.address) !== tokenKey)] }
      : creatorTokens,
    creatorFetchedAt: { ...state.creatorFetchedAt, [creatorKey]: 0 },
  };
}

function cachedBigInt(value) {
  try {
    return typeof value === "string" ? BigInt(value) : null;
  } catch {
    return null;
  }
}

export function confirmedTradeCacheUpdate(state, token, marketState, fetchedAt = Date.now()) {
  const tokenKey = cacheKey(token.address);
  const creatorKey = cacheKey(token.creator);
  const invalidated = {
    marketsFetchedAt: 0,
    creatorFetchedAt: { ...state.creatorFetchedAt, [creatorKey]: 0 },
  };

  if (!marketState) {
    return {
      ...invalidated,
      tokenFetchedAt: { ...state.tokenFetchedAt, [tokenKey]: 0 },
    };
  }

  const curveSupply = cachedBigInt(token.curveSupply);
  const supply = cachedBigInt(token.supply);
  const price = marketState.virtualToken === 0n
    ? null
    : Number(formatEther(marketState.virtualQuote)) / Number(formatEther(marketState.virtualToken));
  const impliedSupply = token.price && token.marketCap != null
    ? token.marketCap / token.price
    : null;
  const supplyAmount = supply === null ? impliedSupply : Number(formatEther(supply));
  const marketUpdate = {
    price,
    marketCap: price === null || supplyAmount === null ? token.marketCap : price * supplyAmount,
    progress: curveSupply === null || curveSupply === 0n
      ? token.progress
      : Number((marketState.sold * 10_000n) / curveSupply) / 100,
    pending: curveSupply === null ? token.pending : marketState.sold >= curveSupply,
  };
  const updateToken = (cached) => cacheKey(cached.address) === tokenKey
    ? { ...cached, ...marketUpdate }
    : cached;
  const cachedToken = state.tokenCache[tokenKey] ?? token;
  const creatorTokensByCreator = state.creatorTokens && typeof state.creatorTokens === "object"
    ? state.creatorTokens
    : {};
  const creatorTokens = Object.fromEntries(
    Object.entries(creatorTokensByCreator).map(([key, tokens]) => [
      key,
      validCachedTokens(tokens).map(updateToken),
    ]),
  );

  return {
    ...invalidated,
    tokens: validCachedTokens(state.tokens).map(updateToken),
    tokenCache: { ...state.tokenCache, [tokenKey]: updateToken(cachedToken) },
    tokenFetchedAt: { ...state.tokenFetchedAt, [tokenKey]: fetchedAt },
    creatorTokens,
  };
}

export function confirmedTradeStateUpdate(state, side, token, result) {
  const received = side === "buy"
    ? `${formatEther(result.quotedOutput)} ${token.symbol}`
    : `${formatEther(result.quotedOutput)} WETH`;
  return {
    ...confirmedTradeCacheUpdate(state, token, result.marketState),
    tradeMessage: `${side === "buy" ? "Bought" : "Sold"} ~${received}.`,
    quotePreview: null,
  };
}

export const useStore = create(persist((set, get) => ({
  tokens: [],
  loading: false,
  marketsFetchedAt: 0,
  marketError: "",
  tokenCache: {},
  tokenFetchedAt: {},
  tokenLoading: {},
  tokenErrors: {},
  creatorTokens: {},
  creatorFetchedAt: {},
  creatorLoading: {},
  creatorErrors: {},
  actionError: "",
  tradeMessage: "",
  tradeProgress: null,
  amount: "0",
  side: "buy",
  isPending: false,
  quotePreview: null,
  quoting: false,
  lastCreatedToken: null,
  launchProgress: null,

  setAmount: (amount) => set({ amount, quotePreview: null }),
  setSide: (side) => set({ side, quotePreview: null }),
  setActionError: (actionError) => set({ actionError }),
  clearLaunchProgress: () => set({ launchProgress: null }),
  mergeTokens: (discovered) =>
    set((state) => {
      return {
        tokens: mergeTokenLists(state.tokens, discovered),
        ...cacheTokens(state, discovered),
        marketError: "",
      };
    }),

  loadMarkets: async (client, { force = false } = {}) => {
    const backendEnabled = Boolean(socialApiBaseUrl);
    if (!client && !backendEnabled) {
      set({ loading: false });
      return get().tokens;
    }

    const state = get();
    if (!force && isFresh(state.marketsFetchedAt)) return state.tokens;
    if (marketsRequest) return marketsRequest;

    set({ loading: true, marketError: "" });
    marketsRequest = (backendEnabled ? fetchIndexedMarkets() : discoverAllTokens(client, (discovered) => {
      if (!discovered.length) return;
      set((current) => ({
        tokens: mergeTokenLists(current.tokens, discovered),
        ...cacheTokens(current, discovered),
      }));
    }))
      .then((discovered) => {
        const fetchedAt = Date.now();
        set((current) => ({
          tokens: backendEnabled
            ? mergeTokenLists(current.tokens.filter((token) => token.indexing), discovered)
            : discovered,
          ...cacheTokens(current, discovered, fetchedAt),
          loading: false,
          marketsFetchedAt: fetchedAt,
          marketError: "",
        }));
        return get().tokens;
      })
      .catch((cause) => {
        set((current) => ({
          loading: false,
          marketError: readableError(
            cause,
            current.tokens.length
              ? "Could not refresh markets. Showing saved data; try again."
              : "Could not read markets from the configured network.",
          ),
        }));
        throw cause;
      })
      .finally(() => {
        marketsRequest = null;
      });

    return marketsRequest;
  },

  loadToken: async (client, address, { force = false } = {}) => {
    const backendEnabled = Boolean(socialApiBaseUrl);
    if ((!client && !backendEnabled) || !address) return null;
    const key = cacheKey(address);
    const state = get();
    if (!force && isFresh(state.tokenFetchedAt[key])) {
      return state.tokenCache[key] ?? null;
    }
    if (tokenRequests.has(key)) return tokenRequests.get(key);

    set((current) => ({
      tokenLoading: { ...current.tokenLoading, [key]: true },
      tokenErrors: { ...current.tokenErrors, [key]: "" },
    }));
    const request = (backendEnabled ? fetchIndexedMarket(address) : discoverToken(client, address))
      .then((token) => {
        const fetchedAt = Date.now();
        set((current) => ({
          tokenCache: { ...current.tokenCache, [key]: token },
          tokenFetchedAt: { ...current.tokenFetchedAt, [key]: fetchedAt },
          tokenLoading: { ...current.tokenLoading, [key]: false },
          tokenErrors: { ...current.tokenErrors, [key]: "" },
          tokens: token && current.marketsFetchedAt
            ? mergeTokenLists(current.tokens, [token])
            : current.tokens,
        }));
        return token;
      })
      .catch((cause) => {
        set((current) => ({
          tokenLoading: { ...current.tokenLoading, [key]: false },
          tokenErrors: {
            ...current.tokenErrors,
            [key]: readableError(
              cause,
              "Could not read this market from the configured network.",
            ),
          },
        }));
        throw cause;
      })
      .finally(() => tokenRequests.delete(key));
    tokenRequests.set(key, request);
    return request;
  },

  loadCreatorTokens: async (client, creator, { force = false } = {}) => {
    const backendEnabled = Boolean(socialApiBaseUrl);
    if ((!client && !backendEnabled) || !creator) return [];
    const key = cacheKey(creator);
    const state = get();
    if (!force && isFresh(state.creatorFetchedAt[key])) {
      return state.creatorTokens[key] ?? [];
    }
    if (creatorRequests.has(key)) return creatorRequests.get(key);

    set((current) => ({
      creatorLoading: { ...current.creatorLoading, [key]: true },
      creatorErrors: { ...current.creatorErrors, [key]: "" },
    }));
    const request = (backendEnabled ? fetchCreatorMarkets(creator) : discoverCreatorTokens(client, creator))
      .then((tokens) => {
        const fetchedAt = Date.now();
        set((current) => ({
          creatorTokens: { ...current.creatorTokens, [key]: tokens },
          creatorFetchedAt: { ...current.creatorFetchedAt, [key]: fetchedAt },
          creatorLoading: { ...current.creatorLoading, [key]: false },
          creatorErrors: { ...current.creatorErrors, [key]: "" },
          ...cacheTokens(current, tokens, fetchedAt),
        }));
        return tokens;
      })
      .catch((cause) => {
        set((current) => ({
          creatorLoading: { ...current.creatorLoading, [key]: false },
          creatorErrors: {
            ...current.creatorErrors,
            [key]: readableError(
              cause,
              "Could not read this wallet's launches from the configured network.",
            ),
          },
        }));
        throw cause;
      })
      .finally(() => creatorRequests.delete(key));
    creatorRequests.set(key, request);
    return request;
  },

  invalidateMarkets: () => set({ marketsFetchedAt: 0 }),

  fetchQuote: async (token) => {
    const { amount, side } = get();
    const value = Number(amount);
    if (
      !token ||
      !amount ||
      !Number.isFinite(value) ||
      value <= 0
    ) {
      set({ quotePreview: null, quoting: false });
      return;
    }
    set({ quoting: true });
    try {
      const input = parseEther(amount);
      const out = await sdkForMarket(token.factory).quoteTrade(side, token.address, input);
      set({ quotePreview: out, quoting: false });
    } catch {
      set({ quotePreview: null, quoting: false });
    }
  },

  createToken: async (event) => {
    event.preventDefault();
    const submittedForm = event.currentTarget;
    const form = new FormData(submittedForm);
    const input = {
      name: String(form.get("name") ?? ""),
      symbol: String(form.get("symbol") ?? ""),
      uri: String(form.get("uri") ?? ""),
      creatorTaxBps: Number(form.get("creatorTaxBps") ?? 0),
      holderReserveBps: Number(form.get("holderReserveBps") ?? 0),
    };
    // The launchpad rejects an empty metadata URI, and metadata is published with the artwork.
    if (!hasPublishedArtwork(input.uri)) {
      set({ launchProgress: { phase: "error", hash: null, error: "Add artwork and wait for it to finish publishing before launching." } });
      return;
    }
    const { startAction, endAction, handleActionError } = get();
    startAction();
    set({ launchProgress: { phase: "preparing", hash: null, error: "" } });

    try {
      const initialBuy = String(form.get("initialBuy") ?? "").trim();
      const sdk = requireCurveballSdk();
      const onProgress = (phase, hash = null) => set({ launchProgress: { phase, hash, error: "" } });
      const result = initialBuy && Number(initialBuy) > 0
        ? await sdk.launchAndBuy(input, parseEther(initialBuy), onProgress)
        : await sdk.createToken(input, onProgress);

      try {
        const token = { address: result.token, factory: launchpadAddress, name: input.name.trim(), symbol: input.symbol.trim(), creator: result.creator, graduated: false, createdAt: new Date().toISOString(), metadataUri: input.uri || null, indexing: true };
        set((state) => ({
          ...createdTokenCacheUpdate(state, token),
          tradeMessage: `Token created at ${result.token}.`,
          lastCreatedToken: result.token,
          marketsFetchedAt: 0,
        }));
        submittedForm.reset();
      } catch {
        // A confirmed transaction cannot be undone by a stale browser cache.
        set({ lastCreatedToken: result.token, marketsFetchedAt: 0 });
      }
      set({ launchProgress: { phase: "success", hash: result.hash ?? null, error: "" } });
    } catch (error) {
      handleActionError(error);
      set((state) => ({ launchProgress: {
        phase: error instanceof PendingTransactionError ? "pending" : "error",
        hash: state.launchProgress?.hash ?? null,
        error: readableError(error, "Token launch failed."),
      } }));
    } finally {
      endAction();
    }
  },

  trade: async (side, token) => {
    const { amount, startAction, endAction, handleActionError } = get();
    startAction();
    set({ tradeProgress: { side, phase: "preparing" } });

    try {
      if (!token)
        throw Error("Select a market and configure the launchpad.");
      const value = Number(amount);
      if (!amount || !Number.isFinite(value) || value <= 0)
        throw Error("Enter an amount greater than zero.");

      const input = parseEther(amount);
      const result = await sdkForMarket(token.factory).trade(side, token.address, input, (phase) => {
        set({ tradeProgress: { side, phase } });
      });

      set((state) => confirmedTradeStateUpdate(state, side, token, result));
    } catch (error) {
      handleActionError(error);
    } finally {
      endAction();
    }
  },

  // Permissionless market actions: the caller pays gas, and nothing is routed to whoever clicks.
  // CurveLpLocker.claim sends LP fees to the escrow for the market's split; buyback spends one paced
  // chunk of the market's buyback balance and burns what it buys; graduate seeds a sold-out pool.
  claimPoolFees: (pool, factory) =>
    get().runMarketAction(factory, (sdk) => {
      if (!pool) throw Error("This market has no pool yet.");
      return sdk.claimPoolFees(pool);
    }, "Claiming pool fees…", "Pool fees credited to the creator, treasury, and buyback."),

  runBuyback: (token, factory) =>
    get().runMarketAction(factory, (sdk) => sdk.buyback(token),
      "Running the buyback…", "Buyback submitted. It skips without spending when the pool price is unsafe."),

  graduateMarket: (token, factory) =>
    get().runMarketAction(factory, (sdk) => sdk.graduate(token),
      "Graduating the market…", "Market graduated into its pool."),

  // Escrow and reserve claims pay the connected wallet: creator fees across all of its launches,
  // and its holder-reserve share of one graduated token.
  claimEscrow: (asset, factory) =>
    get().runMarketAction(factory, (sdk) => sdk.claimEscrow(asset),
      "Claiming fees…", "Fees sent to your wallet."),

  claimReserve: (token, factory) =>
    get().runMarketAction(factory, (sdk) => sdk.claimReserve(token),
      "Claiming your holder reserve…", "Holder reserve sent to your wallet."),

  runMarketAction: async (factory, action, progressMessage, doneMessage) => {
    const { startAction, endAction, handleActionError } = get();
    startAction();
    try {
      set({ tradeMessage: progressMessage });
      await action(sdkForMarket(factory));
      set({ tradeMessage: doneMessage, marketsFetchedAt: 0 });
    } catch (error) {
      handleActionError(error);
    } finally {
      endAction();
    }
  },

  startAction: () =>
    set({ isPending: true, actionError: "", tradeMessage: "", tradeProgress: null }),
  endAction: () => set({ isPending: false, tradeProgress: null }),
  handleActionError: (error) =>
    set({
      actionError: readableError(error, "Transaction failed. Please try again."),
      isPending: false,
      tradeMessage: "",
    }),
}), {
  name: `curveball-chain-cache:${activeChainId}:${launchpadAddress ?? "unconfigured"}:current`,
  version: 5,
  storage: createJSONStorage(() => createDebouncedLocalStorage()),
  partialize: (state) => ({
    tokens: state.tokens,
    marketsFetchedAt: state.marketsFetchedAt,
    tokenCache: state.tokenCache,
    tokenFetchedAt: state.tokenFetchedAt,
    creatorTokens: state.creatorTokens,
    creatorFetchedAt: state.creatorFetchedAt,
  }),
  merge: rehydrateMarketCache,
}));
