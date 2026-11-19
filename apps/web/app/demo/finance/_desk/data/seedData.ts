import type {
  DeskState,
  EquityPoint,
  EquityTimeframe,
  FeedDiagnostic,
  MarketTicker,
  Order,
  OrderBookLevel,
  PitchTeam,
  Position,
} from '../types/command';
import { seedBars } from '../utils/candles';

const tickerSeeds: Omit<MarketTicker, 'candles'>[] = [
  {
    symbol: 'NVDA-P',
    name: 'NVIDIA Compute Perp',
    sector: 'Perps',
    price: 148.42,
    prevPrice: 146.9,
    changePct24h: 4.18,
    volume24h: 418500000,
    spreadBps: 1.4,
    high24h: 150.1,
    low24h: 141.8,
    sparkline: [141.8, 142.4, 143.1, 144.6, 144.2, 145.9, 146.5, 147.2, 146.9, 148.42],
  },
  {
    symbol: 'BTC-PERP',
    name: 'Bitcoin Perpetual Index',
    sector: 'Perps',
    price: 94215.5,
    prevPrice: 93880.0,
    changePct24h: 2.64,
    volume24h: 1290400000,
    spreadBps: 0.8,
    high24h: 94950.0,
    low24h: 91240.0,
    sparkline: [91400, 91850, 92100, 92950, 92600, 93210, 93640, 93880, 94050, 94215.5],
  },
  {
    symbol: 'SOL-PERP',
    name: 'Solana Liquidity Perp',
    sector: 'Perps',
    price: 214.86,
    prevPrice: 216.2,
    changePct24h: -1.42,
    volume24h: 342800000,
    spreadBps: 2.1,
    high24h: 221.4,
    low24h: 211.9,
    sparkline: [220.4, 219.8, 218.5, 217.2, 218.9, 217.4, 216.6, 216.2, 215.4, 214.86],
  },
  {
    symbol: 'PLTR-EQ',
    name: 'Palantir Synthetic Eq',
    sector: 'Equities',
    price: 63.18,
    prevPrice: 61.95,
    changePct24h: 3.74,
    volume24h: 184200000,
    spreadBps: 1.9,
    high24h: 63.9,
    low24h: 60.4,
    sparkline: [60.6, 61.1, 60.9, 61.4, 61.8, 62.1, 61.95, 62.4, 62.85, 63.18],
  },
  {
    symbol: 'TSLA-26C',
    name: 'Tesla Volatility Contract',
    sector: 'Equities',
    price: 342.1,
    prevPrice: 345.6,
    changePct24h: -2.08,
    volume24h: 274600000,
    spreadBps: 2.6,
    high24h: 351.2,
    low24h: 339.4,
    sparkline: [350.1, 349.4, 348.2, 347.9, 346.5, 346.8, 345.6, 344.2, 343.1, 342.1],
  },
  {
    symbol: 'KRNL-V',
    name: 'KernelZero Series A Note',
    sector: 'Venture',
    price: 18.75,
    prevPrice: 17.4,
    changePct24h: 11.4,
    volume24h: 12450000,
    spreadBps: 6.4,
    high24h: 19.2,
    low24h: 16.8,
    sparkline: [16.8, 17.0, 17.25, 17.1, 17.4, 17.85, 18.1, 18.4, 18.6, 18.75],
  },
  {
    symbol: 'HELI-V',
    name: 'Helios Grid Seed Warrant',
    sector: 'Venture',
    price: 12.4,
    prevPrice: 11.9,
    changePct24h: 6.9,
    volume24h: 8920000,
    spreadBps: 7.2,
    high24h: 12.65,
    low24h: 11.5,
    sparkline: [11.5, 11.7, 11.65, 11.85, 11.9, 12.05, 12.15, 12.2, 12.32, 12.4],
  },
  {
    symbol: 'FED-25BP',
    name: 'FOMC 25bps Cut Binary',
    sector: 'Macro',
    price: 0.74,
    prevPrice: 0.71,
    changePct24h: 4.23,
    volume24h: 54100000,
    spreadBps: 4.5,
    high24h: 0.76,
    low24h: 0.69,
    sparkline: [0.69, 0.7, 0.7, 0.71, 0.72, 0.71, 0.73, 0.73, 0.74, 0.74],
  },
];

const extraListings: Record<MarketTicker['sector'], readonly [string, string, number][]> = {
  Perps: [
    ['ETH-PERP', 'Ethereum Index', 3120], ['XRP-PERP', 'XRP Index', 1.84],
    ['ADA-PERP', 'Cardano Index', 0.62], ['DOGE-PERP', 'Dogecoin Index', 0.18],
    ['AVAX-PERP', 'Avalanche Index', 36.12], ['LINK-PERP', 'Chainlink Index', 18.74],
    ['DOT-PERP', 'Polkadot Index', 6.35], ['LTC-PERP', 'Litecoin Index', 88.21],
    ['SUI-PERP', 'Sui Index', 3.22], ['ATOM-PERP', 'Cosmos Index', 8.47],
  ],
  Equities: [
    ['AAPL-EQ', 'Apple Synthetic', 214.05], ['MSFT-EQ', 'Microsoft Synthetic', 431.92],
    ['AMZN-EQ', 'Amazon Synthetic', 195.62], ['GOOG-EQ', 'Alphabet Synthetic', 178.12],
    ['META-EQ', 'Meta Synthetic', 583.45], ['AMD-EQ', 'AMD Synthetic', 152.23],
    ['AVGO-EQ', 'Broadcom Synthetic', 219.74], ['JPM-EQ', 'JPMorgan Synthetic', 247.53],
    ['COST-EQ', 'Costco Synthetic', 925.3], ['ORCL-EQ', 'Oracle Synthetic', 164.58],
    ['UBER-EQ', 'Uber Synthetic', 82.94], ['SPOT-EQ', 'Spotify Synthetic', 654.2],
  ],
  Venture: [
    ['NOVA-V', 'Nova Nutrition', 12.4], ['GRID-V', 'GridWise Energy', 9.8],
    ['MINT-V', 'Mint Mobility', 13.1], ['LUMA-V', 'Luma Living', 8.9],
    ['VITA-V', 'VitaCart', 10.6], ['ORBI-V', 'Orbit Health', 11.2],
    ['FRPK-V', 'FreshPack Foods', 11.8], ['QAAC-V', 'AquaCare', 10.03],
    ['RELY-V', 'Relay Logistics', 15.26], ['TIDE-V', 'Tide Water Systems', 9.42],
  ],
  Macro: [
    ['GOLD-M', 'Gold Benchmark', 2638.5], ['SILV-M', 'Silver Benchmark', 30.72],
    ['WTI-M', 'WTI Crude', 72.44], ['BRENT-M', 'Brent Crude', 76.31],
    ['GAS-M', 'Natural Gas', 3.17], ['COPR-M', 'Copper Benchmark', 4.21],
    ['DXY-M', 'US Dollar Index', 104.36], ['EURUSD-M', 'Euro / Dollar', 1.086],
    ['SPX-M', 'US Large-Cap Index', 5864.5], ['NDX-M', 'Nasdaq-100 Index', 20582.4],
  ],
};

const moves = [2.31, -0.68, 5.62, -3.44, 0, 1.26, -5.13, 0.43, -1.82, 3.75];
const extraSeeds = (Object.keys(extraListings) as MarketTicker['sector'][]).flatMap((sector, group) =>
  extraListings[sector].map(([symbol, name, price], index) => {
    const changePct24h = moves[(group * 3 + index) % moves.length]!;
    const start = price / (1 + changePct24h / 100);
    const decimals = price < 2 ? 3 : 2;
    const sparkline = Array.from({ length: 10 }, (_, i) =>
      Number((start + (price - start) * i / 9 + price * 0.006 * Math.sin(i * Math.PI / 9) * Math.sin(i + index)).toFixed(decimals)),
    );
    return {
      symbol, name, sector, price, changePct24h, sparkline, prevPrice: sparkline[8]!,
      volume24h: (group + 1) * (index + 3) * 970_000, spreadBps: 1.2 + group * 1.2 + index * 0.1,
      high24h: Number((Math.max(...sparkline) * 1.005).toFixed(decimals)),
      low24h: Number((Math.min(...sparkline) * 0.995).toFixed(decimals)),
    };
  }),
);

export const SEED_TICKERS: MarketTicker[] = [...tickerSeeds, ...extraSeeds].map((ticker) => ({ ...ticker, candles: seedBars(ticker) }));

export const SEED_POSITIONS: Position[] = [
  {
    symbol: 'NVDA-P',
    side: 'LONG',
    qty: 850,
    avgEntry: 141.2,
    leverage: 3,
    liquidationPrice: 98.4,
    sector: 'Perps',
  },
  {
    symbol: 'BTC-PERP',
    side: 'LONG',
    qty: 1.45,
    avgEntry: 91640.0,
    leverage: 4,
    liquidationPrice: 71200.0,
    sector: 'Perps',
  },
  {
    symbol: 'TSLA-26C',
    side: 'SHORT',
    qty: 180,
    avgEntry: 348.5,
    leverage: 2,
    liquidationPrice: 482.1,
    sector: 'Equities',
  },
  {
    symbol: 'KRNL-V',
    side: 'LONG',
    qty: 4200,
    avgEntry: 16.95,
    leverage: 1,
    liquidationPrice: 0,
    sector: 'Venture',
  },
  {
    symbol: 'FED-25BP',
    side: 'LONG',
    qty: 28000,
    avgEntry: 0.69,
    leverage: 1,
    liquidationPrice: 0,
    sector: 'Macro',
  },
];

export const SEED_ORDERS: Order[] = [
  {
    id: 'ORD-8841',
    timestamp: '03:41:12',
    symbol: 'NVDA-P',
    side: 'BUY',
    type: 'LIMIT',
    qty: 200,
    limitPrice: 145.5,
    status: 'OPEN',
    notional: 29100,
  },
  {
    id: 'ORD-8840',
    timestamp: '03:38:44',
    symbol: 'SOL-PERP',
    side: 'SELL',
    type: 'LIMIT',
    qty: 120,
    limitPrice: 219.0,
    status: 'OPEN',
    notional: 26280,
  },
  {
    id: 'ORD-8839',
    timestamp: '03:24:09',
    symbol: 'KRNL-V',
    side: 'BUY',
    type: 'MARKET',
    qty: 1200,
    fillPrice: 17.85,
    status: 'FILLED',
    notional: 21420,
  },
  {
    id: 'ORD-8838',
    timestamp: '03:12:51',
    symbol: 'BTC-PERP',
    side: 'BUY',
    type: 'MARKET',
    qty: 0.45,
    fillPrice: 92950.0,
    status: 'FILLED',
    notional: 41827.5,
  },
  {
    id: 'ORD-8837',
    timestamp: '02:54:18',
    symbol: 'TSLA-26C',
    side: 'SELL',
    type: 'MARKET',
    qty: 180,
    fillPrice: 348.5,
    status: 'FILLED',
    notional: 62730,
  },
];

export const SEED_PITCH_TEAMS: PitchTeam[] = [
  {
    id: 'team-krnl',
    ticker: 'KRNL-V',
    name: 'KernelZero Systems',
    founder: 'Maya Lin & Arjun Rao',
    institution: 'MIT CSAIL / Stanford',
    sector: 'Deterministic GPU Scheduling',
    pitchSlot: 'Slot 01 · 04:00 EST',
    impliedValuationM: 42.5,
    backingTotal: 318400,
    changePct: 11.4,
    judgesScore: 9.2,
    thesisSummary:
      'KernelZero replaces static CUDA thread-block allocation with sub-microsecond eBPF hardware telemetry scheduling, reclaiming 34% idle H100 tensor capacity across multi-tenant inference clusters.',
    moat: 'Patent-pending zero-copy driver shim operating below PyTorch/vLLM runtime layers with deterministic tail-latency SLAs.',
    unitEconomics: '$18,400 ACV pilot across 4 quant funds; 89% gross software margin with <14 day payback.',
    riskFactor: 'Hyperscaler native scheduler bundling in next-gen GPU firmware releases.',
    sparkline: [16.8, 17.0, 17.25, 17.4, 17.85, 18.1, 18.4, 18.75],
  },
  {
    id: 'team-heli',
    ticker: 'HELI-V',
    name: 'Helios Grid Markets',
    founder: 'Devon Mercer',
    institution: 'ETH Zurich / Chicago Booth',
    sector: 'Sub-Second Energy Clearing',
    pitchSlot: 'Slot 02 · 04:20 EST',
    impliedValuationM: 28.0,
    backingTotal: 214900,
    changePct: 6.9,
    judgesScore: 8.7,
    thesisSummary:
      'Automated battery-storage dispatch and nodal ERCOT power arbitrage engine delivering synthetic firming contracts to hyperscale AI data centers.',
    moat: 'Direct ISO telemetry integration across 640MW of contracted utility-scale LFP battery capacity.',
    unitEconomics: '14 bps clearing fee on cleared MWh volume; $2.1M annualized net fee run-rate.',
    riskFactor: 'FERC interconnection queue delays and regional basis spread compression.',
    sparkline: [11.5, 11.7, 11.8, 11.9, 12.05, 12.15, 12.32, 12.4],
  },
  {
    id: 'team-vlt',
    ticker: 'VLTX-V',
    name: 'Vaultex Settlement',
    founder: 'Elena Rostova & Samira Patel',
    institution: 'Wharton / Penn Engineering',
    sector: 'Cross-Margin Treasury Rails',
    pitchSlot: 'Slot 03 · 04:40 EST',
    impliedValuationM: 35.2,
    backingTotal: 192500,
    changePct: 3.1,
    judgesScore: 8.4,
    thesisSummary:
      'Unified T-bill collateralization rail enabling quantitative desks to post tokenized money-market yield directly as initial margin across prime brokers.',
    moat: 'Bankruptcy-remote tri-party custody structure pre-cleared with two Tier-1 clearing members.',
    unitEconomics: '22 bps AUM spread + institutional API platform subscription ($4,500/mo).',
    riskFactor: 'Prime brokerage onboarding cycles averaging 5–8 months.',
    sparkline: [14.1, 14.0, 14.2, 14.3, 14.15, 14.35, 14.48, 14.54],
  },
  {
    id: 'team-aegis',
    ticker: 'AEGS-V',
    name: 'Aegis BioCompute',
    founder: 'Dr. Kenji Takahashi',
    institution: 'Caltech / UCSF',
    sector: 'Closed-Loop Assay Verification',
    pitchSlot: 'Slot 04 · 05:00 EST',
    impliedValuationM: 21.8,
    backingTotal: 146200,
    changePct: -2.4,
    judgesScore: 7.9,
    thesisSummary:
      'High-throughput robotic wet-lab verification API that prices binding-affinity assay validation dynamically for computational protein teams.',
    moat: 'Proprietary microfluidic cartridge reducing reagent cost per assay by 68%.',
    unitEconomics: '$420 per validated target run; 61% hardware-amortized gross margin.',
    riskFactor: 'Capital intensity of expanding regional wet-lab nodes.',
    sparkline: [11.4, 11.3, 11.2, 11.35, 11.1, 11.05, 10.95, 10.88],
  },
  {
    id: 'team-strt',
    ticker: 'STRT-V',
    name: 'Strata Underwriting',
    founder: 'Lucas Vance',
    institution: 'Harvard / Columbia',
    sector: 'Parametric Supply-Chain Risk',
    pitchSlot: 'Slot 05 · 05:20 EST',
    impliedValuationM: 19.4,
    backingTotal: 118800,
    changePct: 1.8,
    judgesScore: 7.6,
    thesisSummary:
      'Real-time AIS maritime & port congestion underwriting engine issuing parametric delay hedges to semiconductor and automotive OEMs.',
    moat: '12-year historical customs & satellite SAR dataset calibrated for container dwell anomalies.',
    unitEconomics: '1.6% net underwriting spread on insured cargo notional.',
    riskFactor: 'Correlated geopolitical chokepoint claims during extreme tail events.',
    sparkline: [9.4, 9.45, 9.42, 9.5, 9.52, 9.55, 9.54, 9.58],
  },
];

export const EQUITY_SERIES: Record<EquityTimeframe, EquityPoint[]> = {
  '1H': [
    { label: '02:45', nav: 479200, benchmark: 468100, drawdownPct: -0.6 },
    { label: '02:55', nav: 481500, benchmark: 469000, drawdownPct: -0.4 },
    { label: '03:05', nav: 480400, benchmark: 468400, drawdownPct: -0.7 },
    { label: '03:15', nav: 484900, benchmark: 469800, drawdownPct: -0.2 },
    { label: '03:25', nav: 487300, benchmark: 470500, drawdownPct: -0.1 },
    { label: '03:35', nav: 489600, benchmark: 470100, drawdownPct: 0.0 },
    { label: '03:45', nav: 492450, benchmark: 471200, drawdownPct: 0.0 },
  ],
  '4H': [
    { label: '00:00', nav: 458200, benchmark: 454000, drawdownPct: -1.8 },
    { label: '00:40', nav: 462800, benchmark: 455900, drawdownPct: -1.2 },
    { label: '01:20', nav: 460100, benchmark: 454800, drawdownPct: -1.9 },
    { label: '02:00', nav: 471400, benchmark: 461200, drawdownPct: -0.9 },
    { label: '02:40', nav: 478600, benchmark: 466800, drawdownPct: -0.5 },
    { label: '03:20', nav: 486200, benchmark: 469900, drawdownPct: -0.2 },
    { label: '03:45', nav: 492450, benchmark: 471200, drawdownPct: 0.0 },
  ],
  '12H': [
    { label: '16:00', nav: 432000, benchmark: 432000, drawdownPct: -2.4 },
    { label: '18:00', nav: 438500, benchmark: 434200, drawdownPct: -1.6 },
    { label: '20:00', nav: 435900, benchmark: 436100, drawdownPct: -2.2 },
    { label: '22:00', nav: 449200, benchmark: 444500, drawdownPct: -1.1 },
    { label: '00:00', nav: 458200, benchmark: 454000, drawdownPct: -0.8 },
    { label: '02:00', nav: 471400, benchmark: 461200, drawdownPct: -0.3 },
    { label: '03:45', nav: 492450, benchmark: 471200, drawdownPct: 0.0 },
  ],
  ALL: [
    { label: 'R1 Start', nav: 400000, benchmark: 400000, drawdownPct: 0.0 },
    { label: 'R1 Close', nav: 416400, benchmark: 408200, drawdownPct: -1.4 },
    { label: 'R2 Open', nav: 424900, benchmark: 419500, drawdownPct: -2.1 },
    { label: 'R2 Mid', nav: 438500, benchmark: 434200, drawdownPct: -1.6 },
    { label: 'R3 Open', nav: 458200, benchmark: 454000, drawdownPct: -0.8 },
    { label: 'R3 Mid', nav: 478600, benchmark: 466800, drawdownPct: -0.3 },
    { label: 'Live', nav: 492450, benchmark: 471200, drawdownPct: 0.0 },
  ],
};

export const SEED_DIAGNOSTICS: FeedDiagnostic[] = [
  {
    id: 'feed-l2',
    channel: 'L2 Order Book Aggregator',
    protocol: 'WSS / Protobuf',
    endpoint: 'wss://feed.matrixcommand.internal/v2/book',
    latencyMs: 4.2,
    msgPerSec: 1840,
    status: 'NOMINAL',
  },
  {
    id: 'feed-exec',
    channel: 'Execution Matching Engine',
    protocol: 'REST + FIX 4.4',
    endpoint: 'https://exec.matrixcommand.internal/api/orders',
    latencyMs: 11.8,
    msgPerSec: 312,
    status: 'NOMINAL',
  },
  {
    id: 'feed-risk',
    channel: 'Cross-Margin Risk VaR Worker',
    protocol: 'gRPC-Web Stream',
    endpoint: 'https://risk.matrixcommand.internal/v1/var',
    latencyMs: 18.4,
    msgPerSec: 94,
    status: 'NOMINAL',
  },
  {
    id: 'feed-arena',
    channel: 'Venture Pitch Clearing Feed',
    protocol: 'WSS JSON',
    endpoint: 'wss://arena.matrixcommand.internal/stream',
    latencyMs: 26.1,
    msgPerSec: 42,
    status: 'NOMINAL',
  },
];

export const INITIAL_DESK_STATE: DeskState = {
  cash: 266000.0,
  initialCapital: 400000.0,
  realizedPnl: 14820.5,
  tickers: SEED_TICKERS,
  positions: SEED_POSITIONS,
  orders: SEED_ORDERS,
  pitchTeams: SEED_PITCH_TEAMS,
  selectedSymbol: 'NVDA-P',
  isStreaming: true,
};

export function buildOrderBookForPrice(price: number): {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
} {
  const step = price >= 1000 ? 12.5 : price >= 100 ? 0.18 : price >= 10 ? 0.05 : 0.005;
  const sizes = [142, 285, 410, 690, 940, 1280];

  const asks: OrderBookLevel[] = [];
  let askCum = 0;
  for (let i = 0; i < 6; i++) {
    const levelPrice = Number((price + step * (i + 1)).toFixed(price < 2 ? 3 : 2));
    const size = sizes[i] + ((Math.round(price * 10) + i * 37) % 140);
    askCum += size;
    asks.push({ price: levelPrice, size, total: askCum });
  }

  const bids: OrderBookLevel[] = [];
  let bidCum = 0;
  for (let i = 0; i < 6; i++) {
    const levelPrice = Number(Math.max(0.01, price - step * (i + 1)).toFixed(price < 2 ? 3 : 2));
    const size = sizes[i] + ((Math.round(price * 13) + i * 29) % 150);
    bidCum += size;
    bids.push({ price: levelPrice, size, total: bidCum });
  }

  return { asks: asks.reverse(), bids };
}
