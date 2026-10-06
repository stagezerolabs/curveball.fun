import { expect, test } from "bun:test";
import { defineChain } from "viem";
import { createWalletConfig } from "./walletConfig";

const chain = defineChain({
  id: 11_155_931,
  name: "RISE Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet.riselabs.xyz"] } },
});

test("wallet configuration offers WalletConnect when a project ID is configured", () => {
  const config = createWalletConfig(chain, "test-project-id");
  // RainbowKit substitutes mock connectors outside the browser, but still
  // exposes its full wallet group rather than the single injected fallback.
  expect(config.connectors.length).toBeGreaterThan(1);
});

test("wallet configuration keeps browser wallets available before a project ID is set", () => {
  const config = createWalletConfig(chain, "");
  expect(config.connectors.some((connector) => connector.id === "injected")).toBe(true);
  expect(config.connectors.some((connector) => connector.id === "walletConnect")).toBe(false);
});
