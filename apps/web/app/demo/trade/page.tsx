"use client";
import {useEffect,useMemo,useState} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FINANCE_ROUTES } from "../finance/_desk/routes";
import {PageTitle,Panel,Metric,useDemoTrack,useTeamCode} from "../ui";
import {
  EmptyFilterState,
  INITIAL_LIST_FILTER,
  ListFilterBar,
  buildDealAmountRanges,
  matchesAmountFilter,
  uniqueSortedAmounts,
  type ListFilterState,
} from "../list-filter-bar";
import {useCoordination} from "../coordination-store";
import {
  getConsultingR3Lock,
  getOrMakeConsultant,
  getOrMakeProduct,
  getProductClaimedStatement,
  getProductR3Lock,
  getR3AuctionDeal,
  getR3IncumbentForConsulting,
} from "../coordination-types";
import {ProductRound3} from "./product-round3";

const parts=["Diagnosis","Three options","Recommendation","Per-pack maths","Timeline","Risks"];
const consultingPlaceholders=[
  "Diagnose the exact financial and operational impact of this Round 3 crisis on your allotted Product team's locked Problem Statement.",
  "Present three strategic options for the allotted Product team, comparing costs, risks and expected recovery.",
  "Give your single collaborative recommendation for the allotted Product team and why it outperforms the other options.",
  "Work out the updated unit economics, pricing, margins and break-even numbers after your Round 3 intervention.",
  "Lay out the week-by-week execution plan and milestones with the allotted Product team.",
  "Identify remaining risks and your contingency plan B.",
];

export default function Trade(){
  const [track] = useDemoTrack();
  const code = useTeamCode();
  const router = useRouter();
  const { state, dispatch, ready } = useCoordination();

  useEffect(() => {
    if (track === "FINANCE") router.replace(FINANCE_ROUTES.markets);
  }, [router, track]);

  const consultant = useMemo(() => getOrMakeConsultant(state, code), [state, code]);
  const baseValuation = consultant.baseValue;

  // Inherited Round 2 incumbent pair (live from R2 lock or default XP01 ⇄ XC01)
  const incumbent = useMemo(() => getR3IncumbentForConsulting(state, code), [state, code]);
  const incumbentPartner = useMemo(
    () => getOrMakeProduct(state, incumbent.productCode),
    [state, incumbent.productCode]
  );

  // Final Round 3 1:1 Lock (either accepted incumbent, returned incumbent, or open-auction lock)
  const r3Lock = useMemo(() => getConsultingR3Lock(state, code), [state, code]);
  const allottedPartner = useMemo(
    () => (r3Lock ? getOrMakeProduct(state, r3Lock.productCode) : null),
    [state, r3Lock]
  );

  // Live Problem Statement claimed by our allotted Product team in Product Round 3!
  const dispatchedStatement = useMemo(
    () => (allottedPartner ? getProductClaimedStatement(state, allottedPartner.code) : null),
    [state, allottedPartner]
  );

  // Stage 1 controls
  const [r3IncreasePct, setR3IncreasePct] = useState<number>(0);

  // Stage 2: Open Auction controls
  const [auctionMarkupPct, setAuctionMarkupPct] = useState<number>(0);
  const [auctionFilter, setAuctionFilter] = useState<ListFilterState>(INITIAL_LIST_FILTER);

  // Stage 3: Crisis solution editor
  const [active, setActive] = useState(0);
  const [values, setValues] = useState<string[]>(Array(6).fill(""));

  useEffect(() => {
    if (!ready || !r3Lock) return;
    if (r3Lock.r3SolutionParts.length === 6 && r3Lock.r3SolutionParts.some(s => s.trim().length > 0)) {
      setValues(r3Lock.r3SolutionParts);
    } else if (!r3Lock.r3SolutionSubmittedAt) {
      setValues(Array(6).fill(""));
    }
  }, [ready, r3Lock?.key, r3Lock?.r3SolutionSubmittedAt]);

  const requestedIncumbentPrice = useMemo(
    () => Math.round(baseValuation * (1 + r3IncreasePct / 100)),
    [baseValuation, r3IncreasePct]
  );

  // Auction candidates: all Product teams other than incumbent (or all if another Product team sent a live re-bid to this consultant!)
  const auctionCandidates = useMemo(() => {
    return state.productOrder
      .map(pCode => state.products[pCode]!)
      .filter(Boolean)
      .filter(p => {
        // Keep incumbent out of open auction unless they aren't our current incumbent, OR keep all non-incumbents
        if (p.code === incumbent.productCode && incumbent.status !== "REJECTED_REBIDDING") return false;
        return p.code !== incumbent.productCode;
      });
  }, [state.productOrder, state.products, incumbent.productCode, incumbent.status]);

  // Also check if ANY Product team sent a direct R3 Re-Bid proposal to this Consulting team (e.g. XP01 removed XC01 and sent re-bid to XC04!)
  const incomingRebidsForMe = useMemo(() => {
    const list: string[] = [];
    for (const deal of Object.values(state.r3AuctionDeals)) {
      if (
        deal.consultingCode === code &&
        (deal.stage === "PROPOSAL_SENT" || (deal.lockInitiatedBy === "PRODUCT" && deal.productLockAccepted && !deal.consultingLockAccepted))
      ) {
        if (!getProductR3Lock(state, deal.productCode)) {
          list.push(deal.productCode);
        }
      }
    }
    return list;
  }, [state, code]);

  // Merge any live re-bidder (even XP01 if logged in as XC04!) into auction candidates
  const allAuctionCandidates = useMemo(() => {
    const map = new Map(auctionCandidates.map(c => [c.code, c]));
    for (const pCode of incomingRebidsForMe) {
      if (!map.has(pCode)) {
        map.set(pCode, getOrMakeProduct(state, pCode));
      }
    }
    return Array.from(map.values());
  }, [auctionCandidates, incomingRebidsForMe, state]);

  const isAuctionActive =
    incumbent.status === "REJECTED_REBIDDING" ||
    (incomingRebidsForMe.length > 0 && !r3Lock && incumbent.consultingCode !== "XC01");

  const auctionWaitingLockCode = useMemo(() => {
    for (const c of allAuctionCandidates) {
      const d = getR3AuctionDeal(state, c.code, code);
      if (d.lockInitiatedBy === "CONSULTING" && d.consultingLockAccepted && !d.productLockAccepted) {
        return c.code;
      }
    }
    return null;
  }, [allAuctionCandidates, state, code]);

  const isAuctionLockedOrPending = r3Lock !== null || auctionWaitingLockCode !== null;

  const auctionTeamOptions = useMemo(
    () =>
      allAuctionCandidates.map(c => {
        const d = getR3AuctionDeal(state, c.code, code);
        const price = d.pendingPrice ?? d.currentPrice;
        const badge =
          d.lockInitiatedBy === "PRODUCT" && d.productLockAccepted && !d.consultingLockAccepted
            ? " [LOCK REQ]"
            : d.stage === "PROPOSAL_SENT"
              ? " [RE-BID]"
              : "";
        return { code: c.code, label: `${c.code} · ${c.company} ($${price.toLocaleString()})${badge}` };
      }),
    [allAuctionCandidates, state, code]
  );

  const exactAuctionAmounts = useMemo(
    () =>
      uniqueSortedAmounts(
        allAuctionCandidates.map(c => {
          const d = getR3AuctionDeal(state, c.code, code);
          return d.pendingPrice ?? d.currentPrice;
        })
      ),
    [allAuctionCandidates, state, code]
  );

  const filteredAuctionCandidates = useMemo(() => {
    const list = allAuctionCandidates.filter(cand => {
      if (auctionFilter.teamCode !== "ALL" && cand.code !== auctionFilter.teamCode) return false;
      const d = getR3AuctionDeal(state, cand.code, code);
      const price = d.pendingPrice ?? d.currentPrice;
      return matchesAmountFilter(price, auctionFilter);
    });
    if (auctionFilter.sortBy === "AMOUNT_DESC") {
      return [...list].sort((a, b) => {
        const da = getR3AuctionDeal(state, a.code, code);
        const db = getR3AuctionDeal(state, b.code, code);
        return (db.pendingPrice ?? db.currentPrice) - (da.pendingPrice ?? da.currentPrice);
      });
    }
    if (auctionFilter.sortBy === "AMOUNT_ASC") {
      return [...list].sort((a, b) => {
        const da = getR3AuctionDeal(state, a.code, code);
        const db = getR3AuctionDeal(state, b.code, code);
        return (da.pendingPrice ?? da.currentPrice) - (db.pendingPrice ?? db.currentPrice);
      });
    }
    if (auctionFilter.sortBy === "CODE_ASC") {
      return [...list].sort((a, b) => a.code.localeCompare(b.code));
    }
    // Bubble live incoming re-bids / locks to top
    return [...list].sort((a, b) => {
      const score = (pCode: string) => {
        if (r3Lock?.productCode === pCode) return 5;
        if (auctionWaitingLockCode === pCode) return 4;
        const d = getR3AuctionDeal(state, pCode, code);
        if (d.stage === "PROPOSAL_SENT" || d.stage === "COUNTER_DEMANDED" || d.stage === "DEAL_AGREED_UNLOCKED") return 3;
        if (d.lockInitiatedBy === "PRODUCT" && d.productLockAccepted) return 2;
        return 1;
      };
      return score(b.code) - score(a.code);
    });
  }, [allAuctionCandidates, state, code, auctionFilter, r3Lock, auctionWaitingLockCode]);

  const activeAuctionCode = r3Lock?.productCode ?? auctionWaitingLockCode;
  const isAuctionActiveHidden =
    activeAuctionCode !== null && !filteredAuctionCandidates.some(c => c.code === activeAuctionCode);

  const allottedDealPrice = r3Lock
    ? r3Lock.finalPrice
    : incumbent.status === "CONSULTANT_ASKED"
      ? incumbent.requestedPrice
      : requestedIncumbentPrice;

  const submittedAt = r3Lock?.r3SolutionSubmittedAt ?? null;
  const count = useMemo(
    () => values.reduce((n, v) => n + v.trim().split(/\s+/).filter(Boolean).length, 0),
    [values]
  );

  // Is our allotted partner XP01 (live Product user) who hasn't picked their PS yet?
  const waitingForLiveProductStatement =
    !!allottedPartner && allottedPartner.code === "XP01" && !dispatchedStatement;

  // Resolve active crisis to display once allotted & statement ready (or NPC fallback)
  const activeCrisis = useMemo(() => {
    if (!allottedPartner) return null;
    if (dispatchedStatement) {
      return {
        badge: `DISPATCHED ${dispatchedStatement.id} · ${dispatchedStatement.sector}`,
        category: `ROUND 3 PROBLEM STATEMENT ${dispatchedStatement.id} (LOCKED BY ${allottedPartner.code})`,
        title: dispatchedStatement.title,
        body: `${dispatchedStatement.brief} Crisis Twist: ${dispatchedStatement.crisisTwist}`,
        baseline: `Locked exclusively by ${allottedPartner.code} (${allottedPartner.company}) in least-money draft order and dispatched live to Team ${code}.`,
      };
    }
    return {
      badge: allottedPartner.topic,
      category: allottedPartner.r3FallbackCrisisCategory,
      title: allottedPartner.r3FallbackCrisisTitle,
      body: allottedPartner.r3FallbackCrisisBody,
      baseline: allottedPartner.r3FallbackBaseline,
    };
  }, [allottedPartner, dispatchedStatement, code]);

  const handleSaveR3Draft = (nextValues: string[]) => {
    setValues(nextValues);
    if (r3Lock && !submittedAt) {
      dispatch({
        type: "R3_CONSULTING_SAVE_SOLUTION",
        productCode: r3Lock.productCode,
        consultingCode: code,
        parts: nextValues,
      });
    }
  };

  const handleSubmit = () => {
    if (!r3Lock || submittedAt || count === 0) return;
    dispatch({
      type: "R3_CONSULTING_SUBMIT_SOLUTION",
      productCode: r3Lock.productCode,
      consultingCode: code,
      parts: values,
    });
  };

  if (track === "PRODUCT") {
    return <ProductRound3 />;
  }

  if (track === "FINANCE") {
    return <Link className="guide-btn" href={FINANCE_ROUTES.markets}>Open trading desk →</Link>;
  }

  const isIncumbentNpc = incumbentPartner.code !== "XP01";

  return <>
    <PageTitle
      eyebrow={`ROUND 3 / LIVE PRICE INCREASE, AUCTION & DISPATCHED CRISIS · ${code}`}
      title="Ask for a Round 3 price increase or re-enter the auction."
      sub="Live end-to-end Round 3 coordination: ask your Round 2 Product partner for a price increase (or stay on base price). Their live Accept or Remove-for-Rebid decision updates here instantaneously. Once allotted 1:1, the Problem Statement they lock in least-money order dispatches straight to you—and your submitted solution streams live into their New Round 3 MVP."
    />

    <div className="guide-grid three">
      <Metric
        label="ROUND 2 PARTNER & BASE"
        value={`$${baseValuation.toLocaleString()}`}
        delta={`R2 PARTNER: ${incumbentPartner.code} (${incumbentPartner.company})`}
      />
      <Metric
        label="ROUND 3 DEAL PRICE"
        value={`$${allottedDealPrice.toLocaleString()}`}
        delta={
          r3Lock
            ? `LOCKED WITH ${r3Lock.productCode} · SETTLED AFTER ROUND 3`
            : isAuctionActive
              ? "UNLOCKED · NEGOTIATING IN OPEN AUCTION"
              : incumbent.status === "CONSULTANT_ASKED"
                ? `SENT +${incumbent.requestedPct}% TO ${incumbentPartner.code} · AWAITING REPLY`
                : `BASE $${baseValuation.toLocaleString()} OR +${r3IncreasePct}% ASK`
        }
      />
      <Metric
        label="ROUND 3 ALLOTMENT STATUS"
        value={
          r3Lock
            ? `ALLOTTED · ${r3Lock.productCode}`
            : isAuctionActive
              ? "UNLOCKED · IN AUCTION"
              : incumbent.status === "CONSULTANT_ASKED"
                ? `WAITING ON ${incumbentPartner.code}…`
                : `PAIRED WITH ${incumbentPartner.code}`
        }
        delta={
          r3Lock
            ? dispatchedStatement
              ? `RECEIVED ${dispatchedStatement.id} LIVE FROM ${r3Lock.productCode} ✓`
              : waitingForLiveProductStatement
                ? `AWAITING ${r3Lock.productCode} TO PICK PROBLEM STATEMENT`
                : `${code} ⇄ ${r3Lock.productCode} · SOLVING R3 CRISIS`
            : isAuctionActive
              ? `${incumbentPartner.code} OPENED RE-BID · LOCK NEW PARTNER`
              : "SEND BASE PRICE OR INCREASE TO START R3"
        }
      />
    </div>

    <div className="guide-grid two mt-4">
      {/* PANEL 1: Ask Current Round 2 Partner for a Round 3 Price Increase */}
      <Panel
        title={`1. Ask ${incumbentPartner.code} (${incumbentPartner.company}) for a Round 3 price increase`}
        tag={
          r3Lock && r3Lock.productCode === incumbentPartner.code
            ? r3Lock.source === "RETURNED_TO_INCUMBENT"
              ? `RETURNED & LOCKED · ${incumbentPartner.code}`
              : `ACCEPTED · LOCKED FOR ROUND 3`
            : incumbent.status === "REJECTED_REBIDDING"
              ? "REMOVED FOR RE-BID · TEAM UNLOCKED"
              : incumbent.status === "CONSULTANT_ASKED"
                ? `SENT TO ${incumbentPartner.code} · AWAITING PRODUCT`
                : `R2 PARTNER · ${incumbentPartner.code}`
        }
      >
        <p className="guide-muted">
          You enter Round 3 paired with <b>{incumbentPartner.code} · {incumbentPartner.company} ({incumbentPartner.ticker})</b> starting from your consultancy base price of <b>${baseValuation.toLocaleString()}</b>. Stay at base price (0%) or ask for an increase—<b>{incumbentPartner.code}</b> receives it live on their Round 3 page and chooses whether to accept or remove you for re-bid.
        </p>

        <label className="guide-label">SELECT ROUND 3 PRICE (BASE PRICE OR INCREASE %) FOR {incumbentPartner.code}</label>
        <div className="guide-tabs">
          {[0, 10, 15, 20, 25, 40].map(pct => (
            <button
              key={pct}
              type="button"
              disabled={incumbent.status !== "AWAITING_CONSULTANT_ASK" || !!r3Lock}
              className={r3IncreasePct === pct ? "active" : ""}
              onClick={() => setR3IncreasePct(pct)}
            >
              {pct === 0
                ? `BASE (0% · $${baseValuation.toLocaleString()})`
                : `+${pct}% ($${Math.round(baseValuation * (1 + pct / 100)).toLocaleString()})`}
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
              disabled={incumbent.status !== "AWAITING_CONSULTANT_ASK" || !!r3Lock}
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

        {incumbent.status === "AWAITING_CONSULTANT_ASK" && !r3Lock && (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="guide-btn"
                onClick={() =>
                  dispatch({
                    type: "R3_CONSULTING_ASK_INCUMBENT",
                    productCode: incumbentPartner.code,
                    consultingCode: code,
                    increasePct: r3IncreasePct,
                  })
                }
              >
                {r3IncreasePct === 0
                  ? `SEND BASE PRICE ($${requestedIncumbentPrice.toLocaleString()} · 0%) TO ${incumbentPartner.code} →`
                  : `ASK ${incumbentPartner.code} FOR +${r3IncreasePct}% ($${requestedIncumbentPrice.toLocaleString()}) →`}
              </button>
            </div>
            <p className="guide-muted">
              This request syncs immediately to <b>{incumbentPartner.code}&apos;s</b> Round 3 workspace. They can accept your price or remove you for re-bid.
            </p>
          </div>
        )}

        {incumbent.status === "CONSULTANT_ASKED" && !r3Lock && (
          <div className="guide-alert mt-4 space-y-2.5">
            <div>
              <b>● Round 3 price request (+{incumbent.requestedPct}% → ${incumbent.requestedPrice.toLocaleString()}) sent live to {incumbentPartner.code}!</b>
              <br />
              Waiting for Product Team <b>{incumbentPartner.code} ({incumbentPartner.company})</b> to click <b>Accept</b> or <b>Remove &amp; Re-Bid</b> in their Product Round 3 workspace.
            </div>
            {isIncumbentNpc && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="guide-btn"
                  onClick={() =>
                    dispatch({
                      type: "R3_PRODUCT_ACCEPT_INCUMBENT",
                      productCode: incumbentPartner.code,
                      consultingCode: code,
                    })
                  }
                >
                  SIMULATE {incumbentPartner.code} ACCEPT
                </button>
                <button
                  type="button"
                  className="guide-btn secondary"
                  onClick={() =>
                    dispatch({
                      type: "R3_PRODUCT_REMOVE_INCUMBENT",
                      productCode: incumbentPartner.code,
                      consultingCode: code,
                    })
                  }
                >
                  SIMULATE {incumbentPartner.code} REMOVE FOR RE-BID
                </button>
              </div>
            )}
          </div>
        )}

        {r3Lock && r3Lock.productCode === incumbentPartner.code && (
          <div className="guide-alert mt-4">
            <b>
              ✓ {incumbentPartner.code} ({incumbentPartner.company}){" "}
              {r3Lock.source === "RETURNED_TO_INCUMBENT"
                ? "RETURNED TO YOU & LOCKED"
                : `ACCEPTED your +${r3Lock.markupPct}% price`}{" "}
              ({r3Lock.lockedAt})!
            </b>
            <br />
            Your agreed Round 3 price of <b>${r3Lock.finalPrice.toLocaleString()}</b> is locked and settled after Round 3. Solve their dispatched Problem Statement crisis below.
          </div>
        )}

        {incumbent.status === "REJECTED_REBIDDING" && (!r3Lock || r3Lock.productCode !== incumbentPartner.code) && (
          <div className="guide-alert guide-warning mt-4">
            <b>✕ {incumbentPartner.code} ({incumbentPartner.company}) REMOVED YOU FOR RE-BID ({incumbent.decidedAt}).</b>
            <br />
            <b>Team {code} is now UNLOCKED in the Round 3 Open Auction!</b> Negotiate and lock 1-to-1 with an interested Product team in Panel 2 on the right (note: {incumbentPartner.code} can still choose to get back with you until you lock with someone else).
          </div>
        )}
      </Panel>

      {/* PANEL 2: Round 3 Open Auction */}
      <Panel
        title="2. Round 3 open auction (when unlocked)"
        tag={
          r3Lock && r3Lock.productCode === incumbentPartner.code
            ? `BYPASSED · RETAINED BY ${incumbentPartner.code}`
            : r3Lock
              ? `ALLOTTED IN AUCTION · ${r3Lock.productCode}`
              : isAuctionActive
                ? "AUCTION LIVE · LOCK STRICTLY 1:1"
                : "STANDBY · OPENS IF R2 PARTNER REMOVES YOU"
        }
      >
        {!isAuctionActive && !(r3Lock && r3Lock.productCode !== incumbentPartner.code) ? (
          <div className="guide-alert">
            {r3Lock ? (
              <>
                <b>Auction Bypassed — Retained by {incumbentPartner.code} ({incumbentPartner.company})</b>
                <br />
                Because {incumbentPartner.code} locked with you for Round 3 (${r3Lock.finalPrice.toLocaleString()}, settled after Round 3), your team stayed paired 1:1 and bypassed the open auction.
              </>
            ) : (
              <>
                <b>Auction on Standby</b>
                <br />
                You are currently paired with your Round 2 partner (<b>{incumbentPartner.code} · {incumbentPartner.company}</b>). If <b>{incumbentPartner.code} removes you for re-bid</b> in their Product Round 3 workspace, your consultancy immediately unlocks and enters this live Round 3 auction.
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

            <ListFilterBar
              value={auctionFilter}
              onChange={setAuctionFilter}
              teamOptions={auctionTeamOptions}
              teamLabel="PRODUCT TEAM CODE"
              allTeamsLabel="All Auction Teams"
              amountLabel="AUCTION OFFER AMOUNT"
              amountRanges={buildDealAmountRanges()}
              exactAmounts={exactAuctionAmounts}
              totalCount={allAuctionCandidates.length}
              filteredCount={filteredAuctionCandidates.length}
              itemNoun="auction teams"
            />

            {isAuctionActiveHidden && activeAuctionCode && (
              <div className="guide-alert mb-3 flex flex-wrap items-center justify-between gap-2">
                <span>
                  <b>{r3Lock ? `🔒 Allotted 1:1 with ${activeAuctionCode}` : `● Lock request pending with ${activeAuctionCode}`}</b> — hidden by your current filter.
                </span>
                <button
                  type="button"
                  className="guide-btn secondary guide-filter-reset"
                  onClick={() => setAuctionFilter({ ...INITIAL_LIST_FILTER, teamCode: activeAuctionCode })}
                >
                  SHOW {activeAuctionCode}
                </button>
              </div>
            )}

            <div className="guide-scroll-box space-y-3">
              {filteredAuctionCandidates.length === 0 ? (
                <EmptyFilterState noun="auction teams" onReset={() => setAuctionFilter(INITIAL_LIST_FILTER)} />
              ) : (
                filteredAuctionCandidates.map(cand => {
                  const d = getR3AuctionDeal(state, cand.code, code);
                  const productLockedElsewhere = getProductR3Lock(state, cand.code);
                  const isLockedByOtherConsultant =
                    productLockedElsewhere !== null && productLockedElsewhere.consultingCode !== code;
                  const isThisLocked = r3Lock?.productCode === cand.code;
                  const isThisWaitingLock = auctionWaitingLockCode === cand.code;
                  const isClosedByOther =
                    (isAuctionLockedOrPending && !isThisLocked && !isThisWaitingLock) || isLockedByOtherConsultant;
                  const isProductLockIncoming =
                    d.lockInitiatedBy === "PRODUCT" && d.productLockAccepted && !d.consultingLockAccepted;
                  const pushedPreview = Math.round(d.initialOffer * (1 + auctionMarkupPct / 100));
                  const isSimulatedNpc = cand.code !== "XP01";

                  return (
                    <div
                      key={cand.code}
                      className="border border-[#294832] p-3"
                      style={{ opacity: isClosedByOther ? 0.42 : 1 }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className={`guide-chip ${isThisLocked || isProductLockIncoming || d.stage === "PROPOSAL_SENT" ? "active" : ""}`}>
                            {cand.code} · {cand.ticker}
                          </span>
                          <b className="ml-2 text-sm">{cand.company}</b>
                        </div>
                        <span className="guide-status">
                          {isThisLocked
                            ? `🔒 ALLOTTED & LOCKED 1:1 AT $${r3Lock!.finalPrice.toLocaleString()}`
                            : isLockedByOtherConsultant
                              ? `CLOSED · ${cand.code} LOCKED WITH ${productLockedElsewhere!.consultingCode}`
                              : isThisWaitingLock
                                ? "● LOCK REQUEST SENT · AWAITING PRODUCT TEAM…"
                                : isClosedByOther
                                  ? "CLOSED · 1:1 ALLOTTED"
                                  : isProductLockIncoming
                                    ? `⚡ ${cand.code} SENT LOCK REQUEST AT $${d.currentPrice.toLocaleString()}!`
                                    : d.stage === "PROPOSAL_SENT"
                                      ? `⚡ LIVE RE-BID FROM ${cand.code} AT $${d.currentPrice.toLocaleString()}`
                                      : d.stage === "COUNTER_DEMANDED"
                                        ? `● PUSHED +${d.pendingMarkupPct}% ($${d.pendingPrice?.toLocaleString()}) · AWAITING ${cand.code}…`
                                        : d.stage === "DEAL_AGREED_UNLOCKED"
                                          ? `✓ DEAL AGREED AT $${d.currentPrice.toLocaleString()} · READY TO LOCK`
                                          : `AUCTION OFFER: $${d.initialOffer.toLocaleString()} · NOT LOCKED`}
                        </span>
                      </div>

                      <p className="guide-muted mt-1">
                        <b>Topic:</b> {cand.topic}
                      </p>

                      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] font-mono">
                        <div className="border border-[#294832] p-1.5">
                          <span className="block text-[#81a4d1]">R3 DEAL PRICE</span>
                          <b className="mt-0.5 block text-[#f0f7ff]">
                            ${(d.pendingPrice ?? d.currentPrice).toLocaleString()}
                          </b>
                        </div>
                        <div className="border border-[#294832] p-1.5">
                          <span className="block text-[#81a4d1]">CONSULTING ({code})</span>
                          <b className="mt-0.5 block text-[#f0f7ff]">{d.consultingLockAccepted || isThisLocked ? "✓ LOCK ACCEPTED" : "NOT LOCKED"}</b>
                        </div>
                        <div className="border border-[#294832] p-1.5">
                          <span className="block text-[#81a4d1]">PRODUCT ({cand.code})</span>
                          <b className="mt-0.5 block text-[#f0f7ff]">
                            {isThisLocked
                              ? "✓ LOCK ACCEPTED"
                              : isProductLockIncoming
                                ? "⚡ SENT LOCK REQUEST"
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
                                className="guide-btn secondary"
                                onClick={() =>
                                  dispatch({
                                    type: "R3_CONSULTING_PUSH_AUCTION_DEMAND",
                                    productCode: cand.code,
                                    consultingCode: code,
                                    markupPct: auctionMarkupPct,
                                  })
                                }
                              >
                                PUSH +{auctionMarkupPct}% (${pushedPreview.toLocaleString()}) →
                              </button>

                              {d.stage === "COUNTER_DEMANDED" && isSimulatedNpc && (
                                <button
                                  type="button"
                                  className="guide-btn secondary"
                                  onClick={() =>
                                    dispatch({
                                      type: "R3_PRODUCT_ACCEPT_AUCTION_DEMAND",
                                      productCode: cand.code,
                                      consultingCode: code,
                                    })
                                  }
                                >
                                  SIMULATE {cand.code} ACCEPT
                                </button>
                              )}

                              {isProductLockIncoming ? (
                                <button
                                  type="button"
                                  className="guide-btn"
                                  onClick={() =>
                                    dispatch({
                                      type: "R3_ACCEPT_AUCTION_LOCK",
                                      productCode: cand.code,
                                      consultingCode: code,
                                      acceptedBy: "CONSULTING",
                                    })
                                  }
                                >
                                  ACCEPT LOCK REQUEST FROM {cand.code} (${d.currentPrice.toLocaleString()}) 🔒
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={d.stage === "COUNTER_DEMANDED"}
                                  className="guide-btn"
                                  onClick={() =>
                                    dispatch({
                                      type: "R3_SEND_AUCTION_LOCK",
                                      productCode: cand.code,
                                      consultingCode: code,
                                      initiatedBy: "CONSULTING",
                                    })
                                  }
                                >
                                  SEND LOCK REQUEST TO {cand.code} (${d.currentPrice.toLocaleString()}) →
                                </button>
                              )}
                            </>
                          )}

                          {isThisWaitingLock && (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="guide-status">
                                ● WAITING FOR {cand.code} TO ACCEPT LOCK REQUEST…
                              </span>
                              {isSimulatedNpc && (
                                <button
                                  type="button"
                                  className="guide-btn secondary"
                                  onClick={() =>
                                    dispatch({
                                      type: "R3_ACCEPT_AUCTION_LOCK",
                                      productCode: cand.code,
                                      consultingCode: code,
                                      acceptedBy: "PRODUCT",
                                    })
                                  }
                                >
                                  SIMULATE {cand.code} ACCEPT LOCK
                                </button>
                              )}
                            </div>
                          )}

                          {isThisLocked && (
                            <span className="guide-status">
                              🔒 ALLOTTED 1:1 WITH {cand.code} AT ${r3Lock!.finalPrice.toLocaleString()} (SETTLED AFTER R3)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </Panel>
    </div>

    {/* PANEL 3: Allotted Product Team's Dispatched Problem Statement Crisis & Collaborative Solution Editor */}
    {!allottedPartner || !r3Lock ? (
      <div className="mt-4">
        <Panel title="3. Round 3 crisis for your allotted product team" tag="LOCKED UNTIL ROUND 3 ALLOTMENT IS SORTED">
          <div className="guide-alert guide-warning">
            <b>
              {incumbent.status === "AWAITING_CONSULTANT_ASK"
                ? `Step 1 Required: Send Your Round 3 Base Price or Increase Request to ${incumbentPartner.code} Above`
                : incumbent.status === "CONSULTANT_ASKED"
                  ? `Waiting for ${incumbentPartner.code} to Accept or Remove for Re-Bid in Their Product Round 3 Tab…`
                  : `You Are Unlocked in the Round 3 Auction — Lock 1-to-1 With a Product Team in Panel 2`}
            </b>
            <br />
            Once your Round 3 allotment is locked 1:1, the exact Problem Statement that your allotted Product team picks in the least-money draft dispatches live into this panel for you to solve!
          </div>
        </Panel>
      </div>
    ) : waitingForLiveProductStatement ? (
      <div className="mt-4">
        <Panel
          title={`3. Waiting for ${allottedPartner.code} (${allottedPartner.company}) to lock their Problem Statement`}
          tag={`ALLOTTED 1:1 · ${code} ⇄ ${allottedPartner.code}`}
        >
          <div className="guide-alert guide-warning">
            <b>⏳ Allotted 1:1 with {allottedPartner.code} ({allottedPartner.company}) at ${r3Lock.finalPrice.toLocaleString()} — Waiting on Least-Money Draft Pick…</b>
            <br />
            As soon as <b>{allottedPartner.code}</b> picks &amp; permanently locks a Problem Statement in their Product Round 3 pool, that exact statement and its crisis twist will dispatch live here and unlock your Round 3 Crisis Solution editor!
          </div>
        </Panel>
      </div>
    ) : (
      <>
        <div className="guide-grid two mt-4">
          <Panel
            title={`3. Round 3 crisis for allotted Product team: ${allottedPartner.company}`}
            tag={`${allottedPartner.code} · ${dispatchedStatement ? dispatchedStatement.id : allottedPartner.ticker} · DISPATCHED TO ${code}`}
          >
            <span className="guide-chip active">{activeCrisis!.badge}</span>
            <h2 className="mt-3 text-xl font-semibold">
              {allottedPartner.company} <span className="font-mono text-[#63a8ff]">{allottedPartner.ticker}</span>
            </h2>
            <div className="guide-alert guide-warning mt-3">
              <b>{activeCrisis!.category}</b>
              <br />
              <b>{activeCrisis!.title}:</b> {activeCrisis!.body}
            </div>
            <p className="guide-muted mt-3">{activeCrisis!.baseline}</p>
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
                  {r3Lock.source === "INCUMBENT_ACCEPTED"
                    ? "ACCEPTED R3 INCREASE ✓"
                    : r3Lock.source === "RETURNED_TO_INCUMBENT"
                      ? "RETURNED TO YOU ✓"
                      : "LOCKED VIA R3 AUCTION ✓"}
                </span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>ROUND 3 DEAL (PAID AFTER R3)</small>
                <b className="text-lg">${r3Lock.finalPrice.toLocaleString()}</b>
                <span>LOCKED · CANNOT UPDATE</span>
              </div>
              <div className="guide-metric">
                <small>LIVE DELIVERY STATUS</small>
                <b className="text-lg">{submittedAt ? "DELIVERED ✓" : "SOLVING"}</b>
                <span>
                  {allottedPartner.r3MvpSubmittedAt
                    ? `${allottedPartner.code} SUBMITTED NEW MVP ✓`
                    : submittedAt
                      ? `SENT TO ${allottedPartner.code} (${submittedAt})`
                      : "WILL STREAM TO PRODUCT MVP"}
                </span>
              </div>
            </div>
            <p className="guide-muted mt-3">
              Submitting your 6-part Round 3 Crisis Solution below delivers it immediately into <b>{allottedPartner.code}&apos;s</b> New Round 3 MVP builder. Your agreed fee of <b>${r3Lock.finalPrice.toLocaleString()}</b> is settled after Round 3.
            </p>
          </Panel>
        </div>

        <div className="mt-4">
          <Panel
            title={`Round 3 crisis solution editor for ${allottedPartner.company} (${dispatchedStatement ? dispatchedStatement.id : allottedPartner.ticker})`}
            tag="6 PARTS · 500 WORDS TOTAL · DELIVERS LIVE TO PRODUCT TEAM"
          >
            {submittedAt && (
              <div className="guide-alert mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <b>✓ Round 3 crisis solution permanently submitted ({code} ⇄ {allottedPartner.code})</b> · Finalized at {submittedAt} ({count} words) and delivered live to <b>{allottedPartner.code}&apos;s</b> New Round 3 MVP editor. Fee (${r3Lock.finalPrice.toLocaleString()}) queued for settlement.
                </div>
                <span className="guide-chip active">DELIVERED LIVE ✓</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="guide-muted">
                Solving {allottedPartner.company}&apos;s Round 3 crisis ({activeCrisis!.category}) · Submitting streams your solution straight to {allottedPartner.code}.
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
            <label className="guide-label">{parts[active]!.toUpperCase()}</label>
            <textarea
              className="guide-textarea"
              readOnly={!!submittedAt}
              value={values[active]}
              onChange={e => {
                if (submittedAt) return;
                const next = values.map((x, i) => (i === active ? e.target.value : x));
                const words = next.reduce((sum, item) => sum + item.trim().split(/\s+/).filter(Boolean).length, 0);
                if (words <= 500) setValues(next);
              }}
              onBlur={() => handleSaveR3Draft(values)}
              placeholder={consultingPlaceholders[active]}
            />
            <div className="mt-3 flex justify-between">
              <span className="guide-muted">{values[active]!.trim().split(/\s+/).filter(Boolean).length} words in this part</span>
              <span className="guide-status">{submittedAt ? `● DELIVERED & LOCKED AT ${submittedAt}` : "● DRAFT SYNCING ON BLUR / SUBMIT"}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#294832] pt-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  className="guide-btn secondary"
                  disabled={active === 0}
                  onClick={() => {
                    handleSaveR3Draft(values);
                    setActive(v => v - 1);
                  }}
                >
                  ← PREVIOUS
                </button>
                <button
                  type="button"
                  className="guide-btn secondary"
                  disabled={active === 5}
                  onClick={() => {
                    handleSaveR3Draft(values);
                    setActive(v => v + 1);
                  }}
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
                {submittedAt ? "ROUND 3 SOLUTION DELIVERED ✓" : "SUBMIT & DELIVER ROUND 3 SOLUTION →"}
              </button>
            </div>
          </Panel>
        </div>
      </>
    )}

    <div className="guide-alert mt-4">
      End-to-end Round 3 flow: <b>1. Send Price Increase or Base Price to R2 Partner</b> → <b>2. Live Accept or Unlock into Open Auction</b> → <b>3. Receive Product&apos;s Locked Problem Statement Live</b> → <b>4. Deliver Crisis Solution to Product&apos;s New MVP</b>.
    </div>
  </>;
}
