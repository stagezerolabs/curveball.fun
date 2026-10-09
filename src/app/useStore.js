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
  activeContractVersion,
  launchpadAddress,
  requireCurveballSdk,
} from "../lib/web3";
import { readableError } from "../lib/errors";
import { convertAsdToWeth, convertMockToWeth } from "../sdk/asdPayment";

const MARKET_CACHE_TTL_MS = 30_000;
let marketsRequest = null;
const tokenRequests = new Map();
const creatorRequests = new Map();

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
    if (!client) {
      set({ loading: false });
      return get().tokens;
    }

    const state = get();
    if (!force && isFresh(state.marketsFetchedAt)) return state.tokens;
    if (marketsRequest) return marketsRequest;

    set({ loading: true, marketError: "" });
    marketsRequest = discoverAllTokens(client)
      .then((discovered) => {
        const fetchedAt = Date.now();
        set((current) => ({
          tokens: mergeTokenLists(current.tokens, discovered),
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
          marketError: current.tokens.length
            ? ""
            : readableError(
                cause,
                "Could not read markets from the configured network.",
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
    if (!client || !address) return null;
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
    const request = discoverToken(client, address)
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
    if (!client || !creator) return [];
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
    const request = discoverCreatorTokens(client, creator)
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
      const out = await requireCurveballSdk().quoteTrade(side, token.address, input);
      set({ quotePreview: out, quoting: false });
    } catch {
      set({ quotePreview: null, quoting: false });
    }
  },

  createToken: async (event) => {
    event.preventDefault();
    const submittedForm = event.currentTarget;
    const { startAction, endAction, handleActionError } = get();
    startAction();
    set({ launchProgress: { phase: "preparing", hash: null, error: "" } });

    try {
      const form = new FormData(submittedForm);
      const input = {
        name: String(form.get("name") ?? ""),
        symbol: String(form.get("symbol") ?? ""),
        uri: String(form.get("uri") ?? ""),
        creatorTaxBps: Number(form.get("creatorTaxBps") ?? 0),
      };
      const initialBuy = String(form.get("initialBuy") ?? "").trim();
      const sdk = requireCurveballSdk();
      const onProgress = (phase, hash = null) => set({ launchProgress: { phase, hash, error: "" } });
      const result = activeContractVersion === "v2" && initialBuy && Number(initialBuy) > 0 && "launchAndBuy" in sdk
        ? await sdk.launchAndBuy(input, parseEther(initialBuy), onProgress)
        : await sdk.createToken(input, onProgress);

      set({
        tradeMessage: `Token created at ${result.token}.`,
        lastCreatedToken: result.token,
        marketsFetchedAt: 0,
      });
      set((state) => {
        const token = { address: result.token, name: input.name.trim(), symbol: input.symbol.trim(), creator: result.creator, graduated: false, createdAt: new Date().toISOString(), indexing: true };
        const tokenKey = cacheKey(result.token);
        const creatorKey = cacheKey(result.creator);
        const creatorWasLoaded = Object.prototype.hasOwnProperty.call(state.creatorTokens, creatorKey);
        return {
          tokenCache: { ...state.tokenCache, [tokenKey]: token },
          tokenFetchedAt: { ...state.tokenFetchedAt, [tokenKey]: 0 },
          tokens: state.marketsFetchedAt
            ? [token, ...state.tokens.filter((item) => cacheKey(item.address) !== tokenKey)]
            : state.tokens,
          creatorTokens: creatorWasLoaded
            ? { ...state.creatorTokens, [creatorKey]: [token, ...state.creatorTokens[creatorKey].filter((item) => cacheKey(item.address) !== tokenKey)] }
            : state.creatorTokens,
          creatorFetchedAt: { ...state.creatorFetchedAt, [creatorKey]: 0 },
        };
      });
      submittedForm.reset();
      set({ launchProgress: { phase: "success", hash: result.hash ?? null, error: "" } });
    } catch (error) {
      handleActionError(error);
      set((state) => ({ launchProgress: { phase: "error", hash: state.launchProgress?.hash ?? null, error: readableError(error, "Token launch failed.") } }));
    } finally {
      endAction();
    }
  },

  trade: async (side, token) => {
    const { amount, startAction, endAction, handleActionError } = get();
    startAction();

    try {
      if (!token)
        throw Error("Select a market and configure the launchpad.");
      const value = Number(amount);
      if (!amount || !Number.isFinite(value) || value <= 0)
        throw Error("Enter an amount greater than zero.");

      const input = parseEther(amount);
      set({ tradeMessage: "Confirming…" });
      const result = await requireCurveballSdk().trade(side, token.address, input);

      const received =
        side === "buy"
          ? `${formatEther(result.quotedOutput)} ${token.symbol}`
          : `${formatEther(result.quotedOutput)} WETH`;
      set({
        tradeMessage: `${side === "buy" ? "Bought" : "Sold"} ~${received}.`,
        quotePreview: null,
        marketsFetchedAt: 0,
      });
      set((state) => ({ tokenFetchedAt: {
        ...state.tokenFetchedAt,
        [cacheKey(token.address)]: 0,
      } }));
    } catch (error) {
      handleActionError(error);
    } finally {
      endAction();
    }
  },

  tradeWithAsd: async (token) => {
    const { amount, startAction, endAction, handleActionError } = get();
    startAction();
    try {
      if (!token) throw Error("Select a market first.");
      const input = parseEther(amount);
      if (input <= 0n) throw Error("Enter an ASD amount greater than zero.");
      const weth = await convertAsdToWeth(input, (message) => set({ tradeMessage: message }));
      set({ tradeMessage: "Confirm WETH approval and curve buy" });
      const result = await requireCurveballSdk().trade("buy", token.address, weth);
      set({
        tradeMessage: `Bought ~${formatEther(result.quotedOutput)} ${token.symbol}.`,
        quotePreview: null,
        marketsFetchedAt: 0,
      });
      set((state) => ({ tokenFetchedAt: { ...state.tokenFetchedAt, [cacheKey(token.address)]: 0 } }));
    } catch (error) {
      handleActionError(error);
    } finally {
      endAction();
    }
  },

  tradeWithMockQuote: async (token, amount) => {
    const { startAction, endAction, handleActionError } = get();
    startAction();
    try {
      const weth = await convertMockToWeth(amount, (message) => set({ tradeMessage: message }));
      set({ tradeMessage: "Confirm WETH approval and curve buy" });
      const result = await requireCurveballSdk().trade("buy", token.address, weth);
      set({ tradeMessage: `Bought ~${formatEther(result.quotedOutput)} ${token.symbol}.`, quotePreview: null, marketsFetchedAt: 0 });
      set((state) => ({ tokenFetchedAt: { ...state.tokenFetchedAt, [cacheKey(token.address)]: 0 } }));
    } catch (error) { handleActionError(error); }
    finally { endAction(); }
  },

  // LpLocker.claim is permissionless: the caller pays gas, the creator and
  // treasury receive the fees. Nothing is routed to whoever clicks this.
  claimPoolFees: async (locker, pool) => {
    const { startAction, endAction, handleActionError } = get();
    startAction();
    try {
      if (!locker || !pool) throw Error("This market has no pool yet.");
      set({ tradeMessage: "Claiming pool fees…" });
      await requireCurveballSdk().claimPoolFees(locker, pool);
      set({
        tradeMessage: activeContractVersion === "v2" ? "Pool fees credited to creator, treasury, and buyback vault." : "Pool fees sent to the creator and treasury.",
        marketsFetchedAt: 0,
      });
    } catch (error) {
      handleActionError(error);
    } finally {
      endAction();
    }
  },

  claimEscrow: async (token, asset, recipient) => {
    const { startAction, endAction, handleActionError } = get();
    startAction();
    try {
      const sdk = requireCurveballSdk();
      if (!("claimEscrow" in sdk)) throw Error("V2 fee escrow is unavailable.");
      await sdk.claimEscrow(token, asset, recipient);
      set({ tradeMessage: "Accrued fees sent to the registered recipient." });
    } catch (error) { handleActionError(error); }
    finally { endAction(); }
  },

  advanceGraduation: async (token) => {
    const { startAction, endAction, handleActionError } = get();
    startAction();
    try {
      if (activeContractVersion !== "v2") throw Error("This market uses the previous graduation flow.");
      const sdk = requireCurveballSdk();
      if (!sdk || !("graduateToIcarus" in sdk)) throw Error("V2 factory is unavailable.");
      const result = await sdk.graduateToIcarus(token.address);
      const poolSuffix = result.pool ? ` — Icarus pool ${result.pool}` : ".";
      const tradeMessage = result.status === "deferred"
        ? result.deferredReason
          ? `Graduation deferred: ${result.deferredReason}. Trading remains open; try again later.`
          : "Graduation deferred. Trading remains open; try again later."
        : result.already
          ? `This market already graduated${poolSuffix}`
          : `Graduated to Icarus${poolSuffix}`;
      set((state) => ({
        tradeMessage,
        marketsFetchedAt: 0,
        tokenFetchedAt: {
          ...state.tokenFetchedAt,
          [cacheKey(token.address)]: 0,
        },
      }));
    } catch (error) {
      handleActionError(error);
    } finally {
      endAction();
    }
  },

  startAction: () =>
    set({ isPending: true, actionError: "", tradeMessage: "" }),
  endAction: () => set({ isPending: false }),
  handleActionError: (error) =>
    set({
      actionError: readableError(error, "Transaction failed. Please try again."),
      isPending: false,
      tradeMessage: "",
    }),
}), {
  name: `curveball-chain-cache:${activeChainId}:${launchpadAddress ?? "unconfigured"}:${activeContractVersion}`,
  version: 2,
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({
    tokens: state.tokens,
    marketsFetchedAt: state.marketsFetchedAt,
    tokenCache: state.tokenCache,
    tokenFetchedAt: state.tokenFetchedAt,
    creatorTokens: state.creatorTokens,
    creatorFetchedAt: state.creatorFetchedAt,
  }),
  merge: (persisted, current) => ({
    ...current,
    ...persisted,
  }),
}));
