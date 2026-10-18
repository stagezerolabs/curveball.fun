import { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { formatEther, type Address } from "viem";
import { useBalance } from "wagmi";
import { formatAddress, formatEthAmount } from "../lib/format.js";
import { activeChainId, activeExplorerUrl, isActiveTestnet, riseTestnet } from "../lib/web3";

const RISE_TESTNET_FAUCET_URL = "https://faucet.testnet.riselabs.xyz";

export function WalletReceiveDialog({ address, open, onOpenChange }: {
  address: Address;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const balance = useBalance({
    address,
    chainId: activeChainId,
    query: { enabled: open, refetchOnWindowFocus: true },
  });

  useEffect(() => {
    if (!open) setCopyState("idle");
  }, [open]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  const balanceLabel = balance.data
    ? `${formatEthAmount(Number(formatEther(balance.data.value)))} ${balance.data.symbol}`
    : balance.isLoading ? "Reading balance…" : "Balance unavailable";

  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Backdrop className="wallet-receive-backdrop" />
      <Dialog.Viewport className="wallet-receive-viewport">
        <Dialog.Popup className="wallet-receive-dialog">
          <header>
            <div className="wallet-receive-heading">
              <span className="wallet-receive-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M5 20h14"/></svg>
              </span>
              <div><Dialog.Title>Deposit ETH</Dialog.Title><p>Receive funds on {riseTestnet.name}</p></div>
            </div>
            <Dialog.Close className="wallet-receive-close" aria-label="Close deposit dialog">×</Dialog.Close>
          </header>
          <Dialog.Description className="wallet-receive-description">
            Send ETH to this wallet on {riseTestnet.name}. Funds sent on another network will not appear here.
          </Dialog.Description>

          <div className="wallet-receive-network">
            <span aria-hidden="true" />
            <div><small>Network</small><strong>{riseTestnet.name}</strong></div>
            <span>{balanceLabel}</span>
          </div>

          <div className="wallet-receive-address">
            <label htmlFor="wallet-receive-value">Wallet address</label>
            <div>
              <input id="wallet-receive-value" value={address} readOnly onFocus={(event) => event.currentTarget.select()} />
              <button type="button" onClick={() => void copyAddress()} aria-live="polite">
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="6" y="6" width="10" height="10" rx="2"/><path d="M4 13V5a2 2 0 0 1 2-2h8"/></svg>
                {copyState === "copied" ? "Copied" : copyState === "error" ? "Select" : "Copy"}
              </button>
            </div>
            <small>{formatAddress(address)}</small>
          </div>

          <div className="wallet-receive-actions">
            {isActiveTestnet ? <a className="wallet-receive-primary" href={RISE_TESTNET_FAUCET_URL} target="_blank" rel="noreferrer">Get test ETH <span aria-hidden="true">↗</span></a> : null}
            <a className={isActiveTestnet ? "wallet-receive-secondary" : "wallet-receive-primary"} href={`${activeExplorerUrl}/address/${address}`} target="_blank" rel="noreferrer">View in explorer <span aria-hidden="true">↗</span></a>
          </div>
          {isActiveTestnet ? <p className="wallet-receive-note">RISE Testnet uses faucet ETH with no real-world value.</p> : null}
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>;
}
