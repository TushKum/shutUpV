"use client";
import {useEffect,useMemo,useState} from "react";
import {PageTitle,Panel,Metric,useTeamCode} from "../ui";

interface R3Consultant {
  code: string;
  r1Score: number;
  baseValue: number;
  r3DemandPrice: number;
  r3MarkupPct: number;
  speciality: string;
  isIncumbent?: boolean;
}

const R3_CONSULTANTS: R3Consultant[] = [
  {
    code: "XC01",
    r1Score: 82,
    baseValue: 40000,
    r3DemandPrice: 46000,
    r3MarkupPct: 15,
    speciality: "Pricing Turnarounds, GST Structuring & FMCG Margins",
    isIncumbent: true,
  },
  {
    code: "XC04",
    r1Score: 78,
    baseValue: 36000,
    r3DemandPrice: 36000,
    r3MarkupPct: 0,
    speciality: "Supply Chain Optimization & Retail Distribution",
  },
  {
    code: "XC07",
    r1Score: 88,
    baseValue: 46000,
    r3DemandPrice: 52900,
    r3MarkupPct: 15,
    speciality: "High-Margin D2C Positioning & Crisis Recovery",
  },
  {
    code: "XC12",
    r1Score: 74,
    baseValue: 32000,
    r3DemandPrice: 35200,
    r3MarkupPct: 10,
    speciality: "Cost Restructuring & Packaging Value Engineering",
  },
];

interface ProblemStatement {
  id: string;
  title: string;
  sector: string;
  brief: string;
  crisisTwist: string;
  claimedBy?: string;
  claimedByName?: string;
}

const INITIAL_STATEMENTS: ProblemStatement[] = [
  {
    id: "PS-01",
    title: "Cold-Chain Last-Mile Dairy & Fresh Produce Loss",
    sector: "FMCG & AgriTech",
    brief: "28% of perishable dairy and fresh-cut packs spoil between Tier-2 hubs and kirana shelves during 44°C summers.",
    crisisTwist: "Diesel cold-van freight rates spike 24% overnight while local municipalities restrict daytime delivery trucks.",
  },
  {
    id: "PS-02",
    title: "Micro-Working Capital for Unorganised Kirana Stores",
    sector: "FinTech",
    brief: "Small shopkeepers pay 36% APR to informal lenders to restock fast-moving inventory before festival peaks.",
    crisisTwist: "NBFC liquidity tightens and UPI merchant settlement delays stretch from T+0 to T+3 days.",
  },
  {
    id: "PS-03",
    title: "Affordable Preventive Diagnostics for Tier-3 Households",
    sector: "HealthTech",
    brief: "Families delay blood and metabolic screenings until hospitalisation because lab visits cost a day's wages.",
    crisisTwist: "Diagnostic reagent import duties jump 18% and NABL accreditation audits tighten across regional labs.",
    claimedBy: "XP14",
    claimedByName: "Luma Living",
  },
  {
    id: "PS-04",
    title: "Zero-Plastic Refill Stations for College & Office Campuses",
    sector: "CleanTech & FMCG",
    brief: "Campuses generate 40,000 single-use bottles monthly; students want hygienic ₹10 flavoured hydration refills.",
    crisisTwist: "A state single-use packaging levy takes effect in 14 days while water-filter cartridge costs jump 30%.",
  },
  {
    id: "PS-05",
    title: "Verified Part-Time Shift & Skill Escrow for College Students",
    sector: "FinTech & EdTech",
    brief: "Local businesses struggle with 55% no-show rates on weekend shifts while students face delayed gig payouts.",
    crisisTwist: "Platform gig-worker welfare cess adds 4% per transaction and two competing job boards slash fees to zero.",
  },
  {
    id: "PS-06",
    title: "Smart Hostel Electricity & Peak-Load Sub-Metering",
    sector: "CleanTech",
    brief: "Campus hostels waste 32% of AC electricity due to flat-rate billing with zero room-level visibility.",
    crisisTwist: "State utility board mandates new BIS certification within 45 days and telemetry chip lead times double.",
  },
  {
    id: "PS-07",
    title: "Quick-Commerce Dark-Store Shelf-Life & Waste Optimizer",
    sector: "FMCG & SaaS",
    brief: "10-minute delivery dark stores write off 9% of fresh inventory weekly due to poor hyperlocal demand forecasting.",
    crisisTwist: "Quick-commerce platforms hike brand commission rates from 18% to 30% and enforce 48-hour expiry return penalties.",
    claimedBy: "XP08",
    claimedByName: "VitaCart",
  },
  {
    id: "PS-08",
    title: "Low-Cost Diabetic & High-Protein Everyday Staples",
    sector: "HealthTech & FMCG",
    brief: "Urban families want everyday atta and snack mixes with verified low-GI labels under ₹80/pack.",
    crisisTwist: "FSSAI bans front-of-pack clinical claims without third-party trials and lentil/whey inputs surge 22%.",
  },
];

interface DraftQueueEntry {
  rank: number;
  code: string;
  company: string;
  cash: number;
  status: "CLAIMED" | "YOUR_TURN" | "UPCOMING";
  pickedStatementId?: string;
}

const mvpR3Parts = [
  "Problem Statement & Crisis Angle",
  "New MVP Concept & Core Features",
  "Consultant Crisis Solution Integrated",
  "Target Users & Differentiation",
  "Unit Economics & Revenue Model",
  "Launch Roadmap & Key Risks",
];

const mvpR3Guides = [
  "Frame the locked Round 3 problem statement and explain the exact crisis challenge hitting this market.",
  "Design your brand-new Round 3 MVP: core Version-1 features, product experience and what makes it viable immediately.",
  "Write how you incorporate your Round 3 Consultant's crisis solution directly into this new MVP.",
  "Define your exact initial users and how this MVP beats existing alternatives in the sector.",
  "Show the new MVP's pricing, unit cost, channel margin and monthly break-even volume.",
  "Give a 4-week rollout roadmap and mitigation steps for the top execution risks.",
];

export function ProductRound3() {
  const code = useTeamCode();
  const [companyMeta, setCompanyMeta] = useState({ company: "AquaCare", ticker: "QAAC" });

  // ── STAGE 1: CONSULTANT RETENTION / PRICE INCREASE / REMOVE FOR RE-BID (WITH OPTION TO RETURN TO INCUMBENT) ──
  const [consultantMode, setConsultantMode] = useState<
    "INCUMBENT_ASKING" | "REBIDDING" | "LOCK_WAITING" | "FINAL_LOCKED"
  >("INCUMBENT_ASKING");
  const [removedIncumbent, setRemovedIncumbent] = useState<boolean>(false);
  const [selectedConsultantCode, setSelectedConsultantCode] = useState<string>("XC01");
  const [lockedConsultantCode, setLockedConsultantCode] = useState<string | null>(null);
  const [rebidResponses, setRebidResponses] = useState<Record<string, "IDLE" | "ASKED" | "COUNTERED_OR_ACCEPTED">>({});

  // ── STAGE 2: REVERSE-MONEY ORDER DRAFT (LEAST MONEY PICKS FIRST, 1 TEAM PER STATEMENT, PERMANENT LOCK) ──
  const [statements, setStatements] = useState<ProblemStatement[]>(INITIAL_STATEMENTS);
  const [search, setSearch] = useState<string>("");
  const [lockedStatementId, setLockedStatementId] = useState<string | null>(null);
  const [draftQueue, setDraftQueue] = useState<DraftQueueEntry[]>([
    { rank: 1, code: "XP14", company: "Luma Living", cash: 12000, status: "CLAIMED", pickedStatementId: "PS-03" },
    { rank: 2, code: "XP08", company: "VitaCart", cash: 24000, status: "CLAIMED", pickedStatementId: "PS-07" },
    { rank: 3, code: "XP01", company: "AquaCare (You)", cash: 36000, status: "YOUR_TURN" },
    { rank: 4, code: "XP04", company: "FreshPack Foods", cash: 52000, status: "UPCOMING" },
    { rank: 5, code: "XP09", company: "GridWise Energy", cash: 78000, status: "UPCOMING" },
  ]);

  // ── STAGE 3: NEW ROUND 3 MVP EDITOR ──
  const [active, setActive] = useState(0);
  const [mvpValues, setMvpValues] = useState<string[]>(Array(6).fill(""));
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("primus-product-r1-meta");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.company) {
          setCompanyMeta({ company: parsed.company, ticker: parsed.ticker || "QAAC" });
          setDraftQueue(prev =>
            prev.map(q => (q.rank === 3 ? { ...q, code, company: `${parsed.company} (You)` } : q))
          );
        }
      }
    } catch {}
  }, [code]);

  const incumbent = R3_CONSULTANTS[0]!;
  const lockedConsultant = useMemo(
    () => R3_CONSULTANTS.find(c => c.code === lockedConsultantCode) ?? null,
    [lockedConsultantCode]
  );
  const lockedStatement = useMemo(
    () => statements.find(s => s.id === lockedStatementId) ?? null,
    [statements, lockedStatementId]
  );

  // Accept incumbent XC01's Round 3 price increase directly -> lock XC01 for Round 3
  const handleAcceptIncumbent = () => {
    setSelectedConsultantCode(incumbent.code);
    setConsultantMode("LOCK_WAITING");
    window.setTimeout(() => {
      setLockedConsultantCode(incumbent.code);
      setConsultantMode("FINAL_LOCKED");
    }, 1100);
  };

  // Remove incumbent XC01 for re-bid -> enters open re-bid list (still keeps option to get back to XC01 if needed!)
  const handleRemoveForRebid = () => {
    setRemovedIncumbent(true);
    setConsultantMode("REBIDDING");
  };

  // Ask another consultant during re-bid
  const handleAskRebidConsultant = (firmCode: string) => {
    if (consultantMode !== "REBIDDING") return;
    setRebidResponses(prev => ({ ...prev, [firmCode]: "ASKED" }));
    window.setTimeout(() => {
      setRebidResponses(prev => ({ ...prev, [firmCode]: "COUNTERED_OR_ACCEPTED" }));
    }, 900);
  };

  // Lock with a re-bid consultant (or return back to incumbent XC01!)
  const handleLockRebidConsultant = (firmCode: string) => {
    if (consultantMode !== "REBIDDING") return;
    setSelectedConsultantCode(firmCode);
    setConsultantMode("LOCK_WAITING");
    window.setTimeout(() => {
      setLockedConsultantCode(firmCode);
      setConsultantMode("FINAL_LOCKED");
    }, 1100);
  };

  // Pick & permanently lock 1 Problem Statement (1 team per statement, cannot change!)
  const handlePickStatement = (psId: string) => {
    if (lockedStatementId) return;
    const target = statements.find(s => s.id === psId);
    if (!target || target.claimedBy) return;

    setLockedStatementId(psId);
    setStatements(prev =>
      prev.map(s =>
        s.id === psId
          ? { ...s, claimedBy: code, claimedByName: companyMeta.company }
          : s
      )
    );
    setDraftQueue(prev =>
      prev.map(q =>
        q.rank === 3
          ? { ...q, status: "CLAIMED", pickedStatementId: psId }
          : q.rank === 4
            ? { ...q, status: "YOUR_TURN" }
            : q
      )
    );

    // Next-least-money team (#4 XP04) picks an open statement shortly after so the draft order progression is visible
    window.setTimeout(() => {
      setStatements(prev => {
        const nextOpen = prev.find(s => !s.claimedBy && s.id !== psId);
        if (!nextOpen) return prev;
        setDraftQueue(dq =>
          dq.map(q =>
            q.rank === 4
              ? { ...q, status: "CLAIMED", pickedStatementId: nextOpen.id }
              : q.rank === 5
                ? { ...q, status: "YOUR_TURN" }
                : q
          )
        );
        return prev.map(s =>
          s.id === nextOpen.id ? { ...s, claimedBy: "XP04", claimedByName: "FreshPack Foods" } : s
        );
      });
    }, 1500);
  };

  const filteredStatements = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return statements;
    return statements.filter(
      s =>
        s.id.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        s.sector.toLowerCase().includes(q) ||
        s.brief.toLowerCase().includes(q)
    );
  }, [statements, search]);

  const consultantCrisisSolution = useMemo(() => {
    if (!lockedStatement || !lockedConsultant) return null;
    return {
      diagnosis: `Team ${lockedConsultant.code} Diagnosis for ${lockedStatement.id}: ${lockedStatement.crisisTwist} This threatens immediate unit margins and launch readiness unless addressed at the MVP layer.`,
      strategy: `Build a capital-light Version-1 workflow directly around ${lockedStatement.title}, locking pre-committed anchor customers and hedging input/compliance shock via modular pricing.`,
      unitMaths: `Target gross margin 38%+ after crisis shock; keep fixed overhead under 18% of Round 3 revenue and reach break-even within 60 days.`,
      risks: `Dual-supplier / regulatory fallback plan pre-configured before Week 2 rollout.`,
    };
  }, [lockedStatement, lockedConsultant]);

  const handlePullConsultantIntoMvp = () => {
    if (!consultantCrisisSolution || !lockedStatement || !lockedConsultant || submittedAt) return;
    setMvpValues([
      `${lockedStatement.id} (${lockedStatement.title}): ${lockedStatement.brief} Crisis twist: ${lockedStatement.crisisTwist}`,
      `New Round 3 MVP built for ${lockedStatement.title}: focused Version-1 solution addressing the crisis directly.`,
      `Integrated Team ${lockedConsultant.code}'s crisis solution: ${consultantCrisisSolution.strategy}`,
      `Primary users in ${lockedStatement.sector} who are most exposed to the crisis and require immediate relief.`,
      consultantCrisisSolution.unitMaths,
      `4-week launch plan with fallback controls: ${consultantCrisisSolution.risks}`,
    ]);
  };

  const mvpCount = useMemo(() => mvpValues.reduce((n, v) => n + v.trim().split(/\s+/).filter(Boolean).length, 0), [mvpValues]);

  const handleSubmitR3Mvp = () => {
    if (!lockedStatement || !lockedConsultant || submittedAt || mvpCount === 0) return;
    const stamp = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " IST";
    setSubmittedAt(stamp);
  };

  return <>
    <PageTitle
      eyebrow={`ROUND 3 / CONSULTANT RE-BID, LEAST-MONEY DRAFT & NEW MVP · ${code}`}
      title="Decide your consultant, draft your problem statement, and build a new MVP."
      sub="In Round 3, accept your consultant's price increase or remove them to re-bid for another (with the option to return to them if needed). Then pick 1 exclusive problem statement in least-money-first order—once locked, it is sent to your consultant to solve the crisis while you build another MVP with it."
    />

    <div className="guide-grid three">
      <Metric
        label="ROUND 3 CONSULTANT"
        value={
          lockedConsultant
            ? `LOCKED · ${lockedConsultant.code}`
            : consultantMode === "REBIDDING"
              ? "RE-BIDDING OPEN"
              : consultantMode === "LOCK_WAITING"
                ? `LOCKING ${selectedConsultantCode}…`
                : `R2 PARTNER: ${incumbent.code}`
        }
        delta={
          lockedConsultant
            ? `FEE $${lockedConsultant.r3DemandPrice.toLocaleString()} · RECEIVES YOUR PS`
            : consultantMode === "REBIDDING"
              ? "PICK ANOTHER OR RETURN TO XC01"
              : `${incumbent.code} ASKING +${incumbent.r3MarkupPct}% ($${incumbent.r3DemandPrice.toLocaleString()})`
        }
      />
      <Metric
        label="DRAFT ORDER (LEAST MONEY FIRST)"
        value={lockedStatement ? `PICKED · ${lockedStatement.id}` : "PICK #3 · YOUR TURN"}
        delta={
          lockedStatement
            ? "1 TEAM PER STATEMENT · PERMANENTLY LOCKED"
            : "3RD LEAST CASH ($36,000) · PICKS BEFORE RICHER TEAMS"
        }
      />
      <Metric
        label="ROUND 3 NEW MVP"
        value={submittedAt ? "SUBMITTED (LOCKED)" : lockedStatement && lockedConsultant ? "READY TO BUILD" : "WAITING ON STEPS 1 & 2"}
        delta={
          submittedAt
            ? `FINALIZED ${submittedAt}`
            : lockedStatement && lockedConsultant
              ? `PS ${lockedStatement.id} SENT TO ${lockedConsultant.code}`
              : "LOCK CONSULTANT & PICK STATEMENT FIRST"
        }
      />
    </div>

    {/* ── STEP 1: KEEP CONSULTANT OR REMOVE FOR RE-BID (WITH OPTION TO GET BACK) ── */}
    <div className="guide-grid two mt-4">
      <Panel
        title="1. Round 3 consultant decision (keep or remove for re-bid)"
        tag={
          lockedConsultant
            ? `FINAL R3 CONSULTANT · ${lockedConsultant.code}`
            : consultantMode === "REBIDDING"
              ? "REMOVED FOR RE-BID · OPTION TO RETURN"
              : `INCUMBENT ${incumbent.code} ASKING PRICE INCREASE`
        }
      >
        {consultantMode === "INCUMBENT_ASKING" && (
          <>
            <p className="guide-muted">
              Your Round 2 consultant <b>Team {incumbent.code}</b> is asking for a Round 3 price increase above their <b>${incumbent.baseValue.toLocaleString()}</b> base value. You can either <b>accept their increase</b> or <b>remove them for re-bid</b> to look for another consultant (and still return to {incumbent.code} if you don&apos;t find a better fit).
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-mono">
              <div className="border border-[#294832] p-2">
                <span className="block text-[#cfa078]">BASE VALUE</span>
                <b className="mt-0.5 block text-[#fff7f0]">${incumbent.baseValue.toLocaleString()}</b>
              </div>
              <div className="border border-[#294832] p-2">
                <span className="block text-[#cfa078]">R3 DEMAND</span>
                <b className="mt-0.5 block text-[#fff7f0]">${incumbent.r3DemandPrice.toLocaleString()}</b>
              </div>
              <div className="border border-[#294832] p-2">
                <span className="block text-[#cfa078]">MORE THAN BASE</span>
                <b className="mt-0.5 block text-[#ff9b45]">
                  +${(incumbent.r3DemandPrice - incumbent.baseValue).toLocaleString()} (+{incumbent.r3MarkupPct}%)
                </b>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="guide-btn" onClick={handleAcceptIncumbent}>
                ACCEPT {incumbent.code} AT ${incumbent.r3DemandPrice.toLocaleString()} (+{incumbent.r3MarkupPct}%) →
              </button>
              <button type="button" className="guide-btn secondary" onClick={handleRemoveForRebid}>
                REMOVE {incumbent.code} &amp; RE-BID FOR ANOTHER CONSULTANT →
              </button>
            </div>
          </>
        )}

        {consultantMode === "REBIDDING" && (
          <>
            <div className="guide-alert guide-warning mb-3">
              <b>Team {incumbent.code} removed for Round 3 re-bid.</b> Browse available consultants below, check any price increase above base, and lock a new consultant—or click <b>Return to Previous Consultant ({incumbent.code})</b> if no other option fits.
            </div>
            <div className="space-y-2.5">
              {R3_CONSULTANTS.map(firm => {
                const resp = rebidResponses[firm.code] ?? "IDLE";
                const extra = firm.r3DemandPrice - firm.baseValue;
                return (
                  <div key={firm.code} className="border border-[#294832] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className={`guide-chip ${firm.isIncumbent ? "active" : ""}`}>
                          {firm.code} {firm.isIncumbent ? "· PREVIOUS R2 CONSULTANT" : `· R1 SCORE ${firm.r1Score}`}
                        </span>
                        <b className="ml-2 text-sm">Team {firm.code}</b>
                      </div>
                      <span className="guide-status">
                        {firm.isIncumbent
                          ? `AVAILABLE TO RETURN · $${firm.r3DemandPrice.toLocaleString()} (+${firm.r3MarkupPct}%)`
                          : resp === "ASKED"
                            ? "● REQUEST SENT…"
                            : resp === "COUNTERED_OR_ACCEPTED"
                              ? extra > 0
                                ? `▲ DEMANDING +$${extra.toLocaleString()} (+${firm.r3MarkupPct}%) OVER BASE`
                                : `✓ ACCEPTED AT BASE ($${firm.baseValue.toLocaleString()})`
                              : `BASE: $${firm.baseValue.toLocaleString()}`}
                      </span>
                    </div>
                    <p className="guide-muted mt-1">{firm.speciality}</p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {firm.isIncumbent ? (
                        <button
                          type="button"
                          className="guide-btn secondary"
                          onClick={() => handleLockRebidConsultant(firm.code)}
                        >
                          GET BACK WITH {firm.code} AT ${firm.r3DemandPrice.toLocaleString()} 🔒
                        </button>
                      ) : resp === "IDLE" ? (
                        <button
                          type="button"
                          className="guide-btn secondary"
                          onClick={() => handleAskRebidConsultant(firm.code)}
                        >
                          SEND RE-BID REQUEST TO {firm.code} (${firm.baseValue.toLocaleString()}) →
                        </button>
                      ) : resp === "COUNTERED_OR_ACCEPTED" ? (
                        <button
                          type="button"
                          className="guide-btn"
                          onClick={() => handleLockRebidConsultant(firm.code)}
                        >
                          ACCEPT &amp; LOCK {firm.code} AT ${firm.r3DemandPrice.toLocaleString()} 🔒
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {consultantMode === "LOCK_WAITING" && (
          <div className="guide-alert">
            <b>● Locking Round 3 Consultant Team {selectedConsultantCode}…</b> Confirming 1-to-1 Round 3 assignment.
          </div>
        )}

        {consultantMode === "FINAL_LOCKED" && lockedConsultant && (
          <div className="space-y-3">
            <div className="guide-alert">
              <b>✓ Round 3 Consultant Locked: Team {lockedConsultant.code}</b> at <b>${lockedConsultant.r3DemandPrice.toLocaleString()}</b>{" "}
              ({lockedConsultant.r3MarkupPct > 0 ? `+${lockedConsultant.r3MarkupPct}% above base` : "at base price"}).
              {removedIncumbent && lockedConsultant.code === incumbent.code
                ? " You chose to return to your previous consultant."
                : removedIncumbent
                  ? ` Replaced ${incumbent.code} via Round 3 re-bid.`
                  : " Retained from Round 2."}
            </div>
            <p className="guide-muted">
              Once you lock your Round 3 Problem Statement in Step 2, it is automatically sent to <b>Team {lockedConsultant.code}</b> so they can solve its crisis for your new MVP.
            </p>
          </div>
        )}
      </Panel>

      {/* ── STEP 2A: REVERSE-MONEY ORDER DRAFT QUEUE (LEAST MONEY PICKS FIRST) ── */}
      <Panel title="2. Draft order (least money chooses first)" tag="1 TEAM PER PROBLEM STATEMENT · LOCKS ON PICK">
        <p className="guide-muted mb-3">
          Problem statement selection starts with the <b>company with the least money</b>, then the second-least money, all the way up to the richest company. Once a team picks a statement, it is <b>permanently locked (1 team per statement)</b>.
        </p>
        <div className="space-y-2">
          {draftQueue.map(entry => (
            <div
              key={entry.code}
              className="flex flex-wrap items-center justify-between gap-2 border border-[#294832] p-2.5"
            >
              <div className="flex items-center gap-2">
                <span className={`guide-chip ${entry.status === "YOUR_TURN" ? "active" : ""}`}>
                  #{String(entry.rank).padStart(2, "0")}
                </span>
                <div>
                  <b className="text-xs">{entry.code} · {entry.company}</b>
                  <span className="block font-mono text-[10px] text-[#cfa078]">
                    CASH: ${entry.cash.toLocaleString()} {entry.rank === 1 ? "(LEAST MONEY)" : entry.rank === draftQueue.length ? "(MOST MONEY)" : ""}
                  </span>
                </div>
              </div>
              <span className="guide-status">
                {entry.status === "CLAIMED"
                  ? `🔒 LOCKED ${entry.pickedStatementId}`
                  : entry.status === "YOUR_TURN"
                    ? entry.rank === 3
                      ? "● YOUR TURN NOW"
                      : "● PICKING NOW…"
                    : "WAITING IN ORDER"}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>

    {/* ── STEP 2B: PROBLEM STATEMENT POOL (PICK 1 & LOCK PERMANENTLY) ── */}
    <div className="mt-4">
      <Panel
        title="3. Problem statement pool (pick 1 — strictly 1 team per statement, cannot change)"
        tag={lockedStatement ? `LOCKED: ${lockedStatement.id} · SENT TO CONSULTANT` : "YOUR TURN (#3 LEAST MONEY) · CHOOSE 1"}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="guide-muted">
            Showing available &amp; claimed Round 3 problem statements (pool of 50 statements; 1 team per statement). Once picked, it locks permanently and cannot be changed.
          </p>
          <input
            type="text"
            className="guide-input !w-full sm:!w-64"
            placeholder="Filter by ID, sector or keyword…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="guide-grid two">
          {filteredStatements.map(ps => {
            const isYours = ps.id === lockedStatementId;
            const isTakenByOther = !!ps.claimedBy && !isYours;
            const isDisabled = !!lockedStatementId || isTakenByOther;

            return (
              <div
                key={ps.id}
                className="border border-[#294832] p-3.5"
                style={{ opacity: isTakenByOther || (!!lockedStatementId && !isYours) ? 0.45 : 1 }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className={`guide-chip ${isYours ? "active" : ""}`}>{ps.id}</span>
                    <span className="ml-2 font-mono text-[10px] text-[#cfa078]">{ps.sector}</span>
                  </div>
                  <span className="guide-status">
                    {isYours
                      ? "🔒 LOCKED BY YOUR TEAM (FINAL)"
                      : isTakenByOther
                        ? `🔒 TAKEN BY ${ps.claimedBy} (${ps.claimedByName})`
                        : "● OPEN · 1 SLOT"}
                  </span>
                </div>
                <h3 className="mt-2 text-sm font-semibold">{ps.title}</h3>
                <p className="guide-muted mt-1">{ps.brief}</p>
                <p className="mt-1.5 text-[11px] text-[#ffd1a8]">
                  <b>Crisis angle:</b> {ps.crisisTwist}
                </p>
                <div className="mt-3">
                  {isYours ? (
                    <span className="guide-status">
                      ✓ PERMANENTLY LOCKED TO TEAM {code} · CANNOT CHANGE · DISPATCHED TO CONSULTANT
                    </span>
                  ) : isTakenByOther ? (
                    <span className="guide-muted">Unavailable — already locked by {ps.claimedBy} (1 team max).</span>
                  ) : (
                    <button
                      type="button"
                      disabled={isDisabled}
                      className="guide-btn"
                      onClick={() => handlePickStatement(ps.id)}
                    >
                      PICK &amp; LOCK {ps.id} (PERMANENT) 🔒
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>

    {/* ── STEP 3: DISPATCHED TO CONSULTANT + BUILD NEW ROUND 3 MVP ── */}
    {!lockedStatement || !lockedConsultant ? (
      <div className="mt-4">
        <Panel title="4. Consultant crisis solution & new Round 3 MVP" tag="UNLOCKS ONCE CONSULTANT & PROBLEM STATEMENT ARE LOCKED">
          <div className="guide-alert guide-warning">
            <b>Complete Steps 1 &amp; 3 Above to Unlock Your New Round 3 MVP</b>
            <br />
            • Step 1 (Round 3 Consultant): <b>{lockedConsultant ? `✓ Locked with Team ${lockedConsultant.code}` : "Pending — Accept XC01 or re-bid & lock a consultant"}</b>
            <br />
            • Step 3 (Problem Statement Draft): <b>{lockedStatement ? `✓ Locked ${lockedStatement.id}` : "Pending — Pick & lock 1 open problem statement above"}</b>
            <br />
            Once both are locked, the problem statement is sent to your consultant to solve the crisis and the new Round 3 MVP builder opens here.
          </div>
        </Panel>
      </div>
    ) : (
      <>
        <div className="guide-grid two mt-4">
          <Panel
            title={`4. Dispatched ${lockedStatement.id} → Consultant Team ${lockedConsultant.code}'s crisis solution`}
            tag={`SHARED WITH ${lockedConsultant.code} · LIVE`}
          >
            <span className="guide-chip active">
              {lockedStatement.id} · SENT TO CONSULTANT TEAM {lockedConsultant.code} ✓
            </span>
            <h3 className="mt-2.5 text-base font-semibold">{lockedStatement.title}</h3>
            {consultantCrisisSolution && (
              <div className="mt-3 space-y-2.5 text-xs">
                <div className="border border-[#294832] p-2.5">
                  <span className="guide-status">CONSULTANT DIAGNOSIS</span>
                  <p className="guide-muted mt-1">{consultantCrisisSolution.diagnosis}</p>
                </div>
                <div className="border border-[#294832] p-2.5">
                  <span className="guide-status">CRISIS STRATEGY FOR NEW MVP</span>
                  <p className="guide-muted mt-1">{consultantCrisisSolution.strategy}</p>
                </div>
                <div className="border border-[#294832] p-2.5">
                  <span className="guide-status">UNIT ECONOMICS &amp; RISK PLAN</span>
                  <p className="guide-muted mt-1">
                    {consultantCrisisSolution.unitMaths} {consultantCrisisSolution.risks}
                  </p>
                </div>
              </div>
            )}
            {!submittedAt && (
              <button
                type="button"
                className="guide-btn secondary mt-3 w-full"
                onClick={handlePullConsultantIntoMvp}
              >
                PRE-FILL CONSULTANT&apos;S CRISIS SOLUTION INTO NEW MVP EDITOR ↓
              </button>
            )}
          </Panel>

          <Panel title="Round 3 final pairing & statement lock" tag="PERMANENT · CANNOT CHANGE">
            <div className="grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>LOCKED STATEMENT</small>
                <b>{lockedStatement.id}</b>
                <span>1 TEAM MAX · CANNOT CHANGE</span>
              </div>
              <div className="guide-metric">
                <small>R3 CONSULTANT</small>
                <b>Team {lockedConsultant.code}</b>
                <span>FEE ${lockedConsultant.r3DemandPrice.toLocaleString()}</span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>DRAFT POSITION</small>
                <b className="text-base">#3 (LEAST-MONEY ORDER)</b>
                <span>{companyMeta.company} ({companyMeta.ticker})</span>
              </div>
              <div className="guide-metric">
                <small>NEW MVP STATUS</small>
                <b className="text-base">{submittedAt ? "SUBMITTED (LOCKED)" : "IN PROGRESS"}</b>
                <span>{submittedAt ? `FINALIZED ${submittedAt}` : "BUILD NEW MVP BELOW"}</span>
              </div>
            </div>
            <div className="guide-alert mt-4">
              <b>{lockedStatement.id}</b> has been sent to <b>Team {lockedConsultant.code}</b> to solve the crisis. Build your brand-new Round 3 MVP incorporating their solution below and submit it.
            </div>
          </Panel>
        </div>

        <div className="mt-4">
          <Panel
            title={`Build your new Round 3 MVP for ${lockedStatement.id} (${lockedStatement.title})`}
            tag="6 PARTS · 700 WORDS TOTAL · FINAL ON SUBMIT"
          >
            {submittedAt && (
              <div className="guide-alert mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <b>✓ Round 3 New MVP permanently submitted for {lockedStatement.id} (with Team {lockedConsultant.code})</b> · Finalized at {submittedAt} ({mvpCount} words).
                </div>
                <span className="guide-chip active">FINAL · LOCKED</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="guide-muted">
                Build your new Round 3 MVP for <b>{lockedStatement.id}</b> incorporating Team {lockedConsultant.code}&apos;s crisis solution. Once submitted, it cannot be updated.
              </p>
              <b className={mvpCount > 700 ? "text-red-400" : "guide-status"}>{mvpCount} / 700 WORDS</b>
            </div>
            <div className="guide-tabs mt-4">
              {mvpR3Parts.map((p, i) => (
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
            <label className="guide-label">{mvpR3Parts[active]!.toUpperCase()}</label>
            <textarea
              className="guide-textarea"
              readOnly={!!submittedAt}
              value={mvpValues[active]}
              onChange={e => {
                if (submittedAt) return;
                setMvpValues(v => {
                  const next = v.map((x, i) => (i === active ? e.target.value : x));
                  const words = next.reduce((sum, item) => sum + item.trim().split(/\s+/).filter(Boolean).length, 0);
                  return words <= 700 ? next : v;
                });
              }}
              placeholder={mvpR3Guides[active]}
            />
            <div className="mt-3 flex justify-between">
              <span className="guide-muted">{mvpValues[active]!.trim().split(/\s+/).filter(Boolean).length} words in this part</span>
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
                disabled={mvpCount === 0 || !!submittedAt}
                onClick={handleSubmitR3Mvp}
              >
                {submittedAt ? "ROUND 3 NEW MVP SUBMITTED ✓" : "SUBMIT ROUND 3 NEW MVP →"}
              </button>
            </div>
          </Panel>
        </div>
      </>
    )}

    <div className="guide-alert mt-4">
      Product Round 3 flow: <b>1. Keep Consultant or Remove for Re-Bid (can return if needed)</b> → <b>2. Pick 1 Problem Statement in Least-Money-First Order (1 team per statement, permanently locked)</b> → <b>3. Statement Sent to Consultant + Build Another MVP With Their Crisis Solution</b>.
    </div>
  </>;
}
