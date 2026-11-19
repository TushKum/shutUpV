import type { Candle } from '@/lib/chart';
import type { MarketTicker } from '../types/command';

// Keep integer prices for the chart, including the desk's sub-dollar quotes.
export const CANDLE_PRICE_SCALE = 1000;
export const CANDLE_LIMIT = 36;

export function simulateBar(open: number, close: number, step: number, dailyNotional: number,
  floor = 0.01, ceiling = Infinity): Omit<Candle, 'label'> {
  const toChartPrice = (price: number) => Math.round(price * CANDLE_PRICE_SCALE);
  const wave = (1 + Math.sin(step * 2.17)) / 2;
  const range = open * 0.0007 + Math.abs(close - open) * 0.4;
  const high = Math.min(ceiling, Math.max(open, close) + range * (0.4 + wave));
  const low = Math.max(floor, Math.min(open, close) - range * (1.4 - wave));
  const volume = Math.max(1, Math.round(dailyNotional / open / 36_000 * (0.4 + 1.2 * wave)));
  return {
    open: toChartPrice(open),
    high: toChartPrice(high),
    low: toChartPrice(low),
    close: toChartPrice(close),
    volume,
  };
}

export function seedBars(ticker: Omit<MarketTicker, 'candles'>): MarketTicker['candles'] {
  // Fill the chart from the sample marks, retaining each anchor and the opening quote.
  return ticker.sparkline.slice(1).flatMap((end, index) => {
    const start = ticker.sparkline[index]!;
    const midpoint = (start + end) / 2;
    return [
      simulateBar(start, midpoint, 2 * index, ticker.volume24h, ticker.low24h, ticker.high24h),
      simulateBar(midpoint, end, 2 * index + 1, ticker.volume24h, ticker.low24h, ticker.high24h),
    ];
  });
}
