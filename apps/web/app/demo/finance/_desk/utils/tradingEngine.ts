import type {
  DeskState,
  MarketTicker,
  Order,
  OrderSide,
  OrderType,
  PortfolioMetrics,
  Position,
} from '../types/command';
import { CANDLE_LIMIT, CANDLE_PRICE_SCALE, simulateBar } from './candles';

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number;
}

export interface OrderExecutionResult {
  ok: boolean;
  error?: string;
  nextState: DeskState;
  createdOrder?: Order;
}

export function calculatePortfolioMetrics(
  cash: number,
  initialCapital: number,
  positions: Position[],
  tickers: MarketTicker[],
): PortfolioMetrics {
  const tickerMap = new Map(tickers.map((t) => [t.symbol, t]));

  let unrealizedPnl = 0;
  let grossExposure = 0;
  let netExposure = 0;
  let marginUsed = 0;

  for (const pos of positions) {
    const ticker = tickerMap.get(pos.symbol);
    const markPrice = ticker ? ticker.price : pos.avgEntry;
    const notional = Math.abs(pos.qty * markPrice);
    const pnl =
      pos.side === 'LONG'
        ? (markPrice - pos.avgEntry) * pos.qty
        : (pos.avgEntry - markPrice) * pos.qty;

    unrealizedPnl += pnl;
    grossExposure += notional;
    netExposure += pos.side === 'LONG' ? notional : -notional;
    marginUsed += notional / Math.max(1, pos.leverage);
  }

  const nav = cash + marginUsed + unrealizedPnl;
  const totalPnl = nav - initialCapital;
  const totalReturnPct = initialCapital > 0 ? (totalPnl / initialCapital) * 100 : 0;
  const buyingPower = Math.max(0, cash * 2.5);
  const marginUtilPct = nav > 0 ? Math.min(100, (marginUsed / nav) * 100) : 0;

  return {
    nav,
    unrealizedPnl,
    totalPnl,
    totalReturnPct,
    grossExposure,
    netExposure,
    marginUsed,
    marginUtilPct,
    buyingPower,
  };
}

export function executeOrder(state: DeskState, req: OrderRequest): OrderExecutionResult {
  const ticker = state.tickers.find((t) => t.symbol === req.symbol);
  if (!ticker) {
    return { ok: false, error: `Unknown ticker symbol: ${req.symbol}`, nextState: state };
  }

  if (!Number.isFinite(req.qty) || req.qty <= 0) {
    return { ok: false, error: 'Order quantity must be greater than zero.', nextState: state };
  }

  const execPrice =
    req.type === 'LIMIT'
      ? Number(req.limitPrice ?? 0)
      : ticker.price;

  if (req.type === 'LIMIT' && (!Number.isFinite(execPrice) || execPrice <= 0)) {
    return { ok: false, error: 'Limit price must be greater than zero.', nextState: state };
  }

  const notional = execPrice * req.qty;
  const metrics = calculatePortfolioMetrics(
    state.cash,
    state.initialCapital,
    state.positions,
    state.tickers,
  );

  if (notional > metrics.buyingPower) {
    return {
      ok: false,
      error: `Insufficient buying power. Required ${formatCurrency(notional)}, available ${formatCurrency(metrics.buyingPower)}.`,
      nextState: state,
    };
  }

  const now = new Date();
  const timestamp = now.toTimeString().slice(0, 8);
  const orderId = `ORD-${Math.floor(8842 + state.orders.length * 3)}`;

  if (req.type === 'LIMIT') {
    const createdOrder: Order = {
      id: orderId,
      timestamp,
      symbol: req.symbol,
      side: req.side,
      type: 'LIMIT',
      qty: req.qty,
      limitPrice: execPrice,
      status: 'OPEN',
      notional,
    };

    return {
      ok: true,
      createdOrder,
      nextState: {
        ...state,
        orders: [createdOrder, ...state.orders],
      },
    };
  }

  // Market order executes immediately against current price
  const createdOrder: Order = {
    id: orderId,
    timestamp,
    symbol: req.symbol,
    side: req.side,
    type: 'MARKET',
    qty: req.qty,
    fillPrice: execPrice,
    status: 'FILLED',
    notional,
  };

  let nextCash = state.cash;
  let nextRealizedPnl = state.realizedPnl;
  const nextPositions = [...state.positions];
  const existingIdx = nextPositions.findIndex((p) => p.symbol === req.symbol);

  const desiredSide: 'LONG' | 'SHORT' = req.side === 'BUY' ? 'LONG' : 'SHORT';

  if (existingIdx === -1) {
    const leverage = ticker.sector === 'Perps' ? 3 : ticker.sector === 'Equities' ? 2 : 1;
    const marginRequired = notional / leverage;
    nextCash = Math.max(0, nextCash - marginRequired);

    const liquidationPrice =
      leverage <= 1
        ? 0
        : desiredSide === 'LONG'
          ? Number((execPrice * (1 - 0.85 / leverage)).toFixed(2))
          : Number((execPrice * (1 + 0.85 / leverage)).toFixed(2));

    nextPositions.unshift({
      symbol: req.symbol,
      side: desiredSide,
      qty: req.qty,
      avgEntry: execPrice,
      leverage,
      liquidationPrice,
      sector: ticker.sector,
    });
  } else {
    const existing = nextPositions[existingIdx];
    if (existing.side === desiredSide) {
      const combinedQty = existing.qty + req.qty;
      const weightedAvg =
        (existing.avgEntry * existing.qty + execPrice * req.qty) / combinedQty;
      const marginAdded = notional / Math.max(1, existing.leverage);
      nextCash = Math.max(0, nextCash - marginAdded);
      nextPositions[existingIdx] = {
        ...existing,
        qty: Number(combinedQty.toFixed(4)),
        avgEntry: Number(weightedAvg.toFixed(4)),
      };
    } else {
      // Reducing or closing existing opposite position
      const closeQty = Math.min(existing.qty, req.qty);
      const pnlPerUnit =
        existing.side === 'LONG'
          ? execPrice - existing.avgEntry
          : existing.avgEntry - execPrice;
      const realized = pnlPerUnit * closeQty;
      const releasedMargin = (closeQty * existing.avgEntry) / Math.max(1, existing.leverage);

      nextRealizedPnl += realized;
      nextCash += releasedMargin + realized;

      const remainingQty = existing.qty - closeQty;
      if (remainingQty <= 0.0001) {
        nextPositions.splice(existingIdx, 1);
        const leftoverQty = req.qty - closeQty;
        if (leftoverQty > 0.0001) {
          const marginForFlip = (leftoverQty * execPrice) / Math.max(1, existing.leverage);
          nextCash = Math.max(0, nextCash - marginForFlip);
          nextPositions.unshift({
            symbol: req.symbol,
            side: desiredSide,
            qty: Number(leftoverQty.toFixed(4)),
            avgEntry: execPrice,
            leverage: existing.leverage,
            liquidationPrice: existing.liquidationPrice,
            sector: existing.sector,
          });
        }
      } else {
        nextPositions[existingIdx] = {
          ...existing,
          qty: Number(remainingQty.toFixed(4)),
        };
      }
    }
  }

  return {
    ok: true,
    createdOrder,
    nextState: {
      ...state,
      cash: nextCash,
      realizedPnl: nextRealizedPnl,
      positions: nextPositions,
      orders: [createdOrder, ...state.orders],
    },
  };
}

export function cancelOpenOrder(state: DeskState, orderId: string): DeskState {
  return {
    ...state,
    orders: state.orders.map((order) =>
      order.id === orderId && order.status === 'OPEN'
        ? { ...order, status: 'CANCELED' }
        : order,
    ),
  };
}

export function reduceOrClosePosition(
  state: DeskState,
  symbol: string,
  fraction: number,
): OrderExecutionResult {
  const pos = state.positions.find((p) => p.symbol === symbol);
  if (!pos) {
    return { ok: false, error: `No active position in ${symbol}.`, nextState: state };
  }
  const clampedFraction = Math.min(1, Math.max(0.05, fraction));
  const closeQty =
    clampedFraction >= 0.99
      ? pos.qty
      : Number((pos.qty * clampedFraction).toFixed(pos.qty < 5 ? 3 : 0)) || pos.qty;

  const side: OrderSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
  return executeOrder(state, {
    symbol,
    side,
    type: 'MARKET',
    qty: closeQty,
  });
}

export function applyMarketTick(tickers: MarketTicker[], step: number): MarketTicker[] {
  return tickers.map((ticker, idx) => {
    const wave = Math.sin(step * 0.85 + idx * 1.9) * 0.0022 + Math.cos(step * 0.4 + idx) * 0.0012;
    const nextPriceRaw = ticker.price * (1 + wave);
    return markTicker(ticker, nextPriceRaw, step + idx * 7);
  });
}

/** A paper fill nudges the public simulation by up to 1% of the mark. */
export function applyPaperFill(tickers: MarketTicker[], order: Order, step: number): MarketTicker[] {
  if (order.status !== 'FILLED') return tickers;
  return tickers.map((ticker) => {
    if (ticker.symbol !== order.symbol) return ticker;
    const minTick = ticker.price < 2 ? 0.001 : 0.01;
    const impact = Math.max(minTick, ticker.price * Math.min(0.01, order.notional / ticker.volume24h));
    return markTicker(ticker, ticker.price + (order.side === 'BUY' ? impact : -impact), step);
  });
}

function markTicker(ticker: MarketTicker, nextPriceRaw: number, step: number): MarketTicker {
    const decimals = ticker.price < 2 ? 3 : 2;
    const nextPrice = Number(Math.max(0.01, nextPriceRaw).toFixed(decimals));
    const candle = simulateBar(ticker.price, nextPrice, step, ticker.volume24h);
    const deltaPct = Number(((1 + ticker.changePct24h / 100) * nextPrice / ticker.price * 100 - 100).toFixed(2));
    const flash: 'up' | 'down' | null =
      nextPrice > ticker.price ? 'up' : nextPrice < ticker.price ? 'down' : null;

    return {
      ...ticker,
      prevPrice: ticker.price,
      price: nextPrice,
      changePct24h: deltaPct,
      high24h: Math.max(ticker.high24h, (candle.high ?? candle.close) / CANDLE_PRICE_SCALE),
      low24h: Math.min(ticker.low24h, (candle.low ?? candle.close) / CANDLE_PRICE_SCALE),
      sparkline: [...ticker.sparkline.slice(1), nextPrice],
      candles: [...ticker.candles.slice(1 - CANDLE_LIMIT), candle],
      lastFlash: flash,
    };
}

export function formatCurrency(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatSignedCurrency(value: number, decimals = 2): string {
  const prefix = value >= 0 ? '+' : '-';
  return `${prefix}${formatCurrency(Math.abs(value), decimals)}`;
}

export function formatSignedPercent(value: number, decimals = 2): string {
  const prefix = value >= 0 ? '+' : '-';
  return `${prefix}${Math.abs(value).toFixed(decimals)}%`;
}

export function buildPositionsCsv(positions: Position[], tickers: MarketTicker[]): string {
  const tickerMap = new Map(tickers.map((t) => [t.symbol, t]));
  const header = 'Symbol,Side,Quantity,AvgEntry,MarkPrice,NotionalUSD,UnrealizedPnLUSD,Leverage';
  const rows = positions.map((pos) => {
    const mark = tickerMap.get(pos.symbol)?.price ?? pos.avgEntry;
    const notional = (pos.qty * mark).toFixed(2);
    const pnl = (
      pos.side === 'LONG' ? (mark - pos.avgEntry) * pos.qty : (pos.avgEntry - mark) * pos.qty
    ).toFixed(2);
    return `${pos.symbol},${pos.side},${pos.qty},${pos.avgEntry},${mark},${notional},${pnl},${pos.leverage}x`;
  });
  return [header, ...rows].join('\n');
}
