import { MarketList } from "../components/MarketList.jsx";

export function MarketsPage({ tokens, loading, error, navigate }) {
  return (
    <main className="page-main">
      <section className="page-heading wrap">
        <div className="eyebrow">
          <span /> Discover
        </div>
        <h1>Markets in motion</h1>
        <p>
          Pick a live bonding curve to trade, or follow graduated tokens into
          open liquidity.
        </p>
      </section>
      <section className="markets-page wrap">
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <MarketList tokens={tokens} loading={loading} navigate={navigate} />
      </section>
    </main>
  );
}
