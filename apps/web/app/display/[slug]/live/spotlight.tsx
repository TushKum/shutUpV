"use client";

// The live wall's spotlight: one company's candles at a time, changing every 12 seconds through the companies that
// have moved most since the IPO, with the candlestick patterns marked.

import { useEffect, useState } from "react";
import type { Candle } from "@/lib/chart";
import { TradingChart } from "@/components/ui/trading-chart";

export interface SpotlightCompany {
  id: string;
  ticker: string;
  name: string | null;
  candles: Candle[];
}

const BOX = { width: 620, height: 270, padLeft: 70, padRight: 84, padTop: 16, padBottom: 10 };

export function Spotlight({ companies }: { companies: SpotlightCompany[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => x + 1), 12_000);
    return () => clearInterval(t);
  }, []);
  const c = companies[i % companies.length]!;
  return (
    <section className="mx-panel rounded-xl bg-ink px-4 py-3" data-testid="live-spotlight">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="font-mono text-[22px] font-bold tracking-wide text-phosphor-mid">SPOTLIGHT</h2>
        <p className="font-mono text-[26px] font-bold text-paper">
          {c.ticker} <span className="text-[20px] font-normal text-muted">{c.name}</span>
        </p>
      </div>
      <TradingChart candles={c.candles} label={`${c.ticker} price`} box={BOX} average={3} patternList={false} fontSize={16} />
    </section>
  );
}
