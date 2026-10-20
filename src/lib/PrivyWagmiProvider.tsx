import { useEffect, useRef, type PropsWithChildren } from "react";
import { usePrivy, useWallets, type ConnectedWallet } from "@privy-io/react-auth";
import {
  WagmiProvider,
  useConfig,
  useReconnect,
  type Config,
  type Connector,
} from "wagmi";
import { injected } from "wagmi/connectors";

function connectorId(wallet: ConnectedWallet) {
  return wallet.walletClientType === "privy"
    ? `${wallet.meta.id}.${wallet.address}`
    : wallet.meta.id;
}

async function registerWallets(wallets: ConnectedWallet[], config: Config) {
  const connectors = await Promise.all(wallets.map(async (wallet) => {
    const id = connectorId(wallet);
    const existing = config.connectors.find((connector) => connector.id === id);
    if (existing) return existing;

    const provider = await wallet.getEthereumProvider();
    return config._internal.connectors.setup(injected({
      target: {
        id,
        name: wallet.meta.name,
        icon: typeof wallet.meta.icon === "string" ? wallet.meta.icon : undefined,
        // Privy and Wagmi use structurally compatible EIP-1193 providers but
        // currently publish different event-listener type overloads.
        provider: provider as never,
      },
    }));
  }));

  config._internal.connectors.setState(connectors as Connector[]);
  return connectors;
}

function clearWallets(config: Config) {
  config._internal.connectors.setState([]);
  config.setState((state) => ({
    ...state,
    connections: new Map(),
    current: null,
    status: "disconnected",
  }));
}

export function selectPreferredWallet<T extends Pick<ConnectedWallet, "walletClientType">>(wallets: T[]) {
  return wallets.find((wallet) => wallet.walletClientType !== "privy" && wallet.walletClientType !== "privy-v2") ?? wallets[0];
}

// Privy reports CAIP-2 ids ("eip155:1"); its embedded wallet provider starts on chain 1.
export function walletsOffChain<T extends Pick<ConnectedWallet, "chainId">>(wallets: T[], chainId: number) {
  return wallets.filter((wallet) => wallet.chainId !== `eip155:${chainId}`);
}

export type WalletSyncAction = "wait" | "clear" | "connect";

// Privy keeps listing a browser wallet after logout, so the session, not the wallet list, decides.
export function selectWalletSyncAction({ ready, authenticated, walletCount }: {
  ready: boolean;
  authenticated: boolean;
  walletCount: number;
}): WalletSyncAction {
  if (!ready) return "wait";
  return authenticated && walletCount > 0 ? "connect" : "clear";
}

function PrivyWalletSync() {
  const { ready: privyReady, authenticated } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const config = useConfig();
  const { reconnect } = useReconnect();
  // Key the effect on a stable wallet signature instead of the wallet array
  // identity, so unrelated re-renders can never re-run the sync and reconnect a
  // session that is already connected (the cause of repeated "already logged in"
  // provider warnings).
  const walletSignature = wallets
    .map((wallet) => `${wallet.walletClientType}:${wallet.address}`)
    .sort()
    .join(",");
  const walletCount = wallets.length;
  // reconnect() is only meaningful once per sign-in: replaying it against a
  // provider whose session is already active is what makes wallets complain.
  // Key the guard on the wallet set rather than a one-shot flag so a changed set
  // (disconnect/reconnect, switching wallets) re-registers the connector and
  // restores the address, while unrelated re-renders stay inert.
  const connectedSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    const action = selectWalletSyncAction({ ready: privyReady && walletsReady, authenticated, walletCount });
    if (action === "wait") return;
    if (action === "clear") {
      connectedSignatureRef.current = null;
      clearWallets(config);
      return;
    }
    if (connectedSignatureRef.current === walletSignature) return;
    connectedSignatureRef.current = walletSignature;
    let cancelled = false;

    void (async () => {

      // Move every Privy wallet onto Wagmi's only chain so both libraries agree before anything signs.
      const [appChain] = config.chains;
      await Promise.all(walletsOffChain(wallets, appChain.id).map((wallet) => wallet.switchChain(appChain.id).catch((error) => {
        console.warn(`Could not switch ${wallet.meta.name} to ${appChain.name}`, error);
      })));
      await registerWallets(wallets, config);
      const preferredWallet = selectPreferredWallet(wallets);
      if (!preferredWallet) return;
      const preferredId = connectorId(preferredWallet);
      await Promise.all([
        ...wallets.map((wallet) => config.storage?.removeItem(`${connectorId(wallet)}.disconnected`)),
        config.storage?.setItem("recentConnectorId", preferredId),
      ]);

      if (!cancelled && config.state.status !== "connected") reconnect();
    })().catch((error) => {
      connectedSignatureRef.current = null;
      console.error("Could not sync the signed-in Privy wallet with Wagmi", error);
    });

    return () => {
      cancelled = true;
    };
  }, [authenticated, config, privyReady, reconnect, walletSignature, walletCount, walletsReady]);

  return null;
}

export function PrivyWagmiProvider({ children, config }: PropsWithChildren<{ config: Config }>) {
  return (
    <WagmiProvider config={config} reconnectOnMount={false}>
      <PrivyWalletSync />
      {children}
    </WagmiProvider>
  );
}
