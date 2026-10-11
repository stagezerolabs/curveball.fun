import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { formatEther, getAddress, type Hash } from "viem";
import { AppLink } from "../components/Navigation";
import { activeChainId, wagmiConfig } from "../lib/web3";
import { listPreviousLaunches, previousFactory, type PreviousLaunch, type PreviousLaunchClient } from "../lib/previousLaunches";
import previousDeployment from "../../deployments/11155931/curveball-v2.json";
import { defineCurveballDeployment, RISE_TESTNET_EXPLORER_URL } from "../sdk/curveballSdk";
import { useTokenBalance } from "../sdk/react";
import { createV2Sdk } from "../sdk/v2Sdk";
import type { Navigate } from "../types";

const previousSdk = createV2Sdk(wagmiConfig, defineCurveballDeployment({
  chainId: previousDeployment.chainId,
  launchpad: previousFactory,
}));
const previousWeth = getAddress(previousDeployment.quote);

function PreviousTokenRow({ launch, address }: { launch: PreviousLaunch; address?: `0x${string}` }) {
  const { openConnectModal } = useConnectModal();
  const { data: balance, refetch: refetchBalance } = useTokenBalance(launch.token, address);
  const inFlight = useRef(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [soldAmount, setSoldAmount] = useState<bigint | null>(null);
  const [saleHash, setSaleHash] = useState<Hash | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sellAll() {
    if (!address) { openConnectModal?.(); return; }
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setMessage(null);
    setSoldAmount(null);
    setSaleHash(null);
    setPhase("Preparing sale…");
    try {
      const result = await previousSdk.sellAllForEth(launch.token, previousWeth, (nextPhase, amount, hash) => {
        if (nextPhase === "approving") setPhase("Approve tokens in your wallet…");
        if (nextPhase === "selling") setPhase("Confirm sale in your wallet…");
        if (nextPhase === "sold" && amount && hash) {
          setSoldAmount(amount);
          setSaleHash(hash);
        }
        if (nextPhase === "unwrapping") setPhase("Sale confirmed. Confirm WETH unwrap in your wallet…");
      });
      setSoldAmount(null);
      setSaleHash(result.sale.hash);
      setMessage(`${formatEther(result.amount)} ETH received.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete the sale. Please try again.");
    } finally {
      inFlight.current = false;
      setPhase(null);
      void refetchBalance();
    }
  }

  async function finishUnwrap() {
    if (!soldAmount || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setPhase("Confirm WETH unwrap in your wallet…");
    try {
      await previousSdk.unwrapWeth(soldAmount, previousWeth);
      setMessage(`${formatEther(soldAmount)} ETH received.`);
      setSoldAmount(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not unwrap WETH. Please try again.");
    } finally {
      inFlight.current = false;
      setPhase(null);
    }
  }

  return (
    <li className="previous-token">
      <div className="previous-token-title"><strong>{launch.name}</strong><span>${launch.symbol}</span></div>
      <div className="previous-token-details">
        <dl>
          <div><dt>Token</dt><dd><a href={`${RISE_TESTNET_EXPLORER_URL}/address/${launch.token}`} target="_blank" rel="noreferrer"><code>{launch.token}</code><span aria-hidden="true"> ↗</span></a></dd></div>
          <div><dt>Creator</dt><dd><a href={`${RISE_TESTNET_EXPLORER_URL}/address/${launch.creator}`} target="_blank" rel="noreferrer"><code>{launch.creator}</code><span aria-hidden="true"> ↗</span></a></dd></div>
          {address && <div><dt>Your balance</dt><dd>{balance === undefined ? "Loading…" : `${formatEther(balance)} ${launch.symbol}`}</dd></div>}
        </dl>
        <div className="previous-token-action">
          <button type="button" disabled={Boolean(phase) || Boolean(address && !soldAmount && (balance === undefined || balance === 0n))} onClick={() => void (!address ? openConnectModal?.() : soldAmount ? finishUnwrap() : sellAll())}>
            {!address ? "Connect wallet to sell" : soldAmount ? "Finish converting to ETH" : "Sell all for ETH"}
          </button>
          {phase && <p role="status">{phase}</p>}
          {error && <p role="alert">{soldAmount ? `Sale completed. ${error}` : error}</p>}
          {message && <p role="status">{message}</p>}
          {saleHash && <a href={`${RISE_TESTNET_EXPLORER_URL}/tx/${saleHash}`} target="_blank" rel="noreferrer">View sale transaction ↗</a>}
        </div>
      </div>
    </li>
  );
}

export function MigrationPage({ navigate }: { navigate: Navigate }) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: activeChainId });
  const [mineOnly, setMineOnly] = useState(false);
  const { data: launches, isPending, isError, refetch } = useQuery({
    queryKey: ["previous-launches", activeChainId, previousFactory],
    queryFn: () => listPreviousLaunches(client as unknown as PreviousLaunchClient),
    enabled: Boolean(client) && activeChainId === previousDeployment.chainId,
    staleTime: 300_000,
    retry: 1,
  });
  const visible = mineOnly && address
    ? launches?.filter((launch) => launch.creator.toLowerCase() === address.toLowerCase())
    : launches;

  return (
    <main className="page-main previous-page wrap">
      <header className="previous-heading">
        <p className="previous-eyebrow">Contract migration</p>
        <h1>Previous launches</h1>
        <p>Curveball is moving launches to a new contract. Find tokens created on the previous launchpad and sell your balance back for ETH. Selling requires a token approval, sale, and WETH unwrap.</p>
      </header>

      <div className="previous-factory">
        <span>Previous launchpad</span>
        <a href={`${RISE_TESTNET_EXPLORER_URL}/address/${previousFactory}`} target="_blank" rel="noreferrer">
          <code>{previousFactory}</code><span aria-hidden="true"> ↗</span>
        </a>
      </div>

      <section className="previous-list-section" aria-labelledby="previous-list-title">
        <div className="previous-list-head">
          <div>
            <h2 id="previous-list-title">Tokens on the previous contract</h2>
            <p>{launches ? `${launches.length} token${launches.length === 1 ? "" : "s"} found` : "Addresses are read from RISE Testnet."}</p>
          </div>
          {address && <label className="previous-mine-filter">
            <input type="checkbox" checked={mineOnly} onChange={(event) => setMineOnly(event.target.checked)} />
            Created by me
          </label>}
        </div>

        {activeChainId !== previousDeployment.chainId ? (
          <p className="previous-state">Previous launches are available on RISE Testnet.</p>
        ) : !client ? (
          <p className="previous-state" role="alert">RISE Testnet is unavailable. Try again later.</p>
        ) : isPending ? (
          <p className="previous-state" role="status">Loading previous launches…</p>
        ) : isError ? (
          <div className="previous-state" role="alert">
            <p>Could not load previous launches.</p>
            <button type="button" onClick={() => void refetch()}>Try again</button>
          </div>
        ) : !visible?.length ? (
          <p className="previous-state">{mineOnly ? "No previous launches created by this wallet." : "No previous launches found."}</p>
        ) : (
          <ul className="previous-token-list">
            {visible.map((launch) => <PreviousTokenRow launch={launch} address={address} key={launch.token} />)}
          </ul>
        )}
      </section>
      <p className="previous-footer-note">New launches use the new contract. <AppLink route="launch" navigate={navigate}>Create a token ↗</AppLink></p>
    </main>
  );
}
