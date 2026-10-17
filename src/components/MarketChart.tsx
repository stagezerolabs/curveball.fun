import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart, CandlestickChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { usePublicClient } from "wagmi";
import { MarketActivity } from "./MarketActivity";
import { UsdAmount } from "./UsdAmount";
import { v2CurveAbi } from "../sdk/v2Contracts";
import {
  activeChainId,
  activeDeploymentBlock,
} from "../lib/web3";
import {
  buildBlockRanges,
  buildCandles,
  calculatePriceChange,
  parseCreatedBlock,
  toMarketCapPoints,
  tradeLogToActivity,
  tradeLogToPoint,
  type TradeActivity,
  type MarketPriceChange,
  type TradePoint,
} from "../lib/marketChart";
import { buildMarketChartOptions } from "../lib/marketChartOptions";
import type { Token } from "../types";

echarts.use([BarChart, CandlestickChart, DataZoomComponent, GridComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

const MAX_EVENT_QUERY_BLOCKS = 5_000n;
const EVENT_QUERY_CONCURRENCY = 6;

const tradePointCache = new Map<string, {
  lastBlock: bigint;
  points: TradePoint[];
  trades: TradeActivity[];
}>();

const INTERVALS = [
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3_600 },
  { label: "4h", seconds: 14_400 },
  { label: "1d", seconds: 86_400 },
] as const;

type TradeLog = {
  args?: {
    grossCurveQuote?: bigint;
    vQAfter?: bigint;
    vTAfter?: bigint;
    trader?: string;
    isBuy?: boolean;
    tokenAmount?: bigint;
    netTraderQuote?: bigint;
  };
  blockNumber?: bigint | null;
  logIndex?: number;
  transactionHash?: string;
};

type ChartClient = {
  getBlockNumber(): Promise<bigint>;
  getContractEvents(parameters: object): Promise<readonly TradeLog[]>;
  getBlock(parameters: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
};

async function queryTradeLogs(client: ChartClient, token: Token) {
  const address = token.curve;
  if (!address) return { latestBlock: 0n, logs: [] as TradeLog[] };

  const cacheKey = `${activeChainId}:${token.address.toLowerCase()}`;
  const cached = tradePointCache.get(cacheKey);
  const latestBlock = await client.getBlockNumber();
  const createdBlock = parseCreatedBlock(token.createdBlock, activeDeploymentBlock);
  const fromBlock = cached && cached.lastBlock >= createdBlock
    ? cached.lastBlock + 1n
    : createdBlock;
  const ranges = buildBlockRanges(fromBlock, latestBlock, MAX_EVENT_QUERY_BLOCKS);

  const eventQuery = {
    address,
    abi: v2CurveAbi,
    eventName: "Trade",
    args: { token: token.address },
    strict: true,
  };
  const logs: TradeLog[] = [];
  let nextRange = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(EVENT_QUERY_CONCURRENCY, ranges.length) },
      async () => {
        while (nextRange < ranges.length) {
          const range = ranges[nextRange++];
          logs.push(...await client.getContractEvents({ ...eventQuery, ...range }));
        }
      },
    ),
  );
  return { latestBlock, logs };
}

async function loadTradePoints(client: ChartClient, token: Token) {
  const cacheKey = `${activeChainId}:${token.address.toLowerCase()}`;
  const cached = tradePointCache.get(cacheKey);
  let result: Awaited<ReturnType<typeof queryTradeLogs>>;
  try {
    result = await queryTradeLogs(client, token);
  } catch (error) {
    if (cached) return { points: cached.points, trades: cached.trades };
    throw error;
  }
  const { latestBlock, logs } = result;
  const blockNumbers = [
    ...new Set(
      logs
        .map((log) => log.blockNumber)
        .filter((block): block is bigint => block !== null && block !== undefined),
    ),
  ];
  const timestamps = new Map<bigint, number>();
  let nextBlock = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(EVENT_QUERY_CONCURRENCY, blockNumbers.length) },
      async () => {
        while (nextBlock < blockNumbers.length) {
          const blockNumber = blockNumbers[nextBlock++];
          const block = await client.getBlock({ blockNumber });
          timestamps.set(blockNumber, Number(block.timestamp));
        }
      },
    ),
  );

  const newPoints = logs.flatMap((log): TradePoint[] => {
    const blockNumber = log.blockNumber;
    if (!blockNumber) return [];
    const point = tradeLogToPoint(log.args, timestamps.get(blockNumber));
    return point ? [point] : [];
  });
  const points = cached ? [...cached.points, ...newPoints] : newPoints;
  const newTrades = logs.flatMap((log): TradeActivity[] => {
    const activity = tradeLogToActivity(log, log.blockNumber == null ? undefined : timestamps.get(log.blockNumber));
    return activity ? [activity] : [];
  });
  const trades = [...(cached?.trades ?? []), ...newTrades].sort((a, b) =>
    a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1,
  );
  tradePointCache.set(cacheKey, { lastBlock: latestBlock, points, trades });
  return { points, trades };
}

export function MarketChart({
  token,
  refreshKey,
  onMarketCapChange,
}: {
  token: Token;
  refreshKey?: number;
  onMarketCapChange?: (change: MarketPriceChange | null) => void;
}) {
  const publicClient = usePublicClient({ chainId: activeChainId });
  const chartRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<TradePoint[]>([]);
  const [trades, setTrades] = useState<TradeActivity[]>([]);
  const [interval, setInterval] = useState(60);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [themeVersion, setThemeVersion] = useState(0);
  const [hover, setHover] = useState<{ close: number; volume: number } | null>(null);
  const marketCapPoints = useMemo(
    () => toMarketCapPoints(points, token.price, token.marketCap),
    [points, token.marketCap, token.price],
  );
  const candles = useMemo(() => buildCandles(marketCapPoints, interval), [marketCapPoints, interval]);

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!publicClient || refreshKey === 0) return undefined;
    setLoading(true);
    setError("");
    setPoints([]);
    setTrades([]);
    setHover(null);
    onMarketCapChange?.(null);
    void loadTradePoints(publicClient as unknown as ChartClient, token)
      .then(({ points: nextPoints, trades }) => {
        if (!cancelled) {
          setPoints(nextPoints);
          setTrades(trades);
          onMarketCapChange?.(calculatePriceChange(nextPoints, token.price));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Chart unavailable");
          onMarketCapChange?.(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publicClient, refreshKey, token.address, token.curve, token.price, onMarketCapChange]);

  useEffect(() => {
    const container = chartRef.current;
    if (!container || !candles.length) return undefined;
    const styles = getComputedStyle(document.documentElement);
    const chart = echarts.init(container, undefined, { renderer: "canvas" });
    chart.setOption(buildMarketChartOptions(candles, {
      text: styles.getPropertyValue("--muted").trim(),
      grid: styles.getPropertyValue("--chart-grid").trim(),
      lime: styles.getPropertyValue("--lime").trim(),
      orange: styles.getPropertyValue("--orange").trim(),
    }, interval));
    setHover({
      close: candles[candles.length - 1].close,
      volume: candles[candles.length - 1].volume,
    });
    chart.on("updateAxisPointer", (event) => {
      const pointer = event as { axesInfo?: { value?: number }[] };
      const index = pointer.axesInfo?.[0]?.value;
      if (index !== undefined && candles[index]) {
        setHover({ close: candles[index].close, volume: candles[index].volume });
      }
    });
    chart.getZr().on("globalout", () => {
      const latest = candles[candles.length - 1];
      setHover({ close: latest.close, volume: latest.volume });
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [candles, interval, themeVersion]);

  return (
    <div className="market-main">
    <section className="market-chart-panel" aria-label={`${token.symbol} market cap chart`}>
      <header className="market-chart-head">
        <div>
          <strong><UsdAmount weth={hover?.close} compact /></strong>
          {hover && <small>Market cap · Volume <UsdAmount weth={hover.volume} compact /></small>}
        </div>
        <div className="chart-intervals" role="group" aria-label="Chart interval">
          {INTERVALS.map((item) => (
            <button
              key={item.label}
              type="button"
              className={interval === item.seconds ? "active" : ""}
              aria-pressed={interval === item.seconds}
              onClick={() => setInterval(item.seconds)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>
      <div className="market-chart-stage">
        {loading && <div className="market-chart-message skeleton" aria-label="Loading chart" />}
        {!loading && error && <p className="market-chart-message">{error}</p>}
        {!loading && !error && !candles.length && (
          <p className="market-chart-message">No trades yet</p>
        )}
        <div ref={chartRef} className="market-chart-canvas" />
      </div>
    </section>
    <MarketActivity key={token.address} token={token} trades={trades} loading={loading} error={Boolean(error)} />
    </div>
  );
}
