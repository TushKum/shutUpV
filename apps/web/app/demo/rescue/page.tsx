"use client";
import {useEffect,useMemo,useState} from "react";
import {PageTitle,Panel,Metric,useDemoTrack,useTeamCode} from "../ui";
import {ProductRound2} from "./product-round2";

interface ProductCandidate {
  code: string;
  company: string;
  ticker: string;
  topic: string;
  initialOfferedDeal: number;
  prdScore: number;
  incomingLockFromProduct?: boolean;
  crisisCategory: string;
  crisisTitle: string;
  crisisBody: string;
  baselineContext: string;
}

const CANDIDATES: ProductCandidate[] = [
  {
    code: "XP01",
    company: "AquaCare",
    ticker: "QAAC",
    topic: "FMCG · Functional Hydration & School Tiffin Packs",
    initialOfferedDeal: 40000,
    prdScore: 68,
    incomingLockFromProduct: false,
    crisisCategory: "CRISIS CARD #7 · GST TAX & MARGIN SHOCK",
    crisisTitle: "GST rises from 12% to 18% while retailers demand higher shelf margin",
    crisisBody:
      "The GST on AquaCare's functional beverage category rises from 12% to 18% from next month. Retail distribution chains refuse to absorb the tax hike and demand an extra 3% shelf margin to keep the packs at eye level.",
    baselineContext:
      "Product topic baseline: ₹20 MRP pack, ₹12 COGS, ₹2.60 channel margin, break-even at 40,000 packs/month. Both XP01 and your consulting team receive this exact crisis to solve together.",
  },
  {
    code: "XP04",
    company: "FreshPack Foods",
    ticker: "FRPK",
    topic: "D2C FoodTech · Ready-to-Eat Meal Pouches",
    initialOfferedDeal: 38000,
    prdScore: 74,
    incomingLockFromProduct: false,
    crisisCategory: "CRISIS CARD #5 · PACKAGING BAN & RECALL",
    crisisTitle: "State ban on multi-layer plastic pouches forces immediate packaging switch",
    crisisBody:
      "A state plastic-waste directive bans multi-layer retort pouches within 30 days. Simultaneously, one batch failed a seal-integrity test in hot transit and must be recalled from 1,200 stores.",
    baselineContext:
      "Product topic baseline: ₹45 MRP pouch, ₹26 COGS, 90-day shelf life requirement. Both XP04 and your consulting team receive this exact crisis to solve together.",
  },
  {
    code: "XP09",
    company: "GridWise Energy",
    ticker: "GRID",
    topic: "CleanTech · Smart Hostel & Campus Micro-Meters",
    initialOfferedDeal: 42000,
    prdScore: 79,
    incomingLockFromProduct: true,
    crisisCategory: "CRISIS CARD #3 · CHIP SHORTAGE & TARIFF HIKE",
    crisisTitle: "Import duty on telemetry modules jumps 22% amid 8-week supplier lead-time spike",
    crisisBody:
      "The imported IoT metering chipset faces an immediate 22% customs duty hike and an 8-week shipment delay from Shenzhen, threatening GridWise's guaranteed campus installation SLAs.",
    baselineContext:
      "Product topic baseline: ₹3,200 hardware unit + ₹180/mo SaaS fee, 35% gross hardware margin. Both XP09 and your consulting team receive this exact crisis to solve together.",
  },
];

const parts=["Diagnosis","Three options","Recommendation","Per-pack maths","Timeline","Risks"];
const consultingPlaceholders=[
  "Diagnose what this topic's crisis does to the locked Product team's unit economics, revenue and operations in concrete numbers.",
  "Outline three distinct turnaround options for the Product team, with the cost, trade-offs and expected effect of each.",
  "State the single collaborative recommendation for your locked Product team and why it wins.",
  "Work out the post-crisis unit economics (new price, unit cost, margin and break-even) after your fix.",
  "Provide a week-by-week collaborative execution timeline with clear milestones.",
  "Identify remaining operational or market risks and your contingency plan B.",
];

interface DealAndLockState {
  // Step 1 & 2: Offered deal and pushed demand updates (NOT locked yet)
  currentDealPrice: number;
  currentMarkupPct: number;
  dealPushState: "OFFERED" | "PUSHED_WAITING" | "DEAL_UPDATED";
  pendingDealPrice?: number;
  pendingMarkupPct?: number;
  // Step 3: Lock Request & Both Teams Accepting Lock Request
  lockInitiatedBy: "NONE" | "CONSULTING" | "PRODUCT";
  consultingLockAccepted: boolean;
  productLockAccepted: boolean;
  lockedAt?: string;
}

const BASE_VALUATION = 40000;
const R1_SCORE = 82;

function initialDealsState(): Record<string, DealAndLockState> {
  return {
    XP01: {
      currentDealPrice: 40000,
      currentMarkupPct: 0,
      dealPushState: "OFFERED",
      lockInitiatedBy: "NONE",
      consultingLockAccepted: false,
      productLockAccepted: false,
    },
    XP04: {
      currentDealPrice: 38000,
      currentMarkupPct: 0,
      dealPushState: "OFFERED",
      lockInitiatedBy: "NONE",
      consultingLockAccepted: false,
      productLockAccepted: false,
    },
    XP09: {
      currentDealPrice: 42000,
      currentMarkupPct: 0,
      dealPushState: "OFFERED",
      lockInitiatedBy: "PRODUCT",
      consultingLockAccepted: false,
      productLockAccepted: true,
    },
  };
}

export default function Rescue(){
  const [track] = useDemoTrack();
  const code = useTeamCode();
  const [markupPct, setMarkupPct] = useState<number>(10);
  const [deals, setDeals] = useState<Record<string, DealAndLockState>>(initialDealsState);
  const [active, setActive] = useState(0);
  const [values, setValues] = useState<string[]>(Array(6).fill(""));
  const [submittedAt, setSubmittedAt] = useState<string|null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(()=>{
    try{
      // Clear any previous preview session storage keys so refreshing the page always starts fresh and unlocked
      localStorage.removeItem("primus-rescue-draft");
      localStorage.removeItem("primus-consulting-r2-submitted");
      localStorage.removeItem("primus-consulting-r2-handshakes");
      localStorage.removeItem("primus-consulting-r2-markup");
      localStorage.removeItem("primus-rescue-draft-v2");
      localStorage.removeItem("primus-consulting-r2-submitted-v2");
      localStorage.removeItem("primus-consulting-r2-requests-v2");
      localStorage.removeItem("primus-consulting-r2-markup-v2");
      localStorage.removeItem("primus-rescue-draft-v3");
      localStorage.removeItem("primus-consulting-r2-submitted-v3");
      localStorage.removeItem("primus-consulting-r2-deals-v3");
      localStorage.removeItem("primus-consulting-r2-markup-v3");
    }catch{}
    setLoaded(true);
  },[]);

  // A pair is LOCKED only when BOTH consultingLockAccepted && productLockAccepted are true.
  const lockedPartnerCode = useMemo(() => {
    for (const c of CANDIDATES) {
      const d = deals[c.code];
      if (d && d.consultingLockAccepted && d.productLockAccepted) return c.code;
    }
    return null;
  }, [deals]);

  // Check if consulting team has sent a lock request that is currently waiting for product team to accept
  const waitingLockCode = useMemo(() => {
    for (const c of CANDIDATES) {
      const d = deals[c.code];
      if (d && d.lockInitiatedBy === "CONSULTING" && d.consultingLockAccepted && !d.productLockAccepted) {
        return c.code;
      }
    }
    return null;
  }, [deals]);

  const isAnyLockedOrLockPending = lockedPartnerCode !== null || waitingLockCode !== null;
  const lockedPartner = useMemo(() => CANDIDATES.find(c => c.code === lockedPartnerCode) ?? null, [lockedPartnerCode]);
  const lockedDeal = lockedPartnerCode ? deals[lockedPartnerCode] : null;

  // Step 2 handler: Push increased demand to a Product team -> Product team accepts -> Deal updates to the increased price (STILL NOT LOCKED!)
  const handlePushIncreasedDeal = (pCode: string) => {
    if (isAnyLockedOrLockPending) return;
    const cand = CANDIDATES.find(c => c.code === pCode)!;
    const current = deals[pCode] ?? initialDealsState()[pCode]!;
    const baseForPush = cand.initialOfferedDeal;
    const increasedPrice = Math.round(baseForPush * (1 + markupPct / 100));

    setDeals(prev => ({
      ...prev,
      [pCode]: {
        ...current,
        dealPushState: "PUSHED_WAITING",
        pendingDealPrice: increasedPrice,
        pendingMarkupPct: markupPct,
      },
    }));

    // Simulate Product team accepting the pushed deal price after 1.2s -> Deal updates to increased price, STILL NOT LOCKED
    window.setTimeout(() => {
      setDeals(prev => {
        const cur = prev[pCode];
        if (!cur || cur.dealPushState !== "PUSHED_WAITING") return prev;
        return {
          ...prev,
          [pCode]: {
            ...cur,
            currentDealPrice: cur.pendingDealPrice ?? increasedPrice,
            currentMarkupPct: cur.pendingMarkupPct ?? markupPct,
            dealPushState: "DEAL_UPDATED",
            // If product team had previously sent an old lock request at the old price, require fresh lock acceptance at the new price
            lockInitiatedBy: "NONE",
            consultingLockAccepted: false,
            productLockAccepted: false,
          },
        };
      });
    }, 1200);
  };

  // Step 3A handler: Consulting team sends Lock Request to Product team -> Product team accepts Lock Request -> LOCKED (cannot update)
  const handleSendLockRequest = (pCode: string) => {
    if (isAnyLockedOrLockPending) return;
    setDeals(prev => ({
      ...prev,
      [pCode]: {
        ...prev[pCode]!,
        lockInitiatedBy: "CONSULTING",
        consultingLockAccepted: true,
        productLockAccepted: false,
      },
    }));

    window.setTimeout(() => {
      const stamp = new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false})+" IST";
      setDeals(prev => {
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

  // Step 3B handler: Product team already sent a Lock Request -> Consulting team accepts Lock Request -> BOTH accepted -> LOCKED (cannot update)
  const handleAcceptProductLockRequest = (pCode: string) => {
    if (isAnyLockedOrLockPending) return;
    const stamp = new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false})+" IST";
    setDeals(prev => ({
      ...prev,
      [pCode]: {
        ...prev[pCode]!,
        consultingLockAccepted: true,
        productLockAccepted: true,
        lockedAt: stamp,
      },
    }));
  };

  const count = useMemo(()=>values.reduce((n,v)=>n+v.trim().split(/\s+/).filter(Boolean).length,0),[values]);

  const handleSubmit = () => {
    if (!lockedPartner || submittedAt || count === 0) return;
    const stamp = new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false})+" IST";
    setSubmittedAt(stamp);
  };

  if (track === "PRODUCT") {
    return <ProductRound2 />;
  }

  if (track !== "CONSULTING") {
    return <><PageTitle eyebrow={`ROUND 2 / RESCUE · ${track}`} title="Rescue another company." sub="Your rescue lottery assignment is AquaCare (QAAC). Read its PRD and crisis card, use the public Q&A board, then write a six-part crisis solution."/><div className="guide-grid two"><Panel title="The company you rescue" tag="QAAC · YOUR ASSIGNMENT"><h2 className="text-xl font-semibold">AquaCare</h2><p className="guide-muted mt-1">Built by Team QAAC · PRD score 68 · post-IPO price $11.80</p><div className="guide-alert guide-warning mt-4"><b>CRISIS CARD · TAX CHANGE</b><br/>The GST on your product category rises from 12% to 18% from next month. Shops will take a larger margin.</div><p className="guide-muted mt-3">Review their product requirements document and the financial assumptions before choosing a response.</p></Panel><Panel title="Your own company" tag="FRPK · YOU BUILT"><h2 className="text-xl font-semibold">FreshPack Foods</h2><p className="guide-muted mt-1">Your company has also received its own crisis card. Team QAAC is assigned to rescue it.</p><div className="guide-alert mt-4"><b>YOUR CRISIS CARD · QUALITY FAILURE</b><br/>A batch fails a safety test. One batch fails a food or product safety test. You must recall it from shops, and the news is spreading on social media.</div><p className="guide-muted mt-3">Your Round 2 points come from the solution you write for QAAC, not from how well another team rescues your company.</p></Panel></div><div className="mt-4"><Panel title="Crisis solution editor" tag="6 PARTS · 500 WORDS TOTAL"><div className="flex items-center justify-between"><p className="guide-muted">Autosaves locally · no submit button</p><b className={count>500?"text-red-400":"guide-status"}>{count} / 500 WORDS</b></div><div className="guide-tabs mt-4">{parts.map((p,i)=><button key={p} type="button" className={active===i?"active":""} onClick={()=>setActive(i)}>{String(i+1).padStart(2,"0")} · {p}</button>)}</div><label className="guide-label">{parts[active].toUpperCase()}</label><textarea className="guide-textarea" value={values[active]} onChange={e=>setValues(v=>{const next=v.map((x,i)=>i===active?e.target.value:x);const words=next.reduce((sum,item)=>sum+item.trim().split(/\s+/).filter(Boolean).length,0);return words<=500?next:v})} placeholder={"Write your "+parts[active].toLowerCase()+"…"} /><div className="mt-3 flex justify-between"><span className="guide-muted">{values[active].trim().split(/\s+/).filter(Boolean).length} words in this part</span><span className="guide-status">● AUTOSAVED IN THIS BROWSER</span></div><div className="mt-4 flex justify-between"><button type="button" className="guide-btn secondary" disabled={active===0} onClick={()=>setActive(v=>v-1)}>← PREVIOUS</button><button type="button" className="guide-btn" disabled={active===5} onClick={()=>setActive(v=>v+1)}>NEXT PART →</button></div></Panel></div><div className="guide-alert mt-4">Rescue solution locks at 01:45 IST. AI judging reads your solution together with the rescued company&apos;s PRD and crisis card. Judges see only the ticker, not team or company names.</div></>;
  }

  return <>
    <PageTitle
      eyebrow={`ROUND 2 / DEAL NEGOTIATION, MUTUAL LOCK & SHARED CRISIS · ${code}`}
      title="Push your deal demand, then mutually lock 1-to-1."
      sub="Step 1: Product teams offer an initial deal based on your Round 1 value. Step 2: Increase your demand (e.g. +10% or more) and push the deal to a Product team—when accepted, the deal price updates (still not locked). Step 3: Either team sends a Lock Request; once both teams accept the Lock Request, you are permanently locked 1-to-1 and cannot update."
    />

    <div className="guide-grid three">
      <Metric
        label="ROUND 1 BASE VALUATION"
        value={`$${BASE_VALUATION.toLocaleString()}`}
        delta={`R1 SCORE ${R1_SCORE} / 100 · STARTING BENCHMARK`}
      />
      <Metric
        label="YOUR DEMAND MARKUP"
        value={lockedDeal ? `+${lockedDeal.currentMarkupPct}% ($${lockedDeal.currentDealPrice.toLocaleString()})` : `+${markupPct}%`}
        delta={
          lockedDeal
            ? "LOCKED DEAL PRICE · CANNOT BE UPDATED"
            : "PUSH TO ANY PRODUCT TEAM TO UPDATE DEAL PRICE"
        }
      />
      <Metric
        label="1:1 LOCK STATUS"
        value={
          lockedPartner
            ? `LOCKED · ${lockedPartner.code}`
            : waitingLockCode
              ? `LOCK SENT · ${waitingLockCode}`
              : "NOT LOCKED"
        }
        delta={
          lockedPartner
            ? `BOTH TEAMS ACCEPTED LOCK AT $${lockedDeal!.currentDealPrice.toLocaleString()}`
            : waitingLockCode
              ? "AWAITING PRODUCT TEAM LOCK ACCEPTANCE…"
              : "DEALS CAN BE UPDATED UNTIL LOCKED"
        }
      />
    </div>

    <div className="guide-grid two mt-4">
      <Panel
        title="1. Increase your demand (before locking)"
        tag={isAnyLockedOrLockPending ? "LOCKED · NO FURTHER UPDATES" : `TEAM ${code} · DEAL MARKUP`}
      >
        <p className="guide-muted">
          Your Round 1 evaluation score (<b>{R1_SCORE} / 100</b>) gave your consultancy a base value of <b>${BASE_VALUATION.toLocaleString()}</b>. Choose a percentage increase below and click <b>Push Increased Deal</b> on any Product team&apos;s offered deal.
        </p>

        <label className="guide-label">SELECT DEMAND (BASE PRICE 0% OR INCREASE %) TO PUSH ON OFFERED DEALS</label>
        <div className="guide-tabs">
          {[0, 5, 10, 15, 20, 25, 40].map(pct => (
            <button
              key={pct}
              type="button"
              disabled={isAnyLockedOrLockPending}
              className={markupPct === pct ? "active" : ""}
              onClick={() => setMarkupPct(pct)}
            >
              {pct === 0 ? `BASE (0% · $${BASE_VALUATION.toLocaleString()})` : `+${pct}% DEMAND`}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="guide-label">CUSTOM DEMAND INCREASE (% · 0% = BASE PRICE)</label>
            <input
              type="number"
              min={0}
              max={200}
              step={1}
              disabled={isAnyLockedOrLockPending}
              className="guide-input font-mono"
              value={markupPct}
              onChange={e => setMarkupPct(Math.max(0, Math.min(200, Number(e.target.value) || 0)))}
            />
          </div>
          <div>
            <label className="guide-label">EXAMPLE ON $40,000 OFFER</label>
            <input
              type="text"
              readOnly
              className="guide-input font-mono"
              value={`$${Math.round(BASE_VALUATION * (1 + markupPct / 100)).toLocaleString()} (+${markupPct}%)`}
            />
          </div>
        </div>

        <div className="guide-alert mt-4">
          <b>How Deal Updates vs. Locking Work:</b>
          <br />
          1. <b>Push Increased Deal:</b> Updates the Product team&apos;s offered deal to your higher price once they accept. <b>The deal is still not locked</b>—you can keep negotiating or push a higher demand.
          <br />
          2. <b>Lock Request:</b> Only when one team sends a <b>Lock Request</b> and <b>both teams accept the Lock Request</b> does the 1-to-1 lock become permanent (no further updates allowed).
        </div>
      </Panel>

      <Panel title="2. Product team offered deals & lock requests" tag="UPDATE DEAL FIRST · THEN MUTUALLY LOCK 1:1">
        <div className="space-y-3">
          {CANDIDATES.map(cand => {
            const d = deals[cand.code] ?? initialDealsState()[cand.code]!;
            const isThisLocked = lockedPartnerCode === cand.code;
            const isThisWaitingLock = waitingLockCode === cand.code;
            const isClosedByOtherLock = isAnyLockedOrLockPending && !isThisLocked && !isThisWaitingLock;
            const pushedPreviewAmount = Math.round(cand.initialOfferedDeal * (1 + markupPct / 100));

            return (
              <div
                key={cand.code}
                className="border border-[#294832] p-3.5"
                style={{ opacity: isClosedByOtherLock ? 0.4 : 1 }}
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
                      ? `🔒 LOCKED 1:1 AT $${d.currentDealPrice.toLocaleString()} · CANNOT UPDATE`
                      : isThisWaitingLock
                        ? "● LOCK REQUEST SENT · AWAITING PRODUCT TEAM LOCK ACCEPTANCE…"
                        : isClosedByOtherLock
                          ? "CLOSED · 1:1 LOCKED WITH ANOTHER TEAM"
                          : d.dealPushState === "PUSHED_WAITING"
                            ? `● PUSHING +${d.pendingMarkupPct}% ($${d.pendingDealPrice?.toLocaleString()}) TO ${cand.code}…`
                            : d.dealPushState === "DEAL_UPDATED"
                              ? `✓ DEAL UPDATED TO $${d.currentDealPrice.toLocaleString()} (+${d.currentMarkupPct}%) · NOT LOCKED YET`
                              : `OFFERED DEAL: $${cand.initialOfferedDeal.toLocaleString()} · NOT LOCKED`}
                  </span>
                </div>

                <p className="guide-muted mt-1.5">
                  <b>Topic:</b> {cand.topic} · <b>Initial Offered Deal:</b> ${cand.initialOfferedDeal.toLocaleString()}
                </p>

                {/* Deal & Lock Status Boxes */}
                <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-mono">
                  <div className="border border-[#294832] p-2">
                    <span className="block text-[#81a4d1]">ACTIVE DEAL PRICE</span>
                    <b className="mt-1 block text-[#f0f7ff]">
                      ${d.currentDealPrice.toLocaleString()}{" "}
                      {d.currentMarkupPct > 0 ? `(+${d.currentMarkupPct}%)` : "(INITIAL OFFER)"}
                    </b>
                  </div>
                  <div className="border border-[#294832] p-2">
                    <span className="block text-[#81a4d1]">CONSULTING ({code}) LOCK</span>
                    <b className="mt-1 block text-[#f0f7ff]">
                      {d.consultingLockAccepted ? "✓ LOCK ACCEPTED" : "NOT LOCKED"}
                    </b>
                  </div>
                  <div className="border border-[#294832] p-2">
                    <span className="block text-[#81a4d1]">PRODUCT ({cand.code}) LOCK</span>
                    <b className="mt-1 block text-[#f0f7ff]">
                      {d.productLockAccepted
                        ? d.lockInitiatedBy === "PRODUCT" && !d.consultingLockAccepted
                          ? "● SENT LOCK REQUEST TO YOU"
                          : "✓ LOCK ACCEPTED"
                        : "NOT LOCKED"}
                    </b>
                  </div>
                </div>

                {/* Action Buttons: Step A (Push Increased Deal) and Step B (Send / Accept Lock Request) */}
                {!isClosedByOtherLock && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!isThisLocked && !isThisWaitingLock && (
                      <>
                        <button
                          type="button"
                          disabled={d.dealPushState === "PUSHED_WAITING"}
                          className="guide-btn secondary"
                          onClick={() => handlePushIncreasedDeal(cand.code)}
                        >
                          {d.dealPushState === "PUSHED_WAITING"
                            ? `PUSHING $${d.pendingDealPrice?.toLocaleString()} TO ${cand.code}…`
                            : `PUSH +${markupPct}% DEAL ($${pushedPreviewAmount.toLocaleString()}) TO ${cand.code} →`}
                        </button>

                        {d.lockInitiatedBy === "PRODUCT" && d.productLockAccepted ? (
                          <button
                            type="button"
                            disabled={d.dealPushState === "PUSHED_WAITING"}
                            className="guide-btn"
                            onClick={() => handleAcceptProductLockRequest(cand.code)}
                          >
                            ACCEPT LOCK REQUEST FROM {cand.code} AT ${d.currentDealPrice.toLocaleString()} 🔒
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={d.dealPushState === "PUSHED_WAITING"}
                            className="guide-btn"
                            onClick={() => handleSendLockRequest(cand.code)}
                          >
                            SEND LOCK REQUEST TO {cand.code} AT ${d.currentDealPrice.toLocaleString()} →
                          </button>
                        )}
                      </>
                    )}

                    {isThisWaitingLock && (
                      <span className="guide-status">
                        ● LOCK REQUEST SENT TO {cand.code} AT ${d.currentDealPrice.toLocaleString()} · WAITING FOR {cand.code} TO ACCEPT LOCK…
                      </span>
                    )}

                    {isThisLocked && (
                      <span className="guide-status">
                        🔒 BOTH TEAMS ACCEPTED LOCK REQUEST ({d.lockedAt}) · PERMANENTLY LOCKED AT ${d.currentDealPrice.toLocaleString()} · CANNOT BE UPDATED
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>

    {!lockedPartner ? (
      <div className="mt-4">
        <Panel title="3. Shared product topic crisis & collaborative solution" tag="LOCKED UNTIL BOTH TEAMS ACCEPT LOCK REQUEST">
          <div className="guide-alert guide-warning">
            <b>
              {waitingLockCode
                ? `Lock Request Sent to ${waitingLockCode} — Waiting for ${waitingLockCode} to Accept Lock Request…`
                : "Not Locked Yet — Push Your Deal Price, Then Send or Accept a Lock Request"}
            </b>
            <br />
            1. Each Product team above starts with an <b>Offered Deal</b>. You can increase your demand (e.g. <b>+{markupPct}%</b>) and push the deal to the Product team; when they accept, the deal updates to the increased price (<b>still not locked</b>).
            <br />
            2. Once you are happy with the deal price, either send a <b>Lock Request</b> to that Product team or accept an incoming Lock Request from them. <b>Only when both teams accept the Lock Request</b> are you permanently locked 1-to-1 and given their topic&apos;s crisis below.
          </div>
        </Panel>
      </div>
    ) : (
      <>
        <div className="guide-grid two mt-4">
          <Panel
            title={`3. Shared crisis on ${lockedPartner.company}'s topic`}
            tag={`${lockedPartner.code} · ${lockedPartner.ticker} · SHARED WITH TEAM ${code}`}
          >
            <span className="guide-chip active">{lockedPartner.topic}</span>
            <h2 className="mt-3 text-xl font-semibold">
              {lockedPartner.company} <span className="font-mono text-[#63a8ff]">{lockedPartner.ticker}</span>
            </h2>
            <div className="guide-alert guide-warning mt-3">
              <b>{lockedPartner.crisisCategory}</b>
              <br />
              <b>{lockedPartner.crisisTitle}:</b> {lockedPartner.crisisBody}
            </div>
            <p className="guide-muted mt-3">{lockedPartner.baselineContext}</p>
          </Panel>

          <Panel
            title="1:1 Locked collaboration details"
            tag={`PERMANENT 1:1 LOCK · ${code} ⇄ ${lockedPartner.code}`}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>CONSULTING TEAM</small>
                <b>Team {code}</b>
                <span>LOCK ACCEPTED ✓</span>
              </div>
              <div className="guide-metric">
                <small>LOCKED PRODUCT TEAM</small>
                <b>{lockedPartner.code} · {lockedPartner.ticker}</b>
                <span>LOCK ACCEPTED ✓</span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>FINAL LOCKED DEAL</small>
                <b className="text-lg">${lockedDeal!.currentDealPrice.toLocaleString()}</b>
                <span>
                  {lockedDeal!.currentMarkupPct > 0 ? `+${lockedDeal!.currentMarkupPct}% INCREASED DEAL` : "INITIAL OFFERED DEAL"} · CANNOT UPDATE
                </span>
              </div>
              <div className="guide-metric">
                <small>SOLUTION STATUS</small>
                <b className="text-lg">{submittedAt ? "SUBMITTED (LOCKED)" : "IN PROGRESS"}</b>
                <span>{submittedAt ? `FINALIZED ${submittedAt}` : "AWAITING SUBMISSION"}</span>
              </div>
            </div>
            <p className="guide-muted mt-3">
              Both <b>Team {code}</b> and <b>Product Team {lockedPartner.code} ({lockedPartner.company})</b> have accepted the Lock Request at <b>${lockedDeal!.currentDealPrice.toLocaleString()}</b>. Neither the deal nor the 1-to-1 pairing can be updated. Solve the shared topic crisis below and submit your final solution.
            </p>
          </Panel>
        </div>

        <div className="mt-4">
          <Panel
            title={`Collaborative crisis solution editor for ${lockedPartner.company} (${lockedPartner.ticker})`}
            tag="6 PARTS · 500 WORDS TOTAL · FINAL ON SUBMIT"
          >
            {submittedAt && (
              <div className="guide-alert mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <b>✓ Round 2 crisis solution permanently submitted ({code} ⇄ {lockedPartner.code})</b> · Finalized at {submittedAt} ({count} words). Submissions cannot be updated once sent.
                </div>
                <span className="guide-chip active">FINAL · LOCKED</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="guide-muted">
                Solving {lockedPartner.company}&apos;s crisis ({lockedPartner.crisisCategory}) · Once submitted, your solution is locked and cannot be updated.
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
                {submittedAt ? "SOLUTION SUBMITTED & LOCKED ✓" : "SUBMIT SOLUTION →"}
              </button>
            </div>
          </Panel>
        </div>
      </>
    )}

    <div className="guide-alert mt-4">
      Round 2 flow: <b>1. Offered Deal by Product Team</b> → <b>2. Push Increased Demand</b> (updates deal price when accepted; still not locked) → <b>3. Lock Request Accepted by Both Teams</b> (permanently locks 1-to-1; cannot update).
    </div>
  </>;
}
