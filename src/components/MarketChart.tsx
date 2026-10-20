import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as echarts from "echarts/core";
import { BarChart, CandlestickChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { usePublicClient } from "wagmi";
import { MarketActivity } from "./MarketActivity";
import { UsdAmount, useEthUsdRate } from "./UsdAmount";
import { curveLaunchpadAbi } from "../sdk/contracts";
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
  type MarketCandle,
  type MarketPriceChange,
  type TradePoint,
  type TradeLogValues,
} from "../lib/marketChart";
import { buildMarketChartOptions } from "../lib/marketChartOptions";
import { candlePriceChange, fetchMarketCandles, fetchMarketTrades } from "../markets/api";
import { socialApiBaseUrl } from "../social/api";
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
  args?: TradeLogValues & {
    trader?: string;
    tokenAmount?: bigint;
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
  // Every market trades on the launchpad; the indexed token topic picks out this one.
  const address = token.factory;
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
    abi: curveLaunchpadAbi,
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
  const usdPerEth = useEthUsdRate();
  const backendEnabled = Boolean(socialApiBaseUrl);
  const chartRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<TradePoint[]>([]);
  const [rpcTrades, setRpcTrades] = useState<TradeActivity[]>([]);
  const [interval, setInterval] = useState(60);
  const [rpcLoading, setRpcLoading] = useState(true);
  const [rpcError, setRpcError] = useState("");
  const [themeVersion, setThemeVersion] = useState(0);
  const [hover, setHover] = useState<MarketCandle | null>(null);
  // refreshKey deliberately excluded from the keys: the market status poll ticks
  // it every 10s, and including it re-downloaded 2,000 candles and re-triggered
  // the chart rebuild on every tick. The refetch intervals keep data fresh.
  const backendCandles = useQuery({
    queryKey: ["markets", "candles", token.address, interval],
    queryFn: ({ signal }) => fetchMarketCandles(token, interval, signal),
    enabled: backendEnabled,
    staleTime: 8_000,
    refetchInterval: 10_000,
  });
  const backendTrades = useQuery({
    queryKey: ["markets", "trades", token.address],
    queryFn: ({ signal }) => fetchMarketTrades(token.address, signal),
    enabled: backendEnabled,
    staleTime: 8_000,
    refetchInterval: 10_000,
  });
  const marketCapPoints = useMemo(
    () => toMarketCapPoints(points, token.price, token.marketCap),
    [points, token.marketCap, token.price],
  );
  const rpcCandles = useMemo(() => buildCandles(marketCapPoints, interval), [marketCapPoints, interval]);
  const candles = backendEnabled ? (backendCandles.data ?? []) : rpcCandles;
  const trades = backendEnabled ? (backendTrades.data?.items ?? []) : rpcTrades;
  const loading = backendEnabled ? backendCandles.isPending || backendTrades.isPending : rpcLoading;
  const error = backendEnabled ? backendCandles.error || backendTrades.error : rpcError;

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (backendEnabled || !publicClient || refreshKey === 0) return undefined;
    setRpcLoading(true);
    setRpcError("");
    setPoints([]);
    setRpcTrades([]);
    setHover(null);
    onMarketCapChange?.(null);
    void loadTradePoints(publicClient as unknown as ChartClient, token)
      .then(({ points: nextPoints, trades }) => {
        if (!cancelled) {
          setPoints(nextPoints);
          setRpcTrades(trades);
          onMarketCapChange?.(calculatePriceChange(nextPoints, token.price));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRpcError("Chart unavailable");
          onMarketCapChange?.(null);
        }
      })
      .finally(() => {
        if (!cancelled) setRpcLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [backendEnabled, publicClient, refreshKey, token.address, token.factory, token.price, onMarketCapChange]);

  useEffect(() => {
    if (!backendEnabled) return;
    onMarketCapChange?.(candlePriceChange(backendCandles.data ?? []));
  }, [backendCandles.data, backendEnabled, onMarketCapChange]);

  const chartInstanceRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const latestCandlesRef = useRef<MarketCandle[]>([]);
  const hoveringRef = useRef(false);
  useEffect(() => { latestCandlesRef.current = candles; }, [candles]);

  // Initialize the chart once; the update effect below pushes new data in
  // place via setOption. Re-initializing on every candles/interval/theme change
  // disposed and recreated the canvas each poll, which is the visible flicker.
  useEffect(() => {
    const container = chartRef.current;
    if (!container) return undefined;
    const chart = echarts.init(container, undefined, { renderer: "canvas" });
    chartInstanceRef.current = chart;
    chart.on("updateAxisPointer", (event) => {
      const pointer = event as { axesInfo?: { value?: number }[] };
      const current = latestCandlesRef.current;
      const index = pointer.axesInfo?.[0]?.value;
      if (index !== undefined && current[index]) {
        hoveringRef.current = true;
        setHover(current[index]);
      }
    });
    chart.getZr().on("globalout", () => {
      hoveringRef.current = false;
      const current = latestCandlesRef.current;
      setHover(current[current.length - 1]);
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  const previousIntervalRef = useRef(interval);
  useEffect(() => {
    const chart = chartInstanceRef.current;
    if (!chart || !candles.length) return undefined;
    const styles = getComputedStyle(document.documentElement);
    chart.setOption(buildMarketChartOptions(candles, {
      text: styles.getPropertyValue("--muted").trim(),
      grid: styles.getPropertyValue("--chart-grid").trim(),
      lime: styles.getPropertyValue("--lime").trim(),
      orange: styles.getPropertyValue("--orange").trim(),
    }, interval, usdPerEth));
    // Don't yank the OHLC readout back to the latest candle while the user is
    // examining an earlier bar; a fresh poll shouldn't disturb an active hover.
    // Switching interval rebuilds the view, so reset then.
    if (!hoveringRef.current || previousIntervalRef.current !== interval) {
      previousIntervalRef.current = interval;
      setHover(candles[candles.length - 1]);
    }
    return undefined;
  }, [candles, interval, themeVersion, usdPerEth]);

  return (
    <div className="market-main">
    <section className="market-chart-panel" aria-label={`${token.symbol} market cap chart`}>
      <header className="market-chart-head">
        <dl className="market-chart-ohlc" aria-label="Candle market cap and volume">
          <div><dt>O</dt><dd><UsdAmount weth={hover?.open} compact /></dd></div>
          <div><dt>H</dt><dd><UsdAmount weth={hover?.high} compact /></dd></div>
          <div><dt>L</dt><dd><UsdAmount weth={hover?.low} compact /></dd></div>
          <div><dt>C</dt><dd><UsdAmount weth={hover?.close} compact /></dd></div>
          <div><dt>Vol</dt><dd><UsdAmount weth={hover?.volume} compact /></dd></div>
        </dl>
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
        {!loading && error && <p className="market-chart-message">Chart unavailable</p>}
        {!loading && !error && !candles.length && (
          <p className="market-chart-message">No trades yet</p>
        )}
        <div ref={chartRef} className="market-chart-canvas" />
      </div>
    </section>
    <MarketActivity
      key={token.address}
      token={token}
      trades={trades}
      loading={loading}
      error={Boolean(error)}
      followingTraderCount={backendEnabled ? backendTrades.data?.followingTraderCount ?? 0 : 0}
    />
    </div>
  );
}
