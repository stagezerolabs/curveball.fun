// Dev-only sample data so the UI can be refined against a full-looking app while
// the deployed API has an empty database. Both helpers return [] in a production
// build, and real API rows always win — the mocks only fill an empty response.
//
// Deliberately varied: long names that must truncate, duplicate symbols, missing
// images, a broken image URL (exercises TokenAvatar's onError fallback), null
// market caps, and prices small enough to hit formatEthAmount's exponential path.
import type { Address } from "viem";
import type {
  Candle,
  CandleRange,
  Holder,
  LaunchpadConfig,
  Position,
  Token,
  Trade,
  TradePage,
} from "../types";

const ENABLED = import.meta.env.DEV;

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

const address = (seed: string) =>
  `0x${seed.repeat(40).slice(0, 40)}` as Address;

const avatar = (seed: string) =>
  `https://api.dicebear.com/9.x/shapes/svg?seed=${seed}`;

const TOKENS: Token[] = [
  {
    address: address("a1"),
    name: "Parabolic Pigeon",
    symbol: "PIGEON",
    creator: address("f0"),
    graduated: false,
    createdAt: minutesAgo(2),
    price: 4.12e-05,
    marketCap: 14.8,
    progress: 3.4,
    imageUrl: avatar("pigeon"),
    pool: null,
    change24h: 70.9,
    volume24h: 0.57,
    holders: 11,
    liquidity: null,
    peakMarketCap: 32.51,
    quoteSymbol: "ETH",
    priceHistory: [
      2.43102082247e-05,
      2.40259954835e-05,
      2.52417941685e-05,
      2.47066117024e-05,
      2.5637663847e-05,
      2.6043523483e-05,
      2.55041981103e-05,
      2.64502376639e-05,
      2.59040958393e-05,
      2.6717560955e-05,
      2.63729312139e-05,
      2.62181832612e-05,
      2.72291916216e-05,
      2.95672554067e-05,
      2.93957526463e-05,
      2.9731063813e-05,
      3.16193278684e-05,
      3.46867460167e-05,
      3.60932223948e-05,
      3.66670817631e-05,
      3.98958575099e-05,
      3.81598349413e-05,
      4.13214091381e-05,
      4.12e-05,
    ],
  },
  {
    address: address("a2"),
    name: "Gigantic Overengineered Reserve Protocol Token",
    symbol: "GORP",
    creator: address("f1"),
    graduated: false,
    createdAt: minutesAgo(19),
    price: 0.00031,
    marketCap: 61.2,
    progress: 27.9,
    imageUrl: null,
    pool: null,
    change24h: -22.7,
    volume24h: 3.32,
    holders: 43,
    liquidity: null,
    peakMarketCap: 204.35,
    quoteSymbol: "ETH",
    priceHistory: [
      0.0003788483673,
      0.000367148198237,
      0.000378478379642,
      0.000360716924935,
      0.000361713225901,
      0.000365021097845,
      0.000356375059502,
      0.000355688907243,
      0.000334172017133,
      0.000314900273479,
      0.000303439012135,
      0.000310512550267,
      0.000307771818006,
      0.000301110348415,
      0.000305090941077,
      0.000303922429348,
      0.00029737948959,
      0.000309687510044,
      0.000317134722586,
      0.000305969072219,
      0.000309709366594,
      0.000310742675584,
      0.000324359885283,
      0.00031,
    ],
  },
  {
    address: address("a3"),
    name: "PepeCurve",
    symbol: "PEPE",
    creator: address("f2"),
    graduated: false,
    createdAt: minutesAgo(44),
    price: 0.0021,
    marketCap: 412.6,
    progress: 88.1,
    imageUrl: avatar("pepecurve"),
    pool: null,
    change24h: 416.6,
    volume24h: 16.9,
    holders: 318,
    liquidity: null,
    peakMarketCap: 3129.28,
    quoteSymbol: "ETH",
    priceHistory: [
      0.000500489558956,
      0.000547095000353,
      0.000612306239864,
      0.000702042679354,
      0.000742621940218,
      0.000813079341484,
      0.000839615606423,
      0.000930704263876,
      0.00103333371538,
      0.00111350002096,
      0.00123413565134,
      0.00127315730109,
      0.00137189786591,
      0.00145362486897,
      0.00153219890077,
      0.00158723565461,
      0.0017160842757,
      0.00186250260737,
      0.00189629647645,
      0.00197439093102,
      0.00190170396252,
      0.00201378402272,
      0.00209244629974,
      0.0021,
    ],
  },
  {
    address: address("a4"),
    name: "Pepe 2.0",
    symbol: "PEPE",
    creator: address("f3"),
    graduated: false,
    createdAt: minutesAgo(96),
    price: 8e-05,
    marketCap: 22.4,
    progress: 11.7,
    imageUrl: "https://example.invalid/broken.png",
    pool: null,
    change24h: 0.04,
    volume24h: 0.04,
    holders: 6,
    liquidity: null,
    peakMarketCap: 50.4,
    quoteSymbol: "ETH",
    priceHistory: [
      7.79022895256e-05,
      7.69258413548e-05,
      7.86224260867e-05,
      7.41835535364e-05,
      7.41333862861e-05,
      7.14891116983e-05,
      6.8677121044e-05,
      6.57084038598e-05,
      6.87166480028e-05,
      6.64124117702e-05,
      6.53715728759e-05,
      6.56413817694e-05,
      6.97636114807e-05,
      6.71829726771e-05,
      6.80550264349e-05,
      6.97860018388e-05,
      7.4273330539e-05,
      7.79371034079e-05,
      8.1685066937e-05,
      7.91760907284e-05,
      7.85772891697e-05,
      7.77198406354e-05,
      8.24430489541e-05,
      8e-05,
    ],
  },
  {
    address: address("a5"),
    name: "Icarus Wax",
    symbol: "WAX",
    creator: address("f4"),
    graduated: false,
    createdAt: minutesAgo(140),
    price: 0.0094,
    marketCap: 903.4,
    progress: 99.2,
    imageUrl: avatar("wax"),
    pool: null,
    change24h: -0.1,
    volume24h: 32.0,
    holders: 512,
    liquidity: null,
    peakMarketCap: 1395.64,
    quoteSymbol: "ETH",
    priceHistory: [
      0.00904342535643,
      0.00876804523373,
      0.00851619589672,
      0.0085429145663,
      0.00867713377538,
      0.00846813784738,
      0.00801597951986,
      0.00801942570684,
      0.00797989024913,
      0.00813809171462,
      0.00867071031756,
      0.0089250153621,
      0.00898118876864,
      0.00914599723857,
      0.00936478057082,
      0.00886748279817,
      0.00935918969968,
      0.00967945425142,
      0.0100678885307,
      0.0102941852302,
      0.00993769434663,
      0.00963799279932,
      0.00906046360334,
      0.0094,
    ],
  },
  {
    address: address("a6"),
    name: "no cap",
    symbol: "NOCAP",
    creator: address("f5"),
    graduated: false,
    createdAt: minutesAgo(210),
    price: null,
    marketCap: null,
    progress: 0,
    imageUrl: null,
    pool: null,
    change24h: null,
    volume24h: null,
    holders: null,
    liquidity: null,
    peakMarketCap: null,
    quoteSymbol: "ETH",
    priceHistory: null,
  },
  {
    address: address("a7"),
    name: "Rug Insurance",
    symbol: "SAFU",
    creator: address("f6"),
    graduated: false,
    createdAt: minutesAgo(320),
    price: 0.00067,
    marketCap: 148.9,
    progress: 54.3,
    imageUrl: avatar("safu"),
    pool: null,
    change24h: 143.8,
    volume24h: 8.8,
    holders: 97,
    liquidity: null,
    peakMarketCap: 469.75,
    quoteSymbol: "ETH",
    priceHistory: [
      0.000277013500812,
      0.000284418686794,
      0.000290419436058,
      0.000302920517633,
      0.000305010408191,
      0.000305928300625,
      0.000313351954949,
      0.000319345421389,
      0.000336034666922,
      0.00033916524428,
      0.000378031562126,
      0.000405665274049,
      0.000410584664236,
      0.000421961576677,
      0.000439037929278,
      0.000457543893313,
      0.000463392958553,
      0.000512311639954,
      0.000568907704977,
      0.000586804300934,
      0.000606464918523,
      0.000597505708017,
      0.000605229433643,
      0.00067,
    ],
  },
  {
    address: address("a8"),
    name: "Midcurve Maxi",
    symbol: "MID",
    creator: address("f7"),
    graduated: false,
    createdAt: minutesAgo(880),
    price: 0.00014,
    marketCap: 38.1,
    progress: 19.6,
    imageUrl: avatar("mid"),
    pool: null,
    change24h: -37.1,
    volume24h: 1.2,
    holders: 24,
    liquidity: null,
    peakMarketCap: 287.87,
    quoteSymbol: "ETH",
    priceHistory: [
      0.000227918288849,
      0.000214836034644,
      0.000199139649802,
      0.000207100569088,
      0.000204447795345,
      0.0001923856463,
      0.000190472023223,
      0.000176692859854,
      0.000174995564614,
      0.000182710798389,
      0.000187626035839,
      0.000188379889643,
      0.000178948101038,
      0.000172544906285,
      0.000162396391542,
      0.000165207311799,
      0.000162702538109,
      0.00016490767107,
      0.000157385646682,
      0.0001486778055,
      0.000152066131152,
      0.000156892986844,
      0.00015508549168,
      0.00014,
    ],
  },
  {
    address: address("b1"),
    name: "Sunfall",
    symbol: "SUN",
    creator: address("f8"),
    graduated: true,
    createdAt: minutesAgo(1500),
    price: 0.0412,
    marketCap: 4218.7,
    progress: 100,
    imageUrl: avatar("sunfall"),
    pool: address("c8"),
    change24h: 27352.5,
    volume24h: 104.6,
    holders: 1840,
    liquidity: 1040.0,
    peakMarketCap: 31248.62,
    quoteSymbol: "ETH",
    priceHistory: [
      0.00186481079032,
      0.00351388691043,
      0.00523432970873,
      0.00685625668254,
      0.00818591188972,
      0.00945978361363,
      0.0109727306217,
      0.0124337035103,
      0.01451884833,
      0.0170929605531,
      0.0187066477155,
      0.0214179297823,
      0.0243207674172,
      0.02718315885,
      0.0281432880573,
      0.0286499807047,
      0.0292796297014,
      0.029916899997,
      0.0307361087609,
      0.0332864852029,
      0.0368638468101,
      0.0398152027819,
      0.0404095290274,
      0.0412,
    ],
  },
  {
    address: address("b2"),
    name: "Terminal Velocity",
    symbol: "TERM",
    creator: address("f9"),
    graduated: true,
    createdAt: minutesAgo(2900),
    price: 0.0178,
    marketCap: 2044.3,
    progress: 100,
    imageUrl: null,
    pool: address("c9"),
    change24h: -65.0,
    volume24h: 44.1,
    holders: 760,
    liquidity: 115.4,
    peakMarketCap: 7841.4,
    quoteSymbol: "ETH",
    priceHistory: [
      0.0469457243249,
      0.0465831760793,
      0.0475654963601,
      0.0477594369882,
      0.0476950532424,
      0.0459959018576,
      0.0426550608464,
      0.042672969172,
      0.0402607699947,
      0.0402167519503,
      0.0408917782861,
      0.0386043657488,
      0.036413840681,
      0.0366740247476,
      0.035775934892,
      0.0323618974838,
      0.0290932907636,
      0.0262620626189,
      0.0261275889798,
      0.0254230501208,
      0.0224378481967,
      0.021771041904,
      0.0210403322506,
      0.0178,
    ],
  },
  {
    address: address("b3"),
    name: "Feather & Wax",
    symbol: "FTHR",
    creator: address("f10"),
    graduated: true,
    createdAt: minutesAgo(4320),
    price: 0.0089,
    marketCap: 1187.05,
    progress: 100,
    imageUrl: avatar("feather"),
    pool: address("c10"),
    change24h: 1.0,
    volume24h: 9.7,
    holders: 455,
    liquidity: 56.2,
    peakMarketCap: 9906.98,
    quoteSymbol: "ETH",
    priceHistory: [
      0.00886700718843,
      0.00847579339807,
      0.0080010143366,
      0.0084959350648,
      0.00866873346449,
      0.00870855626891,
      0.00917234155348,
      0.00908346676766,
      0.00947720583858,
      0.00980965030415,
      0.00940452644761,
      0.00908565159128,
      0.00884445668195,
      0.00857413150211,
      0.00869565318949,
      0.00846726075639,
      0.00843906414179,
      0.00813130497262,
      0.00865949765798,
      0.00855565929813,
      0.00859878923218,
      0.00878519664428,
      0.00926881752218,
      0.0089,
    ],
  },
  {
    address: address("b4"),
    name: "dust",
    symbol: "DUST",
    creator: address("f11"),
    graduated: true,
    createdAt: minutesAgo(8600),
    price: 9.1e-07,
    marketCap: 0.0042,
    progress: 100,
    imageUrl: avatar("dust"),
    pool: address("c11"),
    change24h: 454.6,
    volume24h: 0.0,
    holders: 3,
    liquidity: 38.6,
    peakMarketCap: 0.03,
    quoteSymbol: "ETH",
    priceHistory: [
      1.95194596292e-07,
      2.27018539389e-07,
      2.58703522922e-07,
      2.7477611133e-07,
      3.04563036514e-07,
      3.24846504964e-07,
      3.38017536525e-07,
      3.83798546829e-07,
      4.01595794967e-07,
      4.34211993412e-07,
      4.79930645289e-07,
      5.16265429316e-07,
      5.382959156e-07,
      5.73272440453e-07,
      6.10759192277e-07,
      6.64842814206e-07,
      6.64062423596e-07,
      7.04001210674e-07,
      7.17087105931e-07,
      7.36473297666e-07,
      8.03916536757e-07,
      8.40021859839e-07,
      8.81233414022e-07,
      9.1e-07,
    ],
  },
];

export function mockTokens(): Token[] {
  return ENABLED ? TOKENS : [];
}

export function mockTrades(tokenAddress: string): Trade[] {
  if (!ENABLED) return [];
  // Deterministic per token so each market page looks distinct but stable.
  const seed = Number.parseInt(tokenAddress.slice(2, 6), 16) || 1;
  const count = 4 + (seed % 4);
  return Array.from({ length: count }, (_, index) => {
    const step = seed + index * 7919;
    const tokens = BigInt(120_000 + (step % 880_000)) * 10n ** 12n;
    const quote = BigInt(300 + (step % 9_700)) * 10n ** 13n;
    return {
      id: `${tokenAddress}-${index}`,
      side: step % 3 === 0 ? "sell" : "buy",
      amount: tokens.toString(),
      quote: quote.toString(),
      tx: `0x${(step * 2654435761).toString(16).padStart(8, "0").repeat(8).slice(0, 64)}`,
      trader: `0x${((step * 40503) % 0xffffffff).toString(16).padStart(8, "0").repeat(5)}`,
      tradedAt: new Date(Date.now() - (index + 1) * 137_000).toISOString(),
    } satisfies Trade;
  });
}

function seedOf(address: string) {
  return Number.parseInt(address.slice(2, 6), 16) || 1;
}

const RANGE_SHAPE: Record<CandleRange, { points: number; stepMs: number }> = {
  "5min": { points: 20, stepMs: 15_000 },
  "1h": { points: 60, stepMs: 60_000 },
  "6h": { points: 72, stepMs: 300_000 },
  "1D": { points: 96, stepMs: 900_000 },
  all: { points: 30, stepMs: 86_400_000 },
};

export function mockCandles(address: string, range: CandleRange): Candle[] {
  if (!ENABLED) return [];
  const token = TOKENS.find((item) => item.address === address);
  const base = token?.price ?? 0.0001;
  const { points, stepMs } = RANGE_SHAPE[range];
  const seed = seedOf(address);
  const out: Candle[] = [];
  let value = base * 0.45;
  for (let index = 0; index < points; index += 1) {
    // Deterministic pseudo-noise with a rise into a peak and a fade out, so the
    // chart has a shape worth looking at instead of a straight line.
    const wave = Math.sin((index / points) * Math.PI * 1.7 + seed) * 0.28;
    const drift = (base - value) / Math.max(1, points - index);
    const jitter = (((seed * (index + 7)) % 97) / 97 - 0.5) * value * 0.09;
    value = Math.max(base * 0.05, value + drift + value * wave * 0.12 + jitter);
    out.push({
      t: new Date(Date.now() - (points - 1 - index) * stepMs).toISOString(),
      price: value,
    });
  }
  out[out.length - 1].price = base;
  return out;
}

export function mockHolders(address: string): Holder[] {
  if (!ENABLED) return [];
  const token = TOKENS.find((item) => item.address === address);
  const count = Math.min(24, token?.holders ?? 0);
  const seed = seedOf(address);
  let remaining = 1;
  return Array.from({ length: count }, (_, index) => {
    const share = index === count - 1 ? remaining : remaining * 0.34;
    remaining -= share;
    return {
      address: `0x${(((seed + index) * 2654435761) >>> 0).toString(16).padStart(8, "0").repeat(5)}`,
      balance: share * 1_000_000_000,
    };
  });
}

export function mockPosition(address: string, wallet: string): Position {
  if (!ENABLED) return { balance: 0, invested: 0, proceeds: 0, avgCost: null, trades: 0 };
  const seed = (seedOf(address) + Number.parseInt(wallet.slice(2, 6), 16)) % 997;
  const balance = (seed % 50) * 12_500;
  const avgCost = (TOKENS.find((item) => item.address === address)?.price ?? 0.0001) * 0.7;
  return {
    balance,
    invested: balance * avgCost,
    proceeds: (seed % 7) * 0.4,
    avgCost: balance > 0 ? avgCost : null,
    trades: seed % 12,
  };
}

export function mockTradePage(
  address: string,
  page: number,
  limit: number,
): TradePage {
  if (!ENABLED) return { rows: [], total: 0, page, limit };
  const seed = seedOf(address);
  const total = 40 + (seed % 400);
  const rows = Array.from({ length: Math.min(limit, Math.max(0, total - (page - 1) * limit)) }, (_, index) => {
    const offset = (page - 1) * limit + index;
    const [row] = mockTrades(`0x${(seed + offset).toString(16).padStart(4, "0")}`);
    return {
      ...row,
      id: `${address}-${offset}`,
      tradedAt: new Date(Date.now() - (offset + 1) * 137_000).toISOString(),
    };
  });
  return { rows, total, page, limit };
}

export function mockConfig(): LaunchpadConfig | null {
  if (!ENABLED) return null;
  return {
    quoteSymbol: "ETH",
    quoteToken: address("bb"),
    targetPrice: 0.0000451,
    creatorShareBps: 6000,
    treasury: address("ee"),
    locker: address("dd"),
  };
}
