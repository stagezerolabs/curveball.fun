import { create } from "zustand";
import { decodeEventLog, formatEther, parseEther } from "viem";
import {
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from "@wagmi/core";
import {
  apiUrl,
  contractAbi,
  launchpadAddress,
  tokenCreatedEvent,
  wagmiConfig,
} from "../lib/web3.js";

async function upsertMetadata(address, metadata) {
  const body = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => Boolean(value)),
  );
  if (Object.keys(body).length === 0) return;

  // The indexer polls every ~2s, so the row may not exist yet right after
  // the create tx confirms. Retry briefly rather than failing the metadata
  // save outright.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(`${apiUrl}/tokens/${address}/metadata`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok || response.status !== 404) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

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

  setAmount: (amount) => set({ amount, quotePreview: null }),
  setSide: (side) => set({ side, quotePreview: null }),
  setActionError: (actionError) => set({ actionError }),

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
      !launchpadAddress ||
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
      const out = await readContract(wagmiConfig, {
        address: launchpadAddress,
        abi: contractAbi,
        functionName: side === "buy" ? "quoteBuy" : "quoteSell",
        args: [token.address, input],
      });
      set({ quotePreview: out, quoting: false });
    } catch {
      set({ quotePreview: null, quoting: false });
    }
  },

  createToken: async (event) => {
    event.preventDefault();
    const { startAction, endAction, handleActionError } = get();
    startAction();

    try {
      if (!launchpadAddress)
        throw Error("Set VITE_LAUNCHPAD_ADDRESS to launch a token.");

      const form = new FormData(event.currentTarget);
      const name = form.get("name");
      const symbol = form.get("symbol");
      const uri = form.get("uri") || "";
      const metadata = {
        imageUrl: form.get("imageUrl"),
        description: form.get("description"),
        website: form.get("website"),
        xHandle: form.get("xHandle"),
        telegram: form.get("telegram"),
      };

      const hash = await writeContract(wagmiConfig, {
        address: launchpadAddress,
        abi: contractAbi,
        functionName: "createToken",
        args: [name, symbol, uri],
      });
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });

      const created = receipt.logs
        .filter(
          (log) => log.address.toLowerCase() === launchpadAddress.toLowerCase(),
        )
        .map((log) => {
          try {
            return decodeEventLog({ abi: [tokenCreatedEvent], ...log });
          } catch {
            return null;
          }
        })
        .find(Boolean);

      if (created?.args?.token) {
        await upsertMetadata(created.args.token, metadata);
      }

      set({ tradeMessage: "Token created." });
      event.currentTarget.reset();
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
      if (!launchpadAddress || !token)
        throw Error("Select a market and configure the launchpad.");
      const value = Number(amount);
      if (!amount || !Number.isFinite(value) || value <= 0)
        throw Error("Enter an amount greater than zero.");

      const input = parseEther(amount);
      const output = await readContract(wagmiConfig, {
        address: launchpadAddress,
        abi: contractAbi,
        functionName: side === "buy" ? "quoteBuy" : "quoteSell",
        args: [token.address, input],
      });
      const minOut = (output * 97n) / 100n;

      const hash = await writeContract(wagmiConfig, {
        address: launchpadAddress,
        abi: contractAbi,
        functionName: side === "buy" ? "buyTokens" : "sellTokens",
        args: [token.address, input, minOut],
      });
      set({ tradeMessage: "Confirming…" });
      await waitForTransactionReceipt(wagmiConfig, { hash });

      const received =
        side === "buy"
          ? `${formatEther(output)} ${token.symbol}`
          : `${formatEther(output)} ETH`;
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
