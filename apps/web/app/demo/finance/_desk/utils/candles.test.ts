import { expect, test } from 'vitest';
import { candleGeometry } from '@/lib/chart';
import { INITIAL_DESK_STATE, SEED_TICKERS } from '../data/seedData';
import { CANDLE_LIMIT, CANDLE_PRICE_SCALE } from './candles';
import { applyMarketTick, applyPaperFill, executeOrder } from './tradingEngine';

test('the seeded and rolling candles keep the correct mark, range and volume', () => {
  let tickers = SEED_TICKERS;
  expect(tickers).toHaveLength(50);
  expect(new Set(tickers.map(({ symbol }) => symbol)).size).toBe(50);
  const check = () => {
    for (const ticker of tickers) {
      expect(ticker.candles.at(-1)?.close).toBe(Math.round(ticker.price * CANDLE_PRICE_SCALE));
      for (const bar of ticker.candles) {
        expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
        expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
        expect(bar.volume).toBeGreaterThan(0);
      }
    }
  };
  check();
  for (let step = 1; step <= CANDLE_LIMIT; step++) tickers = applyMarketTick(tickers, step);
  check();
  expect(tickers[0]!.candles).toHaveLength(CANDLE_LIMIT);
  const bars = tickers[0]!.candles.map((bar, index) => ({ ...bar, label: String(index) }));
  const chart = candleGeometry(bars, { width: 390, height: 380, padLeft: 64, padRight: 78, padTop: 30, padBottom: 14 }, 5, 5, 10);
  expect(chart.pathAverage).toMatch(/^M.* L/);
  expect(chart.pathSlowAverage).toMatch(/^M.* L/);
  expect(chart.pathAverage).not.toBe(chart.pathSlowAverage);
  expect(chart.volTop).toBeGreaterThan(chart.priceBottom);
});

test('a paper fill changes the public candle for its instrument only', () => {
  const symbol = 'NVDA-P';
  const before = SEED_TICKERS.find((ticker) => ticker.symbol === symbol)!;
  const buy = executeOrder(INITIAL_DESK_STATE, { symbol, side: 'BUY', type: 'MARKET', qty: 1 });
  expect(buy.ok).toBe(true);
  const after = applyPaperFill(SEED_TICKERS, buy.createdOrder!, 1);
  expect(after[0]!.price).toBeGreaterThan(before.price);
  expect(after[0]!.candles.at(-1)?.close).toBe(Math.round(after[0]!.price * CANDLE_PRICE_SCALE));
  expect(after[1]).toBe(SEED_TICKERS[1]);
  const pending = executeOrder(INITIAL_DESK_STATE, { symbol, side: 'SELL', type: 'LIMIT', qty: 1, limitPrice: before.price });
  expect(pending.ok).toBe(true);
  expect(applyPaperFill(after, pending.createdOrder!, 2)).toBe(after);
});
