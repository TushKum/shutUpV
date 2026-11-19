import type { MarketTicker } from "../types/command";

const storageKey = "primus-paper-quotes-v1";

// The preview shares public quotes only. Trading balances and orders stay in their own desk.
export function publishPaperQuotes(quotes: MarketTicker[]) {
  try { localStorage.setItem(storageKey, JSON.stringify(quotes)); } catch { /* The desk can still run without storage. */ }
}

export function followPaperQuotes(onQuotes: (quotes: MarketTicker[]) => void) {
  const receive = (value: string | null) => {
    try {
      const quotes = JSON.parse(value ?? "null") as MarketTicker[] | null;
      if (Array.isArray(quotes) && quotes.length === 50 && quotes.every((quote) =>
        typeof quote?.symbol === "string" && Number.isFinite(quote.price) && Number.isFinite(quote.changePct24h)
        && Array.isArray(quote.sparkline) && Array.isArray(quote.candles))) onQuotes(quotes);
    } catch { /* Ignore malformed or unavailable preview storage. */ }
  };
  try { receive(localStorage.getItem(storageKey)); } catch { /* Keep the seed quotes. */ }
  const onStorage = (event: StorageEvent) => { if (event.key === storageKey) receive(event.newValue); };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
