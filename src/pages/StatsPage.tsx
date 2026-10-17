import { formatUnits } from "viem";
import { AppLink } from "../components/Navigation";
import { useProtocolStats } from "../components/LandingProtocolStats";
import { formatAddress, formatEthAmount } from "../lib/format.js";
import { activeExplorerUrl, launchpadAddress } from "../lib/web3";
import type { Navigate } from "../types";

export function StatsPage({ navigate }: { navigate: Navigate }) {
  const {
    data, payout, isPending, isFetching, isError, payoutPending, payoutFetching,
    payoutError, statsEnabled, payoutEnabled, dataUpdatedAt, refetchLaunches, refetchPayout,
  } = useProtocolStats();
  const total = data?.length ?? 0;
  const graduated = data?.filter((token) => token.graduated).length ?? 0;
  const live = total - graduated;
  const graduationRate = total ? graduated / total * 100 : 0;
  const claimed = payout ? formatEthAmount(Number(formatUnits(payout.amount, payout.decimals))) : null;
  const loading = statsEnabled && isPending && !data;
  const claimLoading = payoutEnabled && payoutPending && !payout;

  return (
    <main className="page-main protocol-stats-page wrap">
      <header className="protocol-stats-header">
        <div>
          <h1>Curveball in numbers.</h1>
        </div>
        <button type="button" className="market-refresh protocol-stats-refresh" onClick={() => { void Promise.all([refetchLaunches(), ...(payoutEnabled ? [refetchPayout()] : [])]); }} disabled={!statsEnabled || isFetching || payoutFetching} aria-label={isFetching || payoutFetching ? "Refreshing stats" : "Refresh stats"} aria-busy={isFetching || payoutFetching} title="Refresh stats">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16.8 8A7 7 0 1 0 17 11" /><path d="M17 3.5V8h-4.5" /></svg>
        </button>
      </header>

      {isError && !data && <p className="notice" role="alert">Could not load protocol stats from the configured network. Try refreshing.</p>}
      {payoutError && !payout && <p className="notice" role="alert">Creator claim totals are temporarily unavailable.</p>}

      <section aria-label="Protocol totals">
        <dl className="protocol-stats-grid" aria-busy={loading || claimLoading}>
          <div><dt>Tokens created</dt><dd>{loading ? "…" : data ? total.toLocaleString() : "—"}</dd><small>From this factory</small></div>
          <div><dt>Not yet graduated</dt><dd>{loading ? "…" : data ? live.toLocaleString() : "—"}</dd><small>Includes completed bonding curves</small></div>
          <div><dt>Graduated markets</dt><dd>{loading ? "…" : data ? graduated.toLocaleString() : "—"}</dd><small>Pool created</small></div>
          <div><dt>Curve fees claimed by creators</dt><dd>{claimLoading ? "…" : claimed ?? "—"}<span className="protocol-stats-unit">{claimed !== null ? " WETH" : ""}</span></dd><small>Confirmed escrow claims</small></div>
        </dl>
      </section>

      <div className="protocol-stats-content">
        <section className="protocol-stats-progress" aria-labelledby="stats-progress-title">
          <div className="protocol-stats-section-head">
            <h2 id="stats-progress-title">From curve to pool.</h2>
            <strong>{data ? `${graduationRate.toFixed(1)}%` : "—"}</strong>
          </div>
          <div className="protocol-stats-track" role="progressbar" aria-label="Share of launched markets graduated" aria-valuenow={data ? Number(graduationRate.toFixed(1)) : undefined} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${graduationRate}%` }} />
          </div>
          <p>{data ? `${graduated} of ${total} launches have completed graduation.` : "Launch data is unavailable."}</p>
        </section>

        <section className="protocol-stats-recent" aria-labelledby="stats-recent-title">
          <div className="protocol-stats-section-head">
            <h2 id="stats-recent-title">Recently on the curve.</h2>
            <AppLink className="text-link" route="markets" navigate={navigate}>All markets →</AppLink>
          </div>
          {loading ? <p className="protocol-stats-empty" role="status">Loading launches…</p> : !data ? <p className="protocol-stats-empty">Launch data is unavailable.</p> : !data.length ? <p className="protocol-stats-empty">No launches from this factory yet.</p> : (
            <ul className="protocol-stats-list">
              {data.slice(0, 5).map((token) => (
                <li key={token.address}>
                  <AppLink route="market" params={{ address: token.address }} navigate={navigate}>
                    <span><strong>{token.name || formatAddress(token.address)}</strong><small>{token.symbol ? `$${token.symbol}` : formatAddress(token.address)}</small></span>
                    <span className={token.graduated ? "protocol-stats-status graduated" : "protocol-stats-status"}>{token.graduated ? "Graduated" : "Not graduated"}</span>
                    <span aria-hidden="true">↗</span>
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="protocol-stats-source" aria-labelledby="stats-source-title">
        <div>
          <h2 id="stats-source-title">Read the source.</h2>
        </div>
        <div>
          <p>Launches and graduations: current factory. Creator claims: paid curve fees only; excludes unclaimed and pool fees.</p>
          {dataUpdatedAt > 0 && <p className="protocol-stats-updated">Last checked <time dateTime={new Date(dataUpdatedAt).toISOString()}>{new Date(dataUpdatedAt).toLocaleString()}</time></p>}
          {launchpadAddress && <a className="text-link" href={`${activeExplorerUrl}/address/${launchpadAddress}`} target="_blank" rel="noreferrer">View factory on explorer ↗</a>}
        </div>
      </section>
    </main>
  );
}
