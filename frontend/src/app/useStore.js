import { create } from "zustand";
import { parseEther } from "viem";
import { writeContract, readContract } from "@wagmi/core";
import {
  apiUrl,
  contractAbi,
  launchpadAddress,
  wagmiConfig,
} from "../lib/web3.js";

export const useStore = create((set, get) => ({
  tokens: [],
  loading: true,
  marketError: "",
  actionError: "",
  amount: "1",
  isPending: false,

  setAmount: (amount) => set({ amount }),
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
        marketError: "Markets are taking a breather. Check the API and try again.",
        loading: false,
      });
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
      const uri = form.get("uri");

      await writeContract(wagmiConfig, {
        address: launchpadAddress,
        abi: contractAbi,
        functionName: "createToken",
        args: [name, symbol, uri],
      });

      // Optionally re-fetch tokens after creation
      get().fetchTokens();
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

      const input = parseEther(amount);

      const output = await readContract(wagmiConfig, {
        address: launchpadAddress,
        abi: contractAbi,
        functionName: side === "buy" ? "quoteBuy" : "quoteSell",
        args: [token.address, input],
      });

      await writeContract(wagmiConfig, {
        address: launchpadAddress,
        abi: contractAbi,
        functionName: side === "buy" ? "buyTokens" : "sellTokens",
        args: [token.address, input, (output * 97n) / 100n],
      });
    } catch (error) {
      handleActionError(error);
    } finally {
      endAction();
    }
  },

  startAction: () => set({ isPending: true, actionError: "" }),
  endAction: () => set({ isPending: false }),
  handleActionError: (error) =>
    set({ actionError: error.message || "Transaction failed", isPending: false }),
}));
