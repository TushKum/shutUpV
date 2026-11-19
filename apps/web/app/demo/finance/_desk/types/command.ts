import type { Candle } from '@/lib/chart';

export type ScreenId =
  | 'overview'
  | 'markets'
  | 'arena'
  | 'risk';

export type AssetSector = 'Perps' | 'Equities' | 'Venture' | 'Macro';

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
export type OrderStatus = 'FILLED' | 'OPEN' | 'CANCELED';

export interface MarketTicker {
  symbol: string;
  name: string;
  sector: AssetSector;
  price: number;
  prevPrice: number;
  changePct24h: number;
  volume24h: number;
  spreadBps: number;
  high24h: number;
  low24h: number;
  sparkline: number[];
  candles: Omit<Candle, 'label'>[];
  lastFlash?: 'up' | 'down' | null;
}

export interface Position {
  symbol: string;
  side: 'LONG' | 'SHORT';
  qty: number;
  avgEntry: number;
  leverage: number;
  liquidationPrice: number;
  sector: AssetSector;
}

export interface Order {
  id: string;
  timestamp: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number;
  fillPrice?: number;
  status: OrderStatus;
  notional: number;
}

export interface OrderBookLevel {
  price: number;
  size: number;
  total: number;
}

export interface EquityPoint {
  label: string;
  nav: number;
  benchmark: number;
  drawdownPct: number;
}

export type EquityTimeframe = '1H' | '4H' | '12H' | 'ALL';

export interface PitchTeam {
  id: string;
  ticker: string;
  name: string;
  founder: string;
  institution: string;
  sector: string;
  pitchSlot: string;
  impliedValuationM: number;
  backingTotal: number;
  changePct: number;
  judgesScore: number;
  thesisSummary: string;
  moat: string;
  unitEconomics: string;
  riskFactor: string;
  sparkline: number[];
}

export interface FeedDiagnostic {
  id: string;
  channel: string;
  protocol: string;
  endpoint: string;
  latencyMs: number;
  msgPerSec: number;
  status: 'NOMINAL' | 'DEGRADED';
}

export interface DeskState {
  cash: number;
  initialCapital: number;
  realizedPnl: number;
  tickers: MarketTicker[];
  positions: Position[];
  orders: Order[];
  pitchTeams: PitchTeam[];
  selectedSymbol: string;
  isStreaming: boolean;
}

export interface PortfolioMetrics {
  nav: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalReturnPct: number;
  grossExposure: number;
  netExposure: number;
  marginUsed: number;
  marginUtilPct: number;
  buyingPower: number;
}
