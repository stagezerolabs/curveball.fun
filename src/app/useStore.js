import { create } from "zustand";
import { formatEther, parseEther } from "viem";
import { apiUrl, requireCurveballSdk } from "../lib/web3";

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

  setAmount: (amount) => set({ amount, quotePreview: null }),
  setSide: (side) => set({ side, quotePreview: null }),
  setActionError: (actionError) => set({ actionError }),
  mergeTokens: (discovered) =>
    set((state) => {
      const merged = new Map(
        discovered.map((token) => [token.address.toLowerCase(), token]),
      );
      for (const token of state.tokens) {
        merged.set(token.address.toLowerCase(), token);
      }
      return { tokens: [...merged.values()], marketError: "" };
    }),

  fetchTokens: async () => {
    set({ loading: true, marketError: "" });
    try {
      const response = await fetch(`${apiUrl}/tokens`);
      if (!response.ok) throw new Error("API failure");
      const tokens = await response.json();
      set({ tokens, loading: false });
    } catch (error) {
      set({
        marketError:
          "Markets are taking a breather. Check the API and try again.",
        loading: false,
      });
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

    try {
      const form = new FormData(submittedForm);
      const result = await requireCurveballSdk().createToken({
        name: String(form.get("name") ?? ""),
        symbol: String(form.get("symbol") ?? ""),
        uri: String(form.get("uri") ?? ""),
      });

      set({
        tradeMessage: `Token created at ${result.token}.`,
        lastCreatedToken: result.token,
      });
      submittedForm.reset();
      await get().fetchTokens();
    } catch (error) {
      handleActionError(error);
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
      set({ tradeMessage: "Pool fees sent to the creator and treasury." });
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
