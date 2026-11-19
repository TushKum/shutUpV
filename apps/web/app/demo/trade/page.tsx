"use client";
import {useEffect,useMemo,useState} from "react";
import {PageTitle,Panel,Metric,useDemoTrack,useTeamCode} from "../ui";
import {ProductRound3} from "./product-round3";

const PAPER_ASSETS=[{t:"NOVA",n:"Nova Nutrition",p:12.4},{t:"GRID",n:"GridWise Energy",p:9.8},{t:"MINT",n:"Mint Mobility",p:13.1},{t:"LUMA",n:"Luma Living",p:8.9},{t:"VITA",n:"VitaCart",p:10.6},{t:"ORBI",n:"Orbit Health",p:11.2}];

interface Round3ProductTeam {
  code: string;
  company: string;
  ticker: string;
  topic: string;
  initialOfferedDeal: number;
  r2Score: number;
  incomingLockFromProduct?: boolean;
  crisisCategory: string;
  crisisTitle: string;
  crisisBody: string;
  baselineContext: string;
}

const BASE_VALUATION = 40000;

const R2_LOCKED_PARTNER: Round3ProductTeam = {
  code: "XP01",
  company: "AquaCare",
  ticker: "QAAC",
  topic: "FMCG · Functional Hydration & School Tiffin Packs",
  initialOfferedDeal: BASE_VALUATION, // Consultancy base price ($40,000)
  r2Score: 86,
  crisisCategory: "ROUND 3 CRISIS #11 · NATIONAL RETAILER DELISTING & COPYCAT WAR",
  crisisTitle: "Largest modern-trade chain delists AquaCare for a private-label clone at ₹14",
  crisisBody:
    "India's largest supermarket chain (38% of AquaCare's urban volume) launches its own ₹14 school hydration pack copying AquaCare's formula and demands a ₹1.5 Cr slotting fee within 14 days to keep AquaCare on shelves.",
  baselineContext:
    "Post-Round 2 baseline: ₹21 pack price, ₹13.20 unit cost, 55,000 packs/month volume. Both XP01 and your consulting team must solve this Round 3 crisis together.",
};

const AUCTION_CANDIDATES: Round3ProductTeam[] = [
  {
    code: "XP04",
    company: "FreshPack Foods",
    ticker: "FRPK",
    topic: "D2C FoodTech · Ready-to-Eat Meal Pouches",
    initialOfferedDeal: BASE_VALUATION,
    r2Score: 81,
    incomingLockFromProduct: false,
    crisisCategory: "ROUND 3 CRISIS #14 · COLD-CHAIN COLLAPSE & QUICK-COMMERCE EXCLUSIVITY",
    crisisTitle: "Two quick-commerce platforms demand 32% take-rate or dark-store removal",
    crisisBody:
      "Blinkit and Zepto account for 64% of FreshPack's daily orders. Both platforms simultaneously raise dark-store commissions from 18% to 32% and require category exclusivity within 10 days.",
    baselineContext:
      "Post-Round 2 baseline: ₹48 MRP pouch, ₹27.50 unit cost, ₹12 Cr annual run-rate. Both XP04 and your consulting team must solve this Round 3 crisis together.",
  },
  {
    code: "XP09",
    company: "GridWise Energy",
    ticker: "GRID",
    topic: "CleanTech · Smart Hostel & Campus Micro-Meters",
    initialOfferedDeal: BASE_VALUATION,
    r2Score: 88,
    incomingLockFromProduct: true,
    crisisCategory: "ROUND 3 CRISIS #09 · DISCOM REGULATORY BLOCK & FIRMWARE BREACH",
    crisisTitle: "State electricity board halts private sub-metering after a campus billing dispute",
    crisisBody:
      "Two state electricity utilities issue an interim stay on third-party hostel sub-meters unless certified under a new BIS smart-grid standard within 45 days, freezing ₹8.5 Cr of signed campus deployments.",
    baselineContext:
      "Post-Round 2 baseline: ₹3,400 hardware unit + ₹200/mo SaaS, 42 campuses live. Both XP09 and your consulting team must solve this Round 3 crisis together.",
  },
  {
    code: "XP12",
    company: "Nova Nutrition",
    ticker: "NOVA",
    topic: "HealthTech · Personalised Protein & Micronutrient Sachets",
    initialOfferedDeal: BASE_VALUATION,
    r2Score: 79,
    incomingLockFromProduct: false,
    crisisCategory: "ROUND 3 CRISIS #16 · FSSAI LABELLING MANDATE & WHEY SPIKE",
    crisisTitle: "Whey isolate costs jump 28% while FSSAI bans 'clinical recovery' claims",
    crisisBody:
      "Global whey isolate prices surge 28% quarter-on-quarter just as FSSAI orders removal of 'clinical recovery' front-of-pack claims within 21 days, putting ₹4.2 Cr of packaged inventory at risk.",
    baselineContext:
      "Post-Round 2 baseline: ₹65 sachet, ₹38 COGS, 62% repeat subscription rate. Both XP12 and your consulting team must solve this Round 3 crisis together.",
  },
];

const parts=["Diagnosis","Three options","Recommendation","Per-pack maths","Timeline","Risks"];
const consultingPlaceholders=[
  "Diagnose the exact financial and operational impact of this Round 3 crisis on your allotted Product team's topic.",
  "Present three strategic options for the allotted Product team, comparing costs, risks and expected recovery.",
  "Give your single collaborative recommendation for the allotted Product team and why it outperforms the other options.",
  "Work out the updated unit economics, pricing, margins and break-even numbers after your Round 3 intervention.",
  "Lay out the week-by-week execution plan and milestones with the allotted Product team.",
  "Identify remaining risks and your contingency plan B.",
];

interface AuctionDealState {
  currentDealPrice: number;
  currentMarkupPct: number;
  dealPushState: "OFFERED" | "PUSHED_WAITING" | "DEAL_UPDATED";
  pendingDealPrice?: number;
  pendingMarkupPct?: number;
  lockInitiatedBy: "NONE" | "CONSULTING" | "PRODUCT";
  consultingLockAccepted: boolean;
  productLockAccepted: boolean;
  lockedAt?: string;
}

function initialAuctionState(): Record<string, AuctionDealState> {
  return {
    XP04: {
      currentDealPrice: BASE_VALUATION,
      currentMarkupPct: 0,
      dealPushState: "OFFERED",
      lockInitiatedBy: "NONE",
      consultingLockAccepted: false,
      productLockAccepted: false,
    },
    XP09: {
      currentDealPrice: BASE_VALUATION,
      currentMarkupPct: 0,
      dealPushState: "OFFERED",
      lockInitiatedBy: "PRODUCT",
      consultingLockAccepted: false,
      productLockAccepted: true,
    },
    XP12: {
      currentDealPrice: BASE_VALUATION,
      currentMarkupPct: 0,
      dealPushState: "OFFERED",
      lockInitiatedBy: "NONE",
      consultingLockAccepted: false,
      productLockAccepted: false,
    },
  };
}

export default function Trade(){
  const [track] = useDemoTrack();
  const code = useTeamCode();

  // Product / Finance paper trading state
  const [ticker,setTicker]=useState("NOVA");
  const [side,setSide]=useState("BUY");
  const [qty,setQty]=useState(500);
  const [cash,setCash]=useState(100000);
  const [holdings,setHoldings]=useState<Record<string,number>>({});
  const [orders,setOrders]=useState<string[]>([]);
  const [notice,setNotice]=useState("Trading is currently halted in this preview. Orders can be staged locally.");
  const selectedAsset=PAPER_ASSETS.find(a=>a.t===ticker)!;
  const reserve=useMemo(()=>qty*selectedAsset.p*(side==="BUY"?1.1:1),[qty,selectedAsset,side]);
  const held=holdings[ticker]||0;
  function placePaperOrder(){
    if(qty<1||!Number.isInteger(qty)){setNotice("Orders must be whole shares.");return}
    if(side==="BUY"&&reserve>cash){setNotice("Insufficient cash for price × quantity × 1.10 reserve.");return}
    if(side==="SELL"&&qty>held){setNotice("You can only sell shares you own. Short selling is not allowed.");return}
    if((holdings[ticker]||0)+(side==="BUY"?qty:0)>5000){setNotice("Position limit is 5,000 shares, including pending buys.");return}
    setOrders(v=>[side+" "+qty.toLocaleString()+" "+ticker+" @ $"+selectedAsset.p.toFixed(2),...v]);
    if(side==="BUY"){setCash(v=>v-reserve);setHoldings(v=>({...v,[ticker]:(v[ticker]||0)+qty}))}
    else{setCash(v=>v+qty*selectedAsset.p);setHoldings(v=>({...v,[ticker]:held-qty}))}
    setNotice("Paper order staged locally. No exchange or backend was contacted.");
  }

  // Stage 1: Existing Round 2 partner (XP01) price increase request (can stay on BASE 0% or increase)
  const [r3IncreasePct, setR3IncreasePct] = useState<number>(0);
  const [incumbentStatus, setIncumbentStatus] = useState<
    "PAIRED_FROM_R2" | "ASKING_WAITING" | "ACCEPTED_LOCKED" | "REJECTED_UNLOCKED"
  >("PAIRED_FROM_R2");
  const [incumbentFinalPrice, setIncumbentFinalPrice] = useState<number>(BASE_VALUATION);
  const [incumbentFinalPct, setIncumbentFinalPct] = useState<number>(0);
  const [incumbentDecidedAt, setIncumbentDecidedAt] = useState<string>("");

  // Stage 2: Open Auction state (active only when incumbentStatus === "REJECTED_UNLOCKED")
  const [auctionMarkupPct, setAuctionMarkupPct] = useState<number>(0);
  const [auctionDeals, setAuctionDeals] = useState<Record<string, AuctionDealState>>(initialAuctionState);

  // Stage 3: Round 3 Crisis Solution Editor state
  const [active, setActive] = useState(0);
  const [values, setValues] = useState<string[]>(Array(6).fill(""));
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  const requestedIncumbentPrice = useMemo(
    () => Math.round(R2_LOCKED_PARTNER.initialOfferedDeal * (1 + r3IncreasePct / 100)),
    [r3IncreasePct]
  );

  // Ask current Round 2 Product team (XP01) for a price increase.
  // In this preview: demands <= 20% are accepted by XP01 (or you can test rejection directly); demands >= 25% are rejected by XP01, unlocking you into the auction.
  const handleAskIncumbentPriceIncrease = (forceOutcome?: "ACCEPT" | "REJECT") => {
    if (incumbentStatus !== "PAIRED_FROM_R2") return;
    const targetPrice = requestedIncumbentPrice;
    const targetPct = r3IncreasePct;
    const willAccept = forceOutcome ? forceOutcome === "ACCEPT" : targetPct <= 20;

    setIncumbentStatus("ASKING_WAITING");
    window.setTimeout(() => {
      const stamp = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " IST";
      setIncumbentDecidedAt(stamp);
      if (willAccept) {
        setIncumbentFinalPrice(targetPrice);
        setIncumbentFinalPct(targetPct);
        setIncumbentStatus("ACCEPTED_LOCKED");
      } else {
        setIncumbentStatus("REJECTED_UNLOCKED");
      }
    }, 1400);
  };

  // Check if allotted via Auction
  const auctionLockedCode = useMemo(() => {
    if (incumbentStatus !== "REJECTED_UNLOCKED") return null;
    for (const c of AUCTION_CANDIDATES) {
      const d = auctionDeals[c.code];
      if (d && d.consultingLockAccepted && d.productLockAccepted) return c.code;
    }
    return null;
  }, [incumbentStatus, auctionDeals]);

  const auctionWaitingLockCode = useMemo(() => {
    if (incumbentStatus !== "REJECTED_UNLOCKED") return null;
    for (const c of AUCTION_CANDIDATES) {
      const d = auctionDeals[c.code];
      if (d && d.lockInitiatedBy === "CONSULTING" && d.consultingLockAccepted && !d.productLockAccepted) return c.code;
    }
    return null;
  }, [incumbentStatus, auctionDeals]);

  const isAuctionLockedOrPending = auctionLockedCode !== null || auctionWaitingLockCode !== null;

  // Determine the final allotted Product team for Round 3 (either XP01 if accepted, or the locked auction winner if rejected & re-sorted)
  const allottedPartner: Round3ProductTeam | null = useMemo(() => {
    if (incumbentStatus === "ACCEPTED_LOCKED") return R2_LOCKED_PARTNER;
    if (incumbentStatus === "REJECTED_UNLOCKED" && auctionLockedCode) {
      return AUCTION_CANDIDATES.find(c => c.code === auctionLockedCode) ?? null;
    }
    return null;
  }, [incumbentStatus, auctionLockedCode]);

  const allottedDealPrice: number = useMemo(() => {
    if (incumbentStatus === "ACCEPTED_LOCKED") return incumbentFinalPrice;
    if (incumbentStatus === "REJECTED_UNLOCKED" && auctionLockedCode) {
      return auctionDeals[auctionLockedCode]?.currentDealPrice ?? 0;
    }
    return requestedIncumbentPrice;
  }, [incumbentStatus, incumbentFinalPrice, auctionLockedCode, auctionDeals, requestedIncumbentPrice]);

  // Auction handlers (when unlocked)
  const handlePushAuctionDeal = (pCode: string) => {
    if (incumbentStatus !== "REJECTED_UNLOCKED" || isAuctionLockedOrPending) return;
    const cand = AUCTION_CANDIDATES.find(c => c.code === pCode)!;
    const cur = auctionDeals[pCode]!;
    const increasedPrice = Math.round(cand.initialOfferedDeal * (1 + auctionMarkupPct / 100));

    setAuctionDeals(prev => ({
      ...prev,
      [pCode]: {
        ...cur,
        dealPushState: "PUSHED_WAITING",
        pendingDealPrice: increasedPrice,
        pendingMarkupPct: auctionMarkupPct,
      },
    }));

    window.setTimeout(() => {
      setAuctionDeals(prev => {
        const latest = prev[pCode];
        if (!latest || latest.dealPushState !== "PUSHED_WAITING") return prev;
        return {
          ...prev,
          [pCode]: {
            ...latest,
            currentDealPrice: latest.pendingDealPrice ?? increasedPrice,
            currentMarkupPct: latest.pendingMarkupPct ?? auctionMarkupPct,
            dealPushState: "DEAL_UPDATED",
            lockInitiatedBy: "NONE",
            consultingLockAccepted: false,
            productLockAccepted: false,
          },
        };
      });
    }, 1200);
  };

  const handleSendAuctionLockRequest = (pCode: string) => {
    if (incumbentStatus !== "REJECTED_UNLOCKED" || isAuctionLockedOrPending) return;
    setAuctionDeals(prev => ({
      ...prev,
      [pCode]: {
        ...prev[pCode]!,
        lockInitiatedBy: "CONSULTING",
        consultingLockAccepted: true,
        productLockAccepted: false,
      },
    }));

    window.setTimeout(() => {
      const stamp = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " IST";
      setAuctionDeals(prev => {
        const cur = prev[pCode];
        if (!cur || !cur.consultingLockAccepted) return prev;
        return {
          ...prev,
          [pCode]: {
            ...cur,
            productLockAccepted: true,
            lockedAt: stamp,
          },
        };
      });
    }, 1500);
  };

  const handleAcceptAuctionProductLock = (pCode: string) => {
    if (incumbentStatus !== "REJECTED_UNLOCKED" || isAuctionLockedOrPending) return;
    const stamp = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " IST";
    setAuctionDeals(prev => ({
      ...prev,
      [pCode]: {
        ...prev[pCode]!,
        consultingLockAccepted: true,
        productLockAccepted: true,
        lockedAt: stamp,
      },
    }));
  };

  const count = useMemo(() => values.reduce((n, v) => n + v.trim().split(/\s+/).filter(Boolean).length, 0), [values]);

  const handleSubmit = () => {
    if (!allottedPartner || submittedAt || count === 0) return;
    const stamp = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " IST";
    setSubmittedAt(stamp);
  };

  if (track === "PRODUCT") {
    return <ProductRound3 />;
  }

  if (track !== "CONSULTING") {
    return <><PageTitle eyebrow={`ROUND 3 / INVEST · ${track}`} title="Trade the market." sub="Nine 15-minute trading rounds. Buy and sell shares in other companies. Orders can be changed or cancelled until a round closes; nothing fills until the round ends."/><div className="guide-grid three"><Metric label="TRADING ROUND" value="01 / 09" delta="BLIND WINDOW · 02:15 IST"/><Metric label="AVAILABLE CASH" value={"$"+cash.toLocaleString("en-US",{minimumFractionDigits:2})} delta="10% BUY RESERVE APPLIED"/><Metric label="TRADING STATE" value="HALTED" delta="LOCAL PREVIEW · NO LIVE ORDERS"/></div><div className="guide-grid two mt-4"><Panel title="Order ticket" tag="PAPER TRADING"><label className="guide-label">COMPANY · YOUR OWN AND RESCUED COMPANIES ARE EXCLUDED</label><select className="guide-select" value={ticker} onChange={e=>setTicker(e.target.value)}>{PAPER_ASSETS.map(a=><option value={a.t} key={a.t}>{a.t+" · "+a.n+" · $"+a.p.toFixed(2)}</option>)}</select><div className="mt-3 flex gap-2">{["BUY","SELL"].map(s=><button key={s} type="button" onClick={()=>setSide(s)} className={"guide-chip "+(side===s?"active":"")}>{s}</button>)}</div><label className="guide-label">QUANTITY · WHOLE SHARES</label><input className="guide-input" type="number" min="1" step="1" value={qty} onChange={e=>setQty(Math.max(0,Number(e.target.value)))}/><div className="mt-2 flex flex-wrap gap-2">{[100,500,1000,2500].map(n=><button key={n} type="button" onClick={()=>setQty(n)} className="guide-chip">{n.toLocaleString()}</button>)}<button type="button" className="guide-chip" onClick={()=>setQty(side==="SELL"?held:Math.floor(cash/(selectedAsset.p*1.1)))}>MAX</button></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="guide-metric"><small>PRICE</small><b className="text-lg">{"$"+selectedAsset.p.toFixed(2)}</b></div><div className="guide-metric"><small>{side==="BUY"?"CASH RESERVE":"CASH RETURN"}</small><b className="text-lg">{"$"+reserve.toLocaleString("en-US",{maximumFractionDigits:2})}</b></div></div><p className="guide-muted mt-3">Your position: {held.toLocaleString()} shares · Position cap: 5,000 shares. {side==="BUY"?"Buy reserve includes 10% cushion.":"Sell orders cannot exceed shares owned."}</p><button type="button" className="guide-btn mt-4 w-full" onClick={placePaperOrder}>PREVIEW {side} {qty} {ticker} →</button><p className="guide-muted mt-3">{notice}</p></Panel><Panel title="Open orders" tag="THIS ROUND"><p className="guide-muted">Orders are staged during the round and fill together at the clearing price when the round ends.</p>{orders.length?<div className="mt-3 space-y-2">{orders.map((o,i)=><div className="border border-[#294832] p-3 font-mono text-[10px]" key={i}>{o}<span className="float-right text-[#ffbd66]">PAPER</span></div>)}</div>:<div className="mt-5 border border-dashed border-[#35523b] p-6 text-center text-xs text-[#7e9684]">No open orders yet.</div>}<div className="mt-5 border-t border-[#294832] pt-4"><b className="text-xs">Round clearing rule</b><p className="guide-muted mt-2">Net shares = buys − sells. Price moves by (net ÷ 1,000)%, capped at ±10%. Every order fills at the same new price. Speed gives no advantage.</p></div></Panel></div><div className="guide-alert mt-4">Rules: buy and sell only (no short selling); 5,000 shares maximum per company including pending buys; buys reserve quantity × price × 1.10; all orders are whole shares.</div></>;
  }

  return <>
    <PageTitle
      eyebrow={`ROUND 3 / PRICE INCREASE, AUCTION & ALLOTTED PRODUCT CRISIS · ${code}`}
      title="Ask for a Round 3 price increase or re-enter the auction."
      sub="In Round 3, ask your Round 2 Product team for a price increase. If they accept, your new price is paid after Round 3 and you solve their Round 3 crisis. If they do not accept, your consultancy team is unlocked and placed back into the open auction—once allotted to a Product team, you solve that Product team's crisis."
    />

    <div className="guide-grid three">
      <Metric
        label="ROUND 2 LOCKED DEAL"
        value={`$${R2_LOCKED_PARTNER.initialOfferedDeal.toLocaleString()}`}
        delta={`CURRENT PARTNER: ${R2_LOCKED_PARTNER.code} (${R2_LOCKED_PARTNER.company})`}
      />
      <Metric
        label="ROUND 3 DEAL PRICE"
        value={`$${allottedDealPrice.toLocaleString()}`}
        delta={
          allottedPartner
            ? `LOCKED WITH ${allottedPartner.code} · SETTLED AFTER ROUND 3`
            : incumbentStatus === "REJECTED_UNLOCKED"
              ? "UNLOCKED · NEGOTIATING IN OPEN AUCTION"
              : `REQUESTING +${r3IncreasePct}% FROM ${R2_LOCKED_PARTNER.code}`
        }
      />
      <Metric
        label="ROUND 3 ALLOTMENT STATUS"
        value={
          allottedPartner
            ? `ALLOTTED · ${allottedPartner.code}`
            : incumbentStatus === "REJECTED_UNLOCKED"
              ? "UNLOCKED · IN AUCTION"
              : incumbentStatus === "ASKING_WAITING"
                ? `WAITING ON ${R2_LOCKED_PARTNER.code}…`
                : `PAIRED WITH ${R2_LOCKED_PARTNER.code}`
        }
        delta={
          allottedPartner
            ? `${code} ⇄ ${allottedPartner.code} (${allottedPartner.ticker}) · SOLVING R3 CRISIS`
            : incumbentStatus === "REJECTED_UNLOCKED"
              ? `${R2_LOCKED_PARTNER.code} DECLINED · PICK NEW PARTNER IN AUCTION`
              : "AWAITING ROUND 3 PRICE INCREASE DECISION"
        }
      />
    </div>

    <div className="guide-grid two mt-4">
      {/* PANEL 1: Ask Current Round 2 Partner for a Round 3 Price Increase */}
      <Panel
        title={`1. Ask ${R2_LOCKED_PARTNER.code} (${R2_LOCKED_PARTNER.company}) for a Round 3 price increase`}
        tag={
          incumbentStatus === "ACCEPTED_LOCKED"
            ? "ACCEPTED · LOCKED FOR ROUND 3"
            : incumbentStatus === "REJECTED_UNLOCKED"
              ? "NOT ACCEPTED · TEAM UNLOCKED"
              : `CURRENT R2 PARTNER · ${R2_LOCKED_PARTNER.code}`
        }
      >
        <p className="guide-muted">
          You finished Round 2 paired with <b>{R2_LOCKED_PARTNER.code} · {R2_LOCKED_PARTNER.company} ({R2_LOCKED_PARTNER.ticker})</b> at <b>${R2_LOCKED_PARTNER.initialOfferedDeal.toLocaleString()}</b>. Ask them for a Round 3 price increase below. It is up to <b>{R2_LOCKED_PARTNER.code}</b> whether they accept or not.
        </p>

        <label className="guide-label">SELECT ROUND 3 PRICE (BASE PRICE OR INCREASE %) FOR {R2_LOCKED_PARTNER.code}</label>
        <div className="guide-tabs">
          {[0, 10, 15, 20, 25, 40].map(pct => (
            <button
              key={pct}
              type="button"
              disabled={incumbentStatus !== "PAIRED_FROM_R2"}
              className={r3IncreasePct === pct ? "active" : ""}
              onClick={() => setR3IncreasePct(pct)}
            >
              {pct === 0
                ? `BASE (0% · $${BASE_VALUATION.toLocaleString()})`
                : `+${pct}% ($${Math.round(BASE_VALUATION * (1 + pct / 100)).toLocaleString()})`}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="guide-label">CUSTOM PRICE INCREASE (% · 0% = BASE PRICE)</label>
            <input
              type="number"
              min={0}
              max={200}
              step={1}
              disabled={incumbentStatus !== "PAIRED_FROM_R2"}
              className="guide-input font-mono"
              value={r3IncreasePct}
              onChange={e => setR3IncreasePct(Math.max(0, Math.min(200, Number(e.target.value) || 0)))}
            />
          </div>
          <div>
            <label className="guide-label">ROUND 3 PRICE (PAID AFTER R3)</label>
            <input
              type="text"
              readOnly
              className="guide-input font-mono"
              value={
                r3IncreasePct === 0
                  ? `$${requestedIncumbentPrice.toLocaleString()} (BASE PRICE · 0%)`
                  : `$${requestedIncumbentPrice.toLocaleString()} (+${r3IncreasePct}% OVER BASE)`
              }
            />
          </div>
        </div>

        {incumbentStatus === "PAIRED_FROM_R2" && (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="guide-btn"
                onClick={() => handleAskIncumbentPriceIncrease()}
              >
                {r3IncreasePct === 0
                  ? `SEND BASE PRICE ($${requestedIncumbentPrice.toLocaleString()} · 0%) TO ${R2_LOCKED_PARTNER.code} →`
                  : `ASK ${R2_LOCKED_PARTNER.code} FOR +${r3IncreasePct}% ($${requestedIncumbentPrice.toLocaleString()}) →`}
              </button>
              <button
                type="button"
                className="guide-btn secondary"
                onClick={() => handleAskIncumbentPriceIncrease("REJECT")}
              >
                TEST IF {R2_LOCKED_PARTNER.code} DOES NOT ACCEPT (UNLOCK TO AUCTION) →
              </button>
            </div>
            <p className="guide-muted">
              Note: Your consultancy price starts on its base price (<b>${BASE_VALUATION.toLocaleString()}</b>) in Round 3 too. You can stay at base price (0%) or ask for an increase.
            </p>
          </div>
        )}

        {incumbentStatus === "ASKING_WAITING" && (
          <div className="guide-alert mt-4">
            <b>● Price increase request (+{r3IncreasePct}% → ${requestedIncumbentPrice.toLocaleString()}) sent to {R2_LOCKED_PARTNER.code}…</b>
            <br />
            Waiting for Product Team {R2_LOCKED_PARTNER.code} ({R2_LOCKED_PARTNER.company}) to accept or decline your Round 3 price increase.
          </div>
        )}

        {incumbentStatus === "ACCEPTED_LOCKED" && (
          <div className="guide-alert mt-4">
            <b>✓ {R2_LOCKED_PARTNER.code} ({R2_LOCKED_PARTNER.company}) ACCEPTED your +{incumbentFinalPct}% price increase ({incumbentDecidedAt})!</b>
            <br />
            Your new price of <b>${incumbentFinalPrice.toLocaleString()}</b> is locked and will be paid after Round 3. You remain allotted 1-to-1 with <b>{R2_LOCKED_PARTNER.code}</b>—solve their Round 3 crisis below.
          </div>
        )}

        {incumbentStatus === "REJECTED_UNLOCKED" && (
          <div className="guide-alert guide-warning mt-4">
            <b>✕ {R2_LOCKED_PARTNER.code} ({R2_LOCKED_PARTNER.company}) DID NOT ACCEPT your +{r3IncreasePct}% price increase ({incumbentDecidedAt}).</b>
            <br />
            <b>Team {code} is now UNLOCKED and back in the Round 3 Open Auction!</b> Negotiate and lock 1-to-1 with an interested Product team in Panel 2 on the right to receive your new Round 3 crisis assignment.
          </div>
        )}
      </Panel>

      {/* PANEL 2: Round 3 Open Auction (Active only if current Product team did NOT accept the price increase) */}
      <Panel
        title="2. Round 3 open auction (when unlocked)"
        tag={
          incumbentStatus === "ACCEPTED_LOCKED"
            ? `BYPASSED · RETAINED BY ${R2_LOCKED_PARTNER.code}`
            : incumbentStatus === "REJECTED_UNLOCKED"
              ? auctionLockedCode
                ? `ALLOTTED IN AUCTION · ${auctionLockedCode}`
                : "AUCTION LIVE · LOCK STRICTLY 1:1"
              : "STANDBY · OPENS IF R2 PARTNER DECLINES"
        }
      >
        {incumbentStatus !== "REJECTED_UNLOCKED" ? (
          <div className="guide-alert">
            {incumbentStatus === "ACCEPTED_LOCKED" ? (
              <>
                <b>Auction Bypassed — Retained by {R2_LOCKED_PARTNER.code} ({R2_LOCKED_PARTNER.company})</b>
                <br />
                Because {R2_LOCKED_PARTNER.code} accepted your Round 3 price increase (${incumbentFinalPrice.toLocaleString()}, settled after Round 3), your team stayed locked 1-to-1 with {R2_LOCKED_PARTNER.code} and did not enter the open auction.
              </>
            ) : (
              <>
                <b>Auction on Standby</b>
                <br />
                You are currently paired with your Round 2 partner (<b>{R2_LOCKED_PARTNER.code} · {R2_LOCKED_PARTNER.company}</b>). If you ask for a price increase on the left and <b>{R2_LOCKED_PARTNER.code} does not accept</b>, your consultancy team will immediately unlock and enter this Round 3 auction.
              </>
            )}
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="guide-label !m-0">AUCTION PRICE (BASE 0% OR MARKUP %)</span>
              <div className="flex gap-1.5">
                {[0, 5, 10, 15, 20].map(pct => (
                  <button
                    key={pct}
                    type="button"
                    disabled={isAuctionLockedOrPending}
                    className={`guide-chip ${auctionMarkupPct === pct ? "active" : ""}`}
                    onClick={() => setAuctionMarkupPct(pct)}
                  >
                    {pct === 0 ? "BASE (0%)" : `+${pct}%`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {AUCTION_CANDIDATES.map(cand => {
                const d = auctionDeals[cand.code]!;
                const isThisLocked = auctionLockedCode === cand.code;
                const isThisWaitingLock = auctionWaitingLockCode === cand.code;
                const isClosedByOther = isAuctionLockedOrPending && !isThisLocked && !isThisWaitingLock;
                const pushedPreview = Math.round(cand.initialOfferedDeal * (1 + auctionMarkupPct / 100));

                return (
                  <div
                    key={cand.code}
                    className="border border-[#294832] p-3"
                    style={{ opacity: isClosedByOther ? 0.4 : 1 }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className={`guide-chip ${isThisLocked ? "active" : ""}`}>
                          {cand.code} · {cand.ticker}
                        </span>
                        <b className="ml-2 text-sm">{cand.company}</b>
                      </div>
                      <span className="guide-status">
                        {isThisLocked
                          ? `🔒 ALLOTTED & LOCKED 1:1 AT $${d.currentDealPrice.toLocaleString()}`
                          : isThisWaitingLock
                            ? "● LOCK REQUEST SENT · AWAITING PRODUCT TEAM…"
                            : isClosedByOther
                              ? "CLOSED · 1:1 ALLOTTED"
                              : d.dealPushState === "PUSHED_WAITING"
                                ? `● PUSHING +${d.pendingMarkupPct}% ($${d.pendingDealPrice?.toLocaleString()})…`
                                : d.dealPushState === "DEAL_UPDATED"
                                  ? `✓ DEAL UPDATED TO $${d.currentDealPrice.toLocaleString()} · NOT LOCKED`
                                  : `AUCTION OFFER: $${cand.initialOfferedDeal.toLocaleString()} · NOT LOCKED`}
                      </span>
                    </div>

                    <p className="guide-muted mt-1">
                      <b>Topic:</b> {cand.topic}
                    </p>

                    <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] font-mono">
                      <div className="border border-[#294832] p-1.5">
                        <span className="block text-[#81a4d1]">R3 DEAL PRICE</span>
                        <b className="mt-0.5 block text-[#f0f7ff]">${d.currentDealPrice.toLocaleString()}</b>
                      </div>
                      <div className="border border-[#294832] p-1.5">
                        <span className="block text-[#81a4d1]">CONSULTING ({code})</span>
                        <b className="mt-0.5 block text-[#f0f7ff]">{d.consultingLockAccepted ? "✓ LOCK ACCEPTED" : "NOT LOCKED"}</b>
                      </div>
                      <div className="border border-[#294832] p-1.5">
                        <span className="block text-[#81a4d1]">PRODUCT ({cand.code})</span>
                        <b className="mt-0.5 block text-[#f0f7ff]">
                          {d.productLockAccepted
                            ? d.lockInitiatedBy === "PRODUCT" && !d.consultingLockAccepted
                              ? "● SENT LOCK REQUEST"
                              : "✓ LOCK ACCEPTED"
                            : "NOT LOCKED"}
                        </b>
                      </div>
                    </div>

                    {!isClosedByOther && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        {!isThisLocked && !isThisWaitingLock && (
                          <>
                            <button
                              type="button"
                              disabled={d.dealPushState === "PUSHED_WAITING"}
                              className="guide-btn secondary"
                              onClick={() => handlePushAuctionDeal(cand.code)}
                            >
                              {d.dealPushState === "PUSHED_WAITING"
                                ? `PUSHING $${d.pendingDealPrice?.toLocaleString()}…`
                                : `PUSH +${auctionMarkupPct}% ($${pushedPreview.toLocaleString()}) →`}
                            </button>

                            {d.lockInitiatedBy === "PRODUCT" && d.productLockAccepted ? (
                              <button
                                type="button"
                                disabled={d.dealPushState === "PUSHED_WAITING"}
                                className="guide-btn"
                                onClick={() => handleAcceptAuctionProductLock(cand.code)}
                              >
                                ACCEPT LOCK REQUEST FROM {cand.code} (${d.currentDealPrice.toLocaleString()}) 🔒
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={d.dealPushState === "PUSHED_WAITING"}
                                className="guide-btn"
                                onClick={() => handleSendAuctionLockRequest(cand.code)}
                              >
                                SEND LOCK REQUEST TO {cand.code} (${d.currentDealPrice.toLocaleString()}) →
                              </button>
                            )}
                          </>
                        )}

                        {isThisWaitingLock && (
                          <span className="guide-status">
                            ● WAITING FOR {cand.code} TO ACCEPT LOCK REQUEST…
                          </span>
                        )}

                        {isThisLocked && (
                          <span className="guide-status">
                            🔒 ALLOTTED 1:1 WITH {cand.code} AT ${d.currentDealPrice.toLocaleString()} (SETTLED AFTER R3)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Panel>
    </div>

    {/* PANEL 3: Allotted Product Team's Round 3 Crisis & Collaborative Solution Editor */}
    {!allottedPartner ? (
      <div className="mt-4">
        <Panel title="3. Round 3 crisis for your allotted product team" tag="LOCKED UNTIL ROUND 3 ALLOTMENT IS SORTED">
          <div className="guide-alert guide-warning">
            <b>
              {incumbentStatus === "PAIRED_FROM_R2"
                ? `Step 1 Required: Ask ${R2_LOCKED_PARTNER.code} (${R2_LOCKED_PARTNER.company}) for Your Round 3 Price Increase Above`
                : incumbentStatus === "ASKING_WAITING"
                  ? `Waiting for ${R2_LOCKED_PARTNER.code} to Respond to Your Price Increase Request…`
                  : `You Are Unlocked in the Round 3 Auction — Lock 1-to-1 With a Product Team in Panel 2`}
            </b>
            <br />
            Once your Round 3 allotment is sorted—either because <b>{R2_LOCKED_PARTNER.code} accepts your price increase</b> or because you <b>mutually lock 1-to-1 with a new Product team in the Round 3 auction</b>—the Round 3 crisis related to that allotted Product team will appear here for you to solve.
          </div>
        </Panel>
      </div>
    ) : (
      <>
        <div className="guide-grid two mt-4">
          <Panel
            title={`3. Round 3 crisis for allotted Product team: ${allottedPartner.company}`}
            tag={`${allottedPartner.code} · ${allottedPartner.ticker} · ALLOTTED WITH TEAM ${code}`}
          >
            <span className="guide-chip active">{allottedPartner.topic}</span>
            <h2 className="mt-3 text-xl font-semibold">
              {allottedPartner.company} <span className="font-mono text-[#63a8ff]">{allottedPartner.ticker}</span>
            </h2>
            <div className="guide-alert guide-warning mt-3">
              <b>{allottedPartner.crisisCategory}</b>
              <br />
              <b>{allottedPartner.crisisTitle}:</b> {allottedPartner.crisisBody}
            </div>
            <p className="guide-muted mt-3">{allottedPartner.baselineContext}</p>
          </Panel>

          <Panel
            title="Round 3 allotment & payout details"
            tag={`1:1 ALLOTTED · ${code} ⇄ ${allottedPartner.code}`}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>CONSULTING TEAM</small>
                <b>Team {code}</b>
                <span>ALLOTTED 1:1 ✓</span>
              </div>
              <div className="guide-metric">
                <small>ALLOTTED PRODUCT TEAM</small>
                <b>{allottedPartner.code} · {allottedPartner.ticker}</b>
                <span>
                  {allottedPartner.code === R2_LOCKED_PARTNER.code ? "ACCEPTED R3 INCREASE ✓" : "LOCKED VIA R3 AUCTION ✓"}
                </span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>ROUND 3 DEAL (PAID AFTER R3)</small>
                <b className="text-lg">${allottedDealPrice.toLocaleString()}</b>
                <span>LOCKED · CANNOT UPDATE</span>
              </div>
              <div className="guide-metric">
                <small>R3 SOLUTION STATUS</small>
                <b className="text-lg">{submittedAt ? "SUBMITTED (LOCKED)" : "IN PROGRESS"}</b>
                <span>{submittedAt ? `FINALIZED ${submittedAt}` : "SOLVING ALLOTTED CRISIS"}</span>
              </div>
            </div>
            <p className="guide-muted mt-3">
              Your consulting team (<b>Team {code}</b>) is allotted to <b>{allottedPartner.code} ({allottedPartner.company})</b> for Round 3. The agreed price of <b>${allottedDealPrice.toLocaleString()}</b> is settled after Round 3 once you solve and submit their crisis below.
            </p>
          </Panel>
        </div>

        <div className="mt-4">
          <Panel
            title={`Round 3 crisis solution editor for ${allottedPartner.company} (${allottedPartner.ticker})`}
            tag="6 PARTS · 500 WORDS TOTAL · FINAL ON SUBMIT"
          >
            {submittedAt && (
              <div className="guide-alert mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <b>✓ Round 3 crisis solution permanently submitted ({code} ⇄ {allottedPartner.code})</b> · Finalized at {submittedAt} ({count} words). Your Round 3 fee (${allottedDealPrice.toLocaleString()}) is queued for post-Round 3 settlement.
                </div>
                <span className="guide-chip active">FINAL · LOCKED</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="guide-muted">
                Solving {allottedPartner.company}&apos;s Round 3 crisis ({allottedPartner.crisisCategory}) · Once submitted, your solution is locked and cannot be updated.
              </p>
              <b className={count > 500 ? "text-red-400" : "guide-status"}>{count} / 500 WORDS</b>
            </div>
            <div className="guide-tabs mt-4">
              {parts.map((p, i) => (
                <button
                  key={p}
                  type="button"
                  className={active === i ? "active" : ""}
                  onClick={() => setActive(i)}
                >
                  {String(i + 1).padStart(2, "0")} · {p}
                </button>
              ))}
            </div>
            <label className="guide-label">{parts[active].toUpperCase()}</label>
            <textarea
              className="guide-textarea"
              readOnly={!!submittedAt}
              value={values[active]}
              onChange={e => {
                if (submittedAt) return;
                setValues(v => {
                  const next = v.map((x, i) => (i === active ? e.target.value : x));
                  const words = next.reduce((sum, item) => sum + item.trim().split(/\s+/).filter(Boolean).length, 0);
                  return words <= 500 ? next : v;
                });
              }}
              placeholder={consultingPlaceholders[active]}
            />
            <div className="mt-3 flex justify-between">
              <span className="guide-muted">{values[active].trim().split(/\s+/).filter(Boolean).length} words in this part</span>
              <span className="guide-status">{submittedAt ? `● SUBMITTED & LOCKED AT ${submittedAt}` : "● DRAFT IN PROGRESS"}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#294832] pt-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  className="guide-btn secondary"
                  disabled={active === 0}
                  onClick={() => setActive(v => v - 1)}
                >
                  ← PREVIOUS
                </button>
                <button
                  type="button"
                  className="guide-btn secondary"
                  disabled={active === 5}
                  onClick={() => setActive(v => v + 1)}
                >
                  NEXT PART →
                </button>
              </div>
              <button
                type="button"
                className="guide-btn"
                disabled={count === 0 || !!submittedAt}
                onClick={handleSubmit}
              >
                {submittedAt ? "ROUND 3 SOLUTION SUBMITTED & LOCKED ✓" : "SUBMIT ROUND 3 SOLUTION →"}
              </button>
            </div>
          </Panel>
        </div>
      </>
    )}

    <div className="guide-alert mt-4">
      Round 3 flow: <b>1. Ask Round 2 Partner for Price Increase</b> → <b>2A. If Accepted:</b> Price is paid after Round 3 &amp; you solve their Round 3 crisis → <b>2B. If Not Accepted:</b> Unlocked into Round 3 Auction; once allotted &amp; locked 1-to-1, you solve that allotted Product team&apos;s Round 3 crisis.
    </div>
  </>;
}
