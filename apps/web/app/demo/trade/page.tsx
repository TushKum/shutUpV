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
  buildEquityRanges,
  matchesAmountFilter,
  uniqueSortedAmounts,
  type ListFilterState,
} from "../list-filter-bar";
import {useCoordination} from "../coordination-store";
import {
  calcMoneyFromShares,
  equityPctToShares,
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
  const baseEquityPct = consultant.baseEquityPct;

  // Inherited Round 2 incumbent pair (live from R2 lock or default XP01 ⇄ XC01)
  const incumbent = useMemo(() => getR3IncumbentForConsulting(state, code), [state, code]);
  const incumbentPartner = useMemo(
    () => getOrMakeProduct(state, incumbent.productCode),
    [state, incumbent.productCode]
  );

  const baseShares = useMemo(
    () => equityPctToShares(baseEquityPct, incumbentPartner.totalShares),
    [baseEquityPct, incumbentPartner.totalShares]
  );
  const baseCalcValue = useMemo(
    () => calcMoneyFromShares(baseShares, incumbentPartner.sharePrice),
    [baseShares, incumbentPartner.sharePrice]
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

  // Stage 1 controls: ask for extra equity % over base equity (0% = stay on base equity)
  const [r3ExtraEquityPct, setR3ExtraEquityPct] = useState<number>(0);

  // Stage 2: Open Auction controls
  const [auctionExtraEquityPct, setAuctionExtraEquityPct] = useState<number>(0);
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

  const requestedIncumbentEquityPct = useMemo(
    () => Number((baseEquityPct + r3ExtraEquityPct).toFixed(2)),
    [baseEquityPct, r3ExtraEquityPct]
  );
  const requestedIncumbentShares = useMemo(
    () => equityPctToShares(requestedIncumbentEquityPct, incumbentPartner.totalShares),
    [requestedIncumbentEquityPct, incumbentPartner.totalShares]
  );
  const requestedIncumbentPrice = useMemo(
    () => calcMoneyFromShares(requestedIncumbentShares, incumbentPartner.sharePrice),
    [requestedIncumbentShares, incumbentPartner.sharePrice]
  );

  // Auction candidates: all Product teams other than incumbent
  const auctionCandidates = useMemo(() => {
    return state.productOrder
      .map(pCode => state.products[pCode]!)
      .filter(Boolean)
      .filter(p => {
        if (p.code === incumbent.productCode && incumbent.status !== "REJECTED_REBIDDING") return false;
        return p.code !== incumbent.productCode;
      });
  }, [state.productOrder, state.products, incumbent.productCode, incumbent.status]);

  // Also check if ANY Product team sent a direct R3 Re-Bid proposal to this Consulting team
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

  // Merge any live re-bidder into auction candidates
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
        const eq = d.pendingEquityPct ?? d.currentEquityPct;
        const price = d.pendingPrice ?? d.currentPrice;
        const badge =
          d.lockInitiatedBy === "PRODUCT" && d.productLockAccepted && !d.consultingLockAccepted
            ? " [LOCK REQ]"
            : d.stage === "PROPOSAL_SENT"
              ? " [RE-BID]"
              : "";
        return {
          code: c.code,
          label: `${c.code} · ${c.company} (${eq}% · calc $${price.toLocaleString()})${badge}`,
        };
      }),
    [allAuctionCandidates, state, code]
  );

  const exactAuctionEquities = useMemo(
    () =>
      uniqueSortedAmounts(
        allAuctionCandidates.map(c => {
          const d = getR3AuctionDeal(state, c.code, code);
          return d.pendingEquityPct ?? d.currentEquityPct;
        })
      ),
    [allAuctionCandidates, state, code]
  );

  const filteredAuctionCandidates = useMemo(() => {
    const list = allAuctionCandidates.filter(cand => {
      if (auctionFilter.teamCode !== "ALL" && cand.code !== auctionFilter.teamCode) return false;
      const d = getR3AuctionDeal(state, cand.code, code);
      const eq = d.pendingEquityPct ?? d.currentEquityPct;
      return matchesAmountFilter(eq, auctionFilter);
    });
    if (auctionFilter.sortBy === "AMOUNT_DESC") {
      return [...list].sort((a, b) => {
        const da = getR3AuctionDeal(state, a.code, code);
        const db = getR3AuctionDeal(state, b.code, code);
        return (db.pendingEquityPct ?? db.currentEquityPct) - (da.pendingEquityPct ?? da.currentEquityPct);
      });
    }
    if (auctionFilter.sortBy === "AMOUNT_ASC") {
      return [...list].sort((a, b) => {
        const da = getR3AuctionDeal(state, a.code, code);
        const db = getR3AuctionDeal(state, b.code, code);
        return (da.pendingEquityPct ?? da.currentEquityPct) - (db.pendingEquityPct ?? db.currentEquityPct);
      });
    }
    if (auctionFilter.sortBy === "VALUE_DESC") {
      return [...list].sort((a, b) => {
        const da = getR3AuctionDeal(state, a.code, code);
        const db = getR3AuctionDeal(state, b.code, code);
        return (db.pendingPrice ?? db.currentPrice) - (da.pendingPrice ?? da.currentPrice);
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

  const allottedDealEquityPct = r3Lock
    ? r3Lock.finalEquityPct
    : incumbent.status === "CONSULTANT_ASKED"
      ? incumbent.requestedEquityPct
      : requestedIncumbentEquityPct;

  const allottedDealShares = r3Lock
    ? r3Lock.finalShares
    : incumbent.status === "CONSULTANT_ASKED"
      ? incumbent.requestedShares
      : requestedIncumbentShares;

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
      eyebrow={`ROUND 3 / LIVE EQUITY INCREASE, AUCTION & DISPATCHED CRISIS · ${code}`}
      title="Ask for more shares & equity in Round 3 or re-enter the equity auction."
      sub="Live end-to-end Round 3 coordination in Shares & Equity %: ask your Round 2 Product partner for additional equity (or stay on base equity)—dollar value is calculated automatically from shares × share price. Their live Accept or Remove-for-Rebid decision updates here instantaneously. Once allotted 1:1, the Problem Statement they lock in least-money order dispatches straight to you."
    />

    <div className="guide-grid three">
      <Metric
        label="ROUND 2 PARTNER & BASE EQUITY"
        value={`${baseEquityPct}% · ${baseShares.toLocaleString()} sh`}
        delta={`R2 PARTNER: ${incumbentPartner.code} (${incumbentPartner.company}) · CALC $${baseCalcValue.toLocaleString()}`}
      />
      <Metric
        label="ROUND 3 EQUITY DEAL"
        value={`${allottedDealEquityPct}% · ${allottedDealShares.toLocaleString()} sh`}
        delta={
          r3Lock
            ? `CALC $${allottedDealPrice.toLocaleString()} · LOCKED WITH ${r3Lock.productCode}`
            : isAuctionActive
              ? "UNLOCKED · NEGOTIATING SHARES IN OPEN AUCTION"
              : incumbent.status === "CONSULTANT_ASKED"
                ? `SENT +${incumbent.requestedExtraPct}% (CALC $${incumbent.requestedPrice.toLocaleString()}) · AWAITING ${incumbentPartner.code}`
                : `AUTO-CALC $${allottedDealPrice.toLocaleString()} @ $${incumbentPartner.sharePrice.toFixed(2)}/sh`
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
              : "SEND BASE EQUITY OR EXTRA EQUITY ASK TO START R3"
        }
      />
    </div>

    <div className="guide-grid two mt-4">
      {/* PANEL 1: Ask Current Round 2 Partner for Extra Equity & Shares in Round 3 */}
      <Panel
        title={`1. Ask ${incumbentPartner.code} (${incumbentPartner.company}) for Round 3 equity & shares`}
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
          You enter Round 3 paired with <b>{incumbentPartner.code} · {incumbentPartner.company} ({incumbentPartner.ticker})</b> starting from your consultancy base equity of <b>{baseEquityPct}% ({baseShares.toLocaleString()} shares)</b> — auto-calculated at <b>${baseCalcValue.toLocaleString()}</b> (@ ${incumbentPartner.sharePrice.toFixed(2)}/sh). Stay at base equity (0% extra) or ask for extra equity %—<b>{incumbentPartner.code}</b> receives it live on their Round 3 page.
        </p>

        <label className="guide-label">SELECT EXTRA EQUITY % FOR {incumbentPartner.code} (0% = BASE EQUITY {baseEquityPct}%)</label>
        <div className="guide-tabs">
          {[0, 0.5, 1, 1.5, 2, 3].map(extra => {
            const totalEq = Number((baseEquityPct + extra).toFixed(2));
            const totalSh = equityPctToShares(totalEq, incumbentPartner.totalShares);
            const calcVal = calcMoneyFromShares(totalSh, incumbentPartner.sharePrice);
            return (
              <button
                key={extra}
                type="button"
                disabled={incumbent.status !== "AWAITING_CONSULTANT_ASK" || !!r3Lock}
                className={r3ExtraEquityPct === extra ? "active" : ""}
                onClick={() => setR3ExtraEquityPct(extra)}
              >
                {extra === 0
                  ? `BASE (${totalEq}% · $${calcVal.toLocaleString()})`
                  : `+${extra}% → ${totalEq}% ($${calcVal.toLocaleString()})`}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="guide-label">CUSTOM EXTRA EQUITY (% · 0% = BASE)</label>
            <input
              type="number"
              min={0}
              max={15}
              step={0.5}
              disabled={incumbent.status !== "AWAITING_CONSULTANT_ASK" || !!r3Lock}
              className="guide-input font-mono"
              value={r3ExtraEquityPct}
              onChange={e => setR3ExtraEquityPct(Math.max(0, Math.min(15, Number(e.target.value) || 0)))}
            />
          </div>
          <div>
            <label className="guide-label">TOTAL EQUITY, SHARES &amp; AUTO-CALC VALUE</label>
            <input
              type="text"
              readOnly
              className="guide-input font-mono"
              value={`${requestedIncumbentEquityPct}% (${requestedIncumbentShares.toLocaleString()} sh) · $${requestedIncumbentPrice.toLocaleString()}`}
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
                    extraEquityPct: r3ExtraEquityPct,
                  })
                }
              >
                {r3ExtraEquityPct === 0
                  ? `SEND BASE EQUITY (${requestedIncumbentEquityPct}% · ${requestedIncumbentShares.toLocaleString()} sh · $${requestedIncumbentPrice.toLocaleString()}) TO ${incumbentPartner.code} →`
                  : `ASK ${incumbentPartner.code} FOR ${requestedIncumbentEquityPct}% (+${r3ExtraEquityPct}% · ${requestedIncumbentShares.toLocaleString()} sh · $${requestedIncumbentPrice.toLocaleString()}) →`}
              </button>
            </div>
            <p className="guide-muted">
              This share &amp; equity ask syncs immediately to <b>{incumbentPartner.code}&apos;s</b> Round 3 workspace. Dollar value (${requestedIncumbentPrice.toLocaleString()}) is computed automatically from {requestedIncumbentShares.toLocaleString()} shares × ${incumbentPartner.sharePrice.toFixed(2)}/sh.
            </p>
          </div>
        )}

        {incumbent.status === "CONSULTANT_ASKED" && !r3Lock && (
          <div className="guide-alert mt-4 space-y-2.5">
            <div>
              <b>
                ● Round 3 equity request ({incumbent.requestedEquityPct}% · {incumbent.requestedShares.toLocaleString()} sh · auto-calc ${incumbent.requestedPrice.toLocaleString()}) sent live to {incumbentPartner.code}!
              </b>
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
                : r3Lock.extraEquityPct > 0
                  ? `ACCEPTED your +${r3Lock.extraEquityPct}% extra equity ask`
                  : "ACCEPTED your base equity rate"}{" "}
              ({r3Lock.lockedAt})!
            </b>
            <br />
            Your agreed Round 3 stake of <b>{r3Lock.finalEquityPct}% ({r3Lock.finalShares.toLocaleString()} shares)</b> — auto-calculated at <b>${r3Lock.finalPrice.toLocaleString()}</b> — is locked and settled after Round 3. Solve their dispatched Problem Statement crisis below.
          </div>
        )}

        {incumbent.status === "REJECTED_REBIDDING" && (!r3Lock || r3Lock.productCode !== incumbentPartner.code) && (
          <div className="guide-alert guide-warning mt-4">
            <b>✕ {incumbentPartner.code} ({incumbentPartner.company}) REMOVED YOU FOR RE-BID ({incumbent.decidedAt}).</b>
            <br />
            <b>Team {code} is now UNLOCKED in the Round 3 Open Equity Auction!</b> Negotiate shares &amp; equity 1-to-1 with an interested Product team in Panel 2 on the right (note: {incumbentPartner.code} can still choose to get back with you until you lock with someone else).
          </div>
        )}
      </Panel>

      {/* PANEL 2: Round 3 Open Equity Auction */}
      <Panel
        title="2. Round 3 open equity auction (when unlocked)"
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
                Because {incumbentPartner.code} locked with you for Round 3 ({r3Lock.finalEquityPct}% · {r3Lock.finalShares.toLocaleString()} sh · auto-calc ${r3Lock.finalPrice.toLocaleString()}, settled after Round 3), your team stayed paired 1:1 and bypassed the open auction.
              </>
            ) : (
              <>
                <b>Auction on Standby</b>
                <br />
                You are currently paired with your Round 2 partner (<b>{incumbentPartner.code} · {incumbentPartner.company}</b>). If <b>{incumbentPartner.code} removes you for re-bid</b> in their Product Round 3 workspace, your consultancy immediately unlocks and enters this live Round 3 equity auction.
              </>
            )}
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="guide-label !m-0">EXTRA EQUITY ASK OVER OFFER (0% = OFFERED EQUITY)</span>
              <div className="flex gap-1.5">
                {[0, 0.5, 1, 1.5, 2].map(extra => (
                  <button
                    key={extra}
                    type="button"
                    disabled={isAuctionLockedOrPending}
                    className={`guide-chip ${auctionExtraEquityPct === extra ? "active" : ""}`}
                    onClick={() => setAuctionExtraEquityPct(extra)}
                  >
                    {extra === 0 ? "OFFER (0%)" : `+${extra}% EQ`}
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
              valueKind="EQUITY"
              amountLabel="AUCTION OFFER EQUITY %"
              amountRanges={buildEquityRanges()}
              exactAmounts={exactAuctionEquities}
              sortOptions={[
                { value: "DEFAULT", label: "Default Order (Live First)" },
                { value: "AMOUNT_DESC", label: "Equity %: High → Low" },
                { value: "AMOUNT_ASC", label: "Equity %: Low → High" },
                { value: "VALUE_DESC", label: "Calc Value ($): High → Low" },
                { value: "CODE_ASC", label: "Team Code: A → Z" },
              ]}
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
                  const pushedEq = Number((d.initialOfferEquityPct + auctionExtraEquityPct).toFixed(2));
                  const pushedSh = equityPctToShares(pushedEq, cand.totalShares);
                  const pushedCalc = calcMoneyFromShares(pushedSh, cand.sharePrice);
                  const visibleEq = d.pendingEquityPct ?? d.currentEquityPct;
                  const visibleSh = d.pendingShares ?? d.currentShares;
                  const visibleCalc = d.pendingPrice ?? d.currentPrice;
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
                            {cand.code} · {cand.ticker} (${cand.sharePrice.toFixed(2)}/sh)
                          </span>
                          <b className="ml-2 text-sm">{cand.company}</b>
                        </div>
                        <span className="guide-status">
                          {isThisLocked
                            ? `🔒 ALLOTTED 1:1 · ${r3Lock!.finalEquityPct}% (${r3Lock!.finalShares.toLocaleString()} sh · $${r3Lock!.finalPrice.toLocaleString()})`
                            : isLockedByOtherConsultant
                              ? `CLOSED · ${cand.code} LOCKED WITH ${productLockedElsewhere!.consultingCode}`
                              : isThisWaitingLock
                                ? "● LOCK REQUEST SENT · AWAITING PRODUCT TEAM…"
                                : isClosedByOther
                                  ? "CLOSED · 1:1 ALLOTTED"
                                  : isProductLockIncoming
                                    ? `⚡ ${cand.code} SENT LOCK REQUEST AT ${d.currentEquityPct}% ($${d.currentPrice.toLocaleString()})!`
                                    : d.stage === "PROPOSAL_SENT"
                                      ? `⚡ LIVE RE-BID FROM ${cand.code} AT ${d.currentEquityPct}% ($${d.currentPrice.toLocaleString()})`
                                      : d.stage === "COUNTER_DEMANDED"
                                        ? `● ASKED +${d.pendingExtraEquityPct}% → ${d.pendingEquityPct}% ($${d.pendingPrice?.toLocaleString()}) · AWAITING ${cand.code}…`
                                        : d.stage === "DEAL_AGREED_UNLOCKED"
                                          ? `✓ AGREED AT ${d.currentEquityPct}% (${d.currentShares.toLocaleString()} sh) · READY TO LOCK`
                                          : `OFFER: ${d.initialOfferEquityPct}% (${equityPctToShares(d.initialOfferEquityPct, cand.totalShares).toLocaleString()} sh)`}
                        </span>
                      </div>

                      <p className="guide-muted mt-1">
                        <b>Topic:</b> {cand.topic}
                      </p>

                      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] font-mono">
                        <div className="border border-[#294832] p-1.5">
                          <span className="block text-[#81a4d1]">R3 EQUITY &amp; SHARES</span>
                          <b className="mt-0.5 block text-[#f0f7ff]">
                            {visibleEq}% ({visibleSh.toLocaleString()} sh)
                          </b>
                        </div>
                        <div className="border border-[#294832] p-1.5">
                          <span className="block text-[#81a4d1]">AUTO-CALC VALUE</span>
                          <b className="mt-0.5 block text-[#f0f7ff]">
                            ${visibleCalc.toLocaleString()}
                          </b>
                        </div>
                        <div className="border border-[#294832] p-1.5">
                          <span className="block text-[#81a4d1]">1:1 LOCK STATUS</span>
                          <b className="mt-0.5 block text-[#f0f7ff]">
                            {isThisLocked
                              ? "✓ BOTH LOCKED"
                              : isProductLockIncoming
                                ? `⚡ ${cand.code} LOCK REQ`
                                : d.consultingLockAccepted
                                  ? "● WAITING PRODUCT"
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
                                    extraEquityPct: auctionExtraEquityPct,
                                  })
                                }
                              >
                                {auctionExtraEquityPct === 0
                                  ? `ACCEPT ${pushedEq}% (${pushedSh.toLocaleString()} sh · $${pushedCalc.toLocaleString()}) →`
                                  : `ASK +${auctionExtraEquityPct}% → ${pushedEq}% (${pushedSh.toLocaleString()} sh · $${pushedCalc.toLocaleString()}) →`}
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
                                  ACCEPT LOCK FROM {cand.code} ({d.currentEquityPct}% · $${d.currentPrice.toLocaleString()}) 🔒
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
                                  SEND LOCK REQUEST TO {cand.code} ({d.currentEquityPct}% · ${d.currentPrice.toLocaleString()}) →
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
                              🔒 ALLOTTED 1:1 WITH {cand.code} FOR {r3Lock!.finalEquityPct}% ({r3Lock!.finalShares.toLocaleString()} sh · calc ${r3Lock!.finalPrice.toLocaleString()})
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
                ? `Step 1 Required: Send Your Round 3 Base Equity or Extra Equity Request to ${incumbentPartner.code} Above`
                : incumbent.status === "CONSULTANT_ASKED"
                  ? `Waiting for ${incumbentPartner.code} to Accept or Remove for Re-Bid in Their Product Round 3 Tab…`
                  : `You Are Unlocked in the Round 3 Equity Auction — Lock 1-to-1 With a Product Team in Panel 2`}
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
            <b>⏳ Allotted 1:1 with {allottedPartner.code} ({allottedPartner.company}) for {r3Lock.finalEquityPct}% ({r3Lock.finalShares.toLocaleString()} sh · calc ${r3Lock.finalPrice.toLocaleString()}) — Waiting on Least-Money Draft Pick…</b>
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
            title="Round 3 allotment & equity settlement"
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
                    ? "ACCEPTED R3 EQUITY ✓"
                    : r3Lock.source === "RETURNED_TO_INCUMBENT"
                      ? "RETURNED TO YOU ✓"
                      : "LOCKED VIA R3 AUCTION ✓"}
                </span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>ROUND 3 EQUITY (SETTLED AFTER R3)</small>
                <b className="text-lg">{r3Lock.finalEquityPct}% · {r3Lock.finalShares.toLocaleString()} sh</b>
                <span>AUTO-CALC ${r3Lock.finalPrice.toLocaleString()} @ ${allottedPartner.sharePrice.toFixed(2)}/sh</span>
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
              Submitting your 6-part Round 3 Crisis Solution below delivers it immediately into <b>{allottedPartner.code}&apos;s</b> New Round 3 MVP builder. Your agreed stake of <b>{r3Lock.finalEquityPct}% ({r3Lock.finalShares.toLocaleString()} shares · calc ${r3Lock.finalPrice.toLocaleString()})</b> is settled after Round 3.
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
                  <b>✓ Round 3 crisis solution permanently submitted ({code} ⇄ {allottedPartner.code})</b> · Finalized at {submittedAt} ({count} words) and delivered live to <b>{allottedPartner.code}&apos;s</b> New Round 3 MVP editor. Stake ({r3Lock.finalEquityPct}% · {r3Lock.finalShares.toLocaleString()} sh · calc ${r3Lock.finalPrice.toLocaleString()}) queued for settlement.
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
      End-to-end Round 3 flow (Shares &amp; Equity %): <b>1. Send Base Equity or Extra Equity Ask to R2 Partner (Money Auto-Calculated)</b> → <b>2. Live Accept or Unlock into Open Equity Auction</b> → <b>3. Receive Product&apos;s Locked Problem Statement Live</b> → <b>4. Deliver Crisis Solution to Product&apos;s New MVP</b>.
    </div>
  </>;
}
