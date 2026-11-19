"use client";

import Link from "next/link";
import { useState } from "react";
import { MarketHeatmap, type HeatmapQuote } from "@/components/ui/market-heatmap";
import { bp } from "@/lib/format";
import { Metric, PageTitle, Panel, useDemoTrack } from "../ui";

const companies: readonly HeatmapQuote[] = [
  { ticker: "FRPK", name: "FreshPack Foods", price: "$11.80", moveBp: null, tag: "Built by you" },
  { ticker: "QAAC", name: "AquaCare", price: "$10.03", moveBp: null, tag: "Rescued by you" },
  { ticker: "NOVA", name: "Nova Nutrition", price: "$12.40", moveBp: 420 },
  { ticker: "GRID", name: "GridWise Energy", price: "$9.80", moveBp: -200 },
  { ticker: "MINT", name: "Mint Mobility", price: "$13.10", moveBp: 810 },
  { ticker: "LUMA", name: "Luma Living", price: "$8.90", moveBp: -130 },
  { ticker: "VITA", name: "VitaCart", price: "$10.60", moveBp: 180 },
  { ticker: "ORBI", name: "Orbit Health", price: "$11.20", moveBp: 300 },
];

export default function Market() {
  const [track] = useDemoTrack();
  const [selected, setSelected] = useState("NOVA");
  const company = companies.find(({ ticker }) => ticker === selected) ?? companies[2];

  return (
    <>
      <PageTitle eyebrow="MARKET / EVENT-WIDE PRICE BOARD" title="The exchange." sub="Track company prices and moves through the competition." />
      <div className="grid grid-cols-3 gap-2 max-sm:[&_.guide-metric]:p-2! max-sm:[&_.guide-metric_b]:text-sm! max-sm:[&_.guide-metric_small]:tracking-normal!">
        <Metric label="MARKET STATE" value="HALTED" delta="RESUME AT ROUND 3 · INVEST" />
        <Metric label="COMPANIES LISTED" value="150" delta="THREE TRACKS" />
        <Metric label="NEXT PRICE EVENT" value="SCORE REVEAL" delta="02:45 IST · PLANNED" />
      </div>
      <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Market heatmap" tag="ILLUSTRATIVE MARKET SNAPSHOT">
          <p className="guide-muted mb-3">The last price is the latest displayed mark. The signed move shows how it changed from the previous reference price. Select a company to check its move and whether you can trade it.</p>
          <MarketHeatmap quotes={companies} selected={selected} onSelect={setSelected} />
        </Panel>
        <Panel title={`${company.ticker} · ${company.name}`}>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="LAST PRICE" value={company.price} delta="SAMPLE PRICE" />
            <Metric label="PRICE MOVE" value={bp(company.moveBp)} delta="SAMPLE MOVE" />
          </div>
          <p className="guide-muted mt-3">{company.tag ? `${company.tag}. Trading is restricted for this company.` : "Eligible for trading in Round 3."}</p>
        </Panel>
      </div>
      <div className="guide-grid two mt-4">
        <Panel title="Price mechanics" tag="ROUND 1 → CRISIS → REVEAL">
          <p className="guide-muted">Starting share price = $10.00 + $0.10 × (PRD score − 50).</p>
          <p className="guide-muted mt-2">At the crisis, every price falls by 15% (×0.85).</p>
          <p className="guide-muted mt-2">At the rescue score reveal, price × (1 + 0.5% × (crisis score − 50)).</p>
        </Panel>
        <Panel title="Trading access" tag="ROUND 3 ONLY">
          <p className="guide-muted">During Round 3 you may trade any company except the one you built and the one you rescued.</p>
          {track === "FINANCE" && <Link className="mt-3 inline-block text-xs text-[#39ff88]" href="/demo/trade/event">Open Round 3 order ticket →</Link>}
        </Panel>
      </div>
    </>
  );
}
