import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { useLogout } from "@privy-io/react-auth";
import type { Address } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { curveLaunchpadAbi, erc20Abi } from "../sdk/contracts";
import { activeChainId, launchpadAddress } from "../lib/web3";
import { AccountBalances } from "./AccountBalances";
import type { Navigate } from "../types";

function ProfileGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

export function AccountPopover({
  address,
  label,
  navigate,
  profileActive = false,
}: {
  address: Address;
  label: string;
  navigate: Navigate;
  profileActive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const balance = useBalance({
    address,
    chainId: activeChainId,
    query: { enabled: open, refetchInterval: 15_000 },
  });
  const quote = useReadContract({
    address: launchpadAddress ?? undefined,
    abi: curveLaunchpadAbi,
    functionName: "quoteToken",
    chainId: activeChainId,
    query: { enabled: Boolean(launchpadAddress && open), staleTime: 60_000 },
  });
  const weth = useReadContract({
    address: quote.data ?? undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
    chainId: activeChainId,
    query: { enabled: Boolean(quote.data && open), refetchInterval: 15_000 },
  });
  const { logout } = useLogout();

  return (
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
        <Popover.Positioner
          className="account-popover-positioner"
          sideOffset={10}
          align="end"
          collisionPadding={12}
        >
          <Popover.Popup className="account-popover" aria-label="Account">
            <AccountBalances
              nativeBalance={balance.data?.value}
              nativeSymbol={balance.data?.symbol}
              wethBalance={weth.data}
              nativeLoading={balance.isLoading}
              wethLoading={quote.isLoading || weth.isLoading}
            />

            <nav className="account-popover-links" aria-label="Account">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate("profile");
                }}
              >
                View profile
              </button>
              <button
                className="account-popover-logout"
                type="button"
                onClick={() => void logout()}
              >
                Log out
              </button>
            </nav>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
