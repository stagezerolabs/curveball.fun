import { create } from "zustand";
import { formatEther, parseEther } from "viem";
import { activeChainId, activeContractVersion, apiUrl, launchpadAddress, requireCurveballSdk } from "../lib/web3";

export const useStore = create((set, get) => ({
  tokens: [],
  loading: true,
  marketError: "",
  actionError: "",
  tradeMessage: "",
  amount: "1",
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
      const merged = new Map(
        discovered.map((token) => [token.address.toLowerCase(), token]),
      );
      for (const token of state.tokens) {
        if (!merged.has(token.address.toLowerCase()) || !token.indexing) merged.set(token.address.toLowerCase(), token);
      }
      return { tokens: [...merged.values()], marketError: "" };
    }),

  fetchTokens: async () => {
    set({ loading: true, marketError: "" });
    try {
      const healthResponse = await fetch(`${apiUrl}/health`);
      if (!healthResponse.ok) throw new Error("API health failure");
      const health = await healthResponse.json();
      if (health.chainId !== activeChainId || health.contractVersion !== activeContractVersion || health.launchpadAddress?.toLowerCase() !== launchpadAddress?.toLowerCase()) {
        throw new Error("API deployment does not match the wallet network");
      }
      const response = await fetch(`${apiUrl}/tokens`);
      if (!response.ok) throw new Error("API failure");
      const tokens = await response.json();
      set((state) => {
        const created = state.lastCreatedToken && state.tokens.find((token) => token.address.toLowerCase() === state.lastCreatedToken.toLowerCase());
        const includesCreated = created && tokens.some((token) => token.address.toLowerCase() === created.address.toLowerCase());
        return { tokens: tokens.length ? [...tokens, ...(created && !includesCreated ? [created] : [])] : state.tokens, loading: false };
      });
      return tokens.length > 0;
    } catch (error) {
      set({
        marketError:
          "Markets are taking a breather. Check the API and try again.",
        loading: false,
      });
      return false;
    }
  },

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
        launchProgress: { phase: "indexing", hash: result.hash ?? null, error: "" },
      });
      set((state) => ({ tokens: [
        { address: result.token, name: input.name.trim(), symbol: input.symbol.trim(), creator: result.creator, graduated: false, createdAt: new Date().toISOString(), indexing: true },
        ...state.tokens.filter((token) => token.address.toLowerCase() !== result.token.toLowerCase()),
      ] }));
      submittedForm.reset();
      set({ launchProgress: { phase: "success", hash: result.hash ?? null, error: "" } });
      void get().fetchTokens();
    } catch (error) {
      handleActionError(error);
      set((state) => ({ launchProgress: { phase: "error", hash: state.launchProgress?.hash ?? null, error: error.message || "Transaction failed" } }));
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
      });
      await get().fetchTokens();
    } catch (error) {
      handleActionError(error);
    } finally {
      endAction();
    }
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
      set({ tradeMessage: activeContractVersion === "v2" ? "Pool fees credited to creator, treasury, and buyback vault." : "Pool fees sent to the creator and treasury." });
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
      set({ tradeMessage });
      await get().fetchTokens();
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
      actionError: error.message || "Transaction failed",
      isPending: false,
      tradeMessage: "",
    }),
}));
