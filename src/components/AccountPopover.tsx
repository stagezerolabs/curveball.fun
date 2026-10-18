import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { useLinkAccount, useLogout, useWallets } from "@privy-io/react-auth";
import { formatEther, type Address } from "viem";
import { useBalance } from "wagmi";
import { selectPreferredWallet } from "../lib/PrivyWagmiProvider";
import { formatAddress, formatEthAmount } from "../lib/format.js";
import { selectWalletFundingMode, isPrivyManagedWallet } from "../lib/walletFunding";
import { activeChainId, activeExplorerUrl, isActiveTestnet, riseTestnet } from "../lib/web3";
import type { Navigate } from "../types";
import { WalletIdentityMark } from "./WalletIdentityMark";
import { WalletReceiveDialog } from "./WalletReceiveDialog";

function ProfileGlyph() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </svg>;
}

export function AccountPopover({ address, label, navigate, profileActive = false }: {
  address: Address;
  label: string;
  navigate: Navigate;
  profileActive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [fundingError, setFundingError] = useState("");
  const { wallets } = useWallets();
  const activeWallet = wallets.find((wallet) => wallet.address.toLowerCase() === address.toLowerCase())
    ?? selectPreferredWallet(wallets);
  const external = Boolean(activeWallet && !isPrivyManagedWallet(activeWallet.walletClientType));
  const balance = useBalance({ address, chainId: activeChainId, query: { refetchOnWindowFocus: true } });
  const { logout } = useLogout();
  const { linkWallet } = useLinkAccount({
    onSuccess: () => setFundingError("Wallet verified and linked."),
    onError: () => setFundingError("Wallet verification was not completed."),
  });

  async function beginDeposit() {
    if (!activeWallet) return;
    setFundingError("");
    const mode = selectWalletFundingMode({
      hasWallet: true,
      walletClientType: activeWallet.walletClientType,
      isTestnet: isActiveTestnet,
    });
    if (mode === "receive-address") {
      setOpen(false);
      setReceiveOpen(true);
      return;
    }
    try {
      await activeWallet.fund({ chain: riseTestnet });
    } catch (cause) {
      setFundingError(cause instanceof Error && cause.message ? cause.message : "Funding could not be started.");
    }
  }

  const balanceLabel = balance.data
    ? `${formatEthAmount(Number(formatEther(balance.data.value)))} ${balance.data.symbol}`
    : balance.isLoading ? "Loading…" : "— ETH";

  return <>
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="nav-profile account-popover-trigger"
        aria-label={`Open profile and account menu for ${label}`}
        aria-current={profileActive ? "page" : undefined}
        title="Profile and account"
      >
        <ProfileGlyph />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="account-popover-positioner" sideOffset={10} align="end" collisionPadding={12}>
          <Popover.Popup className="account-popover" aria-busy={!activeWallet}>
            <header>
              <div><small>Signed in</small><Popover.Title>Account</Popover.Title></div>
              <Popover.Close className="account-popover-close" aria-label="Close account menu">×</Popover.Close>
            </header>

            <div className="account-popover-identity">
              <WalletIdentityMark wallet={activeWallet} />
              <div><strong>{activeWallet?.meta.name ?? "Connected wallet"}</strong><small>{external ? "External wallet" : "Curveball wallet"}</small></div>
              <span className="account-status"><i aria-hidden="true" /> Connected</span>
            </div>

            <div className="account-balance-card">
              <div><small>Available on {riseTestnet.name}</small><strong>{balanceLabel}</strong></div>
              <button type="button" onClick={() => void beginDeposit()}>Deposit</button>
              <span>{formatAddress(address)}</span>
            </div>

            <nav className="account-popover-links" aria-label="Account actions">
              <button type="button" onClick={() => { setOpen(false); navigate("profile"); }}><span aria-hidden="true">◎</span> View profile <span aria-hidden="true">›</span></button>
              <a href={`${activeExplorerUrl}/address/${address}`} target="_blank" rel="noreferrer"><span aria-hidden="true">↗</span> Block explorer <span aria-hidden="true">›</span></a>
              {!external ? <button type="button" onClick={() => linkWallet({ walletChainType: "ethereum-only", description: "Sign once with your external wallet to prove ownership and use it on Curveball." })}><span aria-hidden="true">＋</span> Verify external wallet <span aria-hidden="true">›</span></button> : null}
            </nav>

            {fundingError ? <p className="account-popover-message" role="status">{fundingError}</p> : null}
            <button className="account-popover-logout" type="button" onClick={() => void logout()}><span aria-hidden="true">↪</span> Log out</button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
    <WalletReceiveDialog address={address} open={receiveOpen} onOpenChange={setReceiveOpen} />
  </>;
}
