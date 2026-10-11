import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { AppLink } from "../components/Navigation";
import { activeChainId } from "../lib/web3";
import { listPreviousLaunches, previousFactory, type PreviousLaunchClient } from "../lib/previousLaunches";
import previousDeployment from "../../deployments/11155931/curveball-v2.json";
import { RISE_TESTNET_EXPLORER_URL } from "../sdk/curveballSdk";
import type { Navigate } from "../types";

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
        <p>Curveball is moving launches to a new contract. Find tokens created on the previous launchpad and their original addresses here.</p>
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
            My tokens only
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
          <p className="previous-state">{mineOnly ? "No previous launches found for this wallet." : "No previous launches found."}</p>
        ) : (
          <ul className="previous-token-list">
            {visible.map((launch) => (
              <li className="previous-token" key={launch.token}>
                <div className="previous-token-title"><strong>{launch.name}</strong><span>${launch.symbol}</span></div>
                <dl>
                  <div><dt>Token</dt><dd><a href={`${RISE_TESTNET_EXPLORER_URL}/address/${launch.token}`} target="_blank" rel="noreferrer"><code>{launch.token}</code><span aria-hidden="true"> ↗</span></a></dd></div>
                  <div><dt>Creator</dt><dd><a href={`${RISE_TESTNET_EXPLORER_URL}/address/${launch.creator}`} target="_blank" rel="noreferrer"><code>{launch.creator}</code><span aria-hidden="true"> ↗</span></a></dd></div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="previous-footer-note">New launches use the new contract. <AppLink route="launch" navigate={navigate}>Create a token ↗</AppLink></p>
    </main>
  );
}
