import { expect, test } from 'vitest';
import { candleGeometry } from '@/lib/chart';
import { SEED_TICKERS } from '../data/seedData';
import { CANDLE_LIMIT, CANDLE_PRICE_SCALE } from './candles';
import { applyMarketTick } from './tradingEngine';

test('the seeded and rolling candles keep the correct mark, range and volume', () => {
  let tickers = SEED_TICKERS;
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
