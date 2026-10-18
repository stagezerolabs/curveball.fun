import { useEffect, type PropsWithChildren } from "react";
import { useWallets, type ConnectedWallet } from "@privy-io/react-auth";
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

function PrivyWalletSync() {
  const { wallets, ready } = useWallets();
  const config = useConfig();
  const { reconnect } = useReconnect();

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    void (async () => {
      if (!wallets.length) {
        clearWallets(config);
        return;
      }

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
      console.error("Could not sync the signed-in Privy wallet with Wagmi", error);
    });

    return () => {
      cancelled = true;
    };
  }, [config, ready, reconnect, wallets]);

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
