"use client";
import {useEffect,useMemo,useState} from "react";
import {PageTitle,Panel,Metric,useTeamCode} from "../ui";
import {
  EmptyFilterState,
  INITIAL_LIST_FILTER,
  ListFilterBar,
  buildDraftCashRanges,
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
  getR3IncumbentForProduct,
} from "../coordination-types";

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

const consultingR3Labels = [
  "01 · DIAGNOSIS",
  "02 · THREE OPTIONS",
  "03 · RECOMMENDATION",
  "04 · PER-PACK MATHS",
  "05 · TIMELINE",
  "06 · RISKS & FALLBACK",
];

export function ProductRound3() {
  const code = useTeamCode();
  const { state, dispatch, ready } = useCoordination();

  const product = useMemo(() => getOrMakeProduct(state, code), [state, code]);
  const consultingTeams = useMemo(
    () => state.consultantOrder.map(cCode => state.consultants[cCode]!).filter(Boolean),
    [state.consultantOrder, state.consultants]
  );

  // Live Round 3 Incumbent (carried directly from Round 2 lock, or default XC01)
  const incumbent = useMemo(() => getR3IncumbentForProduct(state, code), [state, code]);
  const incumbentFirm = useMemo(
    () => getOrMakeConsultant(state, incumbent.consultingCode),
    [state, incumbent.consultingCode]
  );

  const incumbentBaseShares = useMemo(
    () => equityPctToShares(incumbent.baseEquityPct, product.totalShares),
    [incumbent.baseEquityPct, product.totalShares]
  );
  const incumbentBasePrice = useMemo(
    () => calcMoneyFromShares(incumbentBaseShares, product.sharePrice),
    [incumbentBaseShares, product.sharePrice]
  );

  // Final Round 3 1:1 Lock
  const r3Lock = useMemo(() => getProductR3Lock(state, code), [state, code]);
  const lockedConsultant = useMemo(
    () => (r3Lock ? getOrMakeConsultant(state, r3Lock.consultingCode) : null),
    [state, r3Lock]
  );

  // Live Problem Statement & Draft Queue
  const statements = state.r3Statements;
  const draftQueue = state.r3DraftQueue;
  const lockedStatement = useMemo(() => getProductClaimedStatement(state, code), [state, code]);

  // Filter states
  const [rebidFilter, setRebidFilter] = useState<ListFilterState>(INITIAL_LIST_FILTER);
  const [draftFilter, setDraftFilter] = useState<ListFilterState>(INITIAL_LIST_FILTER);
  const [search, setSearch] = useState<string>("");
  const [psIdFilter, setPsIdFilter] = useState<string>("ALL");
  const [psTeamFilter, setPsTeamFilter] = useState<string>("ALL");
  const [psSectorFilter, setPsSectorFilter] = useState<string>("ALL");

  // New Round 3 MVP Editor
  const [active, setActive] = useState(0);
  const [mvpValues, setMvpValues] = useState<string[]>(Array(6).fill(""));

  useEffect(() => {
    if (!ready) return;
    if (product.r3MvpParts.length === 6 && product.r3MvpParts.some(s => s.trim().length > 0)) {
      setMvpValues(product.r3MvpParts);
    } else if (!product.r3MvpSubmittedAt) {
      setMvpValues(Array(6).fill(""));
    }
  }, [ready, code, product.r3MvpSubmittedAt, state.version === 1]);

  const submittedAt = product.r3MvpSubmittedAt;
  const isRebidding = incumbent.status === "REJECTED_REBIDDING" && !r3Lock;

  // ── FILTER MEMOS: RE-BID CONSULTANTS (EQUITY % & AUTO-CALC $) ──
  const getRebidVisibleEquity = (firmCode: string, baseEquityPct: number) => {
    if (firmCode === incumbent.consultingCode) return incumbent.requestedEquityPct;
    const d = getR3AuctionDeal(state, code, firmCode);
    return d.pendingEquityPct ?? d.currentEquityPct ?? baseEquityPct;
  };

  const rebidTeamOptions = useMemo(
    () =>
      consultingTeams.map(firm => {
        const eq = getRebidVisibleEquity(firm.code, firm.baseEquityPct);
        const sh = equityPctToShares(eq, product.totalShares);
        const calc = calcMoneyFromShares(sh, product.sharePrice);
        const isInc = firm.code === incumbent.consultingCode;
        return {
          code: firm.code,
          label: `${firm.code}${isInc ? " (Previous R2)" : ""} · ${eq}% (calc $${calc.toLocaleString()})`,
        };
      }),
    [consultingTeams, state, code, incumbent, product.totalShares, product.sharePrice]
  );

  const exactRebidEquities = useMemo(
    () =>
      uniqueSortedAmounts(
        consultingTeams.map(firm => getRebidVisibleEquity(firm.code, firm.baseEquityPct))
      ),
    [consultingTeams, state, code, incumbent]
  );

  const filteredRebidConsultants = useMemo(() => {
    const list = consultingTeams.filter(firm => {
      if (rebidFilter.teamCode !== "ALL" && firm.code !== rebidFilter.teamCode) return false;
      const eq = getRebidVisibleEquity(firm.code, firm.baseEquityPct);
      return matchesAmountFilter(eq, rebidFilter);
    });
    if (rebidFilter.sortBy === "AMOUNT_ASC") {
      return [...list].sort(
        (a, b) => getRebidVisibleEquity(a.code, a.baseEquityPct) - getRebidVisibleEquity(b.code, b.baseEquityPct)
      );
    }
    if (rebidFilter.sortBy === "AMOUNT_DESC") {
      return [...list].sort(
        (a, b) => getRebidVisibleEquity(b.code, b.baseEquityPct) - getRebidVisibleEquity(a.code, a.baseEquityPct)
      );
    }
    if (rebidFilter.sortBy === "CODE_ASC") {
      return [...list].sort((a, b) => a.code.localeCompare(b.code));
    }
    // Keep previous incumbent first, then active negotiations
    return [...list].sort((a, b) => {
      const rank = (cCode: string) => {
        if (cCode === incumbent.consultingCode) return 4;
        const d = getR3AuctionDeal(state, code, cCode);
        if (d.lockInitiatedBy === "CONSULTING" && d.consultingLockAccepted) return 3;
        if (d.stage === "COUNTER_DEMANDED" || d.stage === "PROPOSAL_SENT" || d.stage === "DEAL_AGREED_UNLOCKED") return 2;
        return 1;
      };
      return rank(b.code) - rank(a.code);
    });
  }, [consultingTeams, state, code, rebidFilter, incumbent]);

  // ── FILTER MEMOS: DRAFT QUEUE (LEAST MONEY FIRST) ──
  const draftTeamOptions = useMemo(
    () =>
      draftQueue.map(entry => ({
        code: entry.code,
        label: `#${String(entry.rank).padStart(2, "0")} ${entry.code} · ${entry.code === code ? `${product.company} (You)` : entry.company} ($${entry.cash.toLocaleString()})`,
      })),
    [draftQueue, code, product.company]
  );

  const exactDraftAmounts = useMemo(
    () => uniqueSortedAmounts(draftQueue.map(entry => entry.cash)),
    [draftQueue]
  );

  const filteredDraftQueue = useMemo(() => {
    const list = draftQueue.filter(entry => {
      if (draftFilter.teamCode !== "ALL" && entry.code !== draftFilter.teamCode) return false;
      return matchesAmountFilter(entry.cash, draftFilter);
    });
    if (draftFilter.sortBy === "AMOUNT_DESC") return [...list].sort((a, b) => b.cash - a.cash);
    if (draftFilter.sortBy === "AMOUNT_ASC") return [...list].sort((a, b) => a.cash - b.cash);
    if (draftFilter.sortBy === "CODE_ASC") return [...list].sort((a, b) => a.code.localeCompare(b.code));
    return list;
  }, [draftQueue, draftFilter]);

  // ── FILTER MEMOS: PROBLEM STATEMENT POOL ──
  const statementClaimedTeams = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of statements) {
      if (s.claimedBy) seen.set(s.claimedBy, s.claimedByName ?? s.claimedBy);
    }
    return Array.from(seen.entries());
  }, [statements]);

  const statementSectors = useMemo(
    () => Array.from(new Set(statements.map(s => s.sector))),
    [statements]
  );

  const isStatementFilterActive =
    psIdFilter !== "ALL" || psTeamFilter !== "ALL" || psSectorFilter !== "ALL" || search.trim() !== "";

  const resetStatementFilters = () => {
    setPsIdFilter("ALL");
    setPsTeamFilter("ALL");
    setPsSectorFilter("ALL");
    setSearch("");
  };

  const filteredStatements = useMemo(() => {
    const q = search.trim().toLowerCase();
    return statements.filter(s => {
      if (psIdFilter !== "ALL" && s.id !== psIdFilter) return false;
      if (psTeamFilter === "OPEN" && s.claimedBy) return false;
      if (psTeamFilter !== "ALL" && psTeamFilter !== "OPEN" && s.claimedBy !== psTeamFilter) return false;
      if (psSectorFilter !== "ALL" && s.sector !== psSectorFilter) return false;
      if (!q) return true;
      return (
        s.id.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        s.sector.toLowerCase().includes(q) ||
        s.brief.toLowerCase().includes(q) ||
        (s.claimedBy?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [statements, search, psIdFilter, psTeamFilter, psSectorFilter]);

  const handlePickStatement = (psId: string) => {
    if (lockedStatement) return;
    dispatch({ type: "R3_PICK_STATEMENT", productCode: code, statementId: psId });
    window.setTimeout(() => {
      dispatch({ type: "R3_SIMULATE_NEXT_DRAFT_PICK" });
    }, 1500);
  };

  const consultantSubmittedR3 = !!r3Lock?.r3SolutionSubmittedAt;
  const consultantDraftedR3 =
    !!r3Lock && r3Lock.r3SolutionParts.some(p => p.trim().length > 0);
  const isLockedNpcConsultant = !!r3Lock && r3Lock.consultingCode !== "XC01";

  const handlePullConsultantIntoMvp = () => {
    if (!lockedStatement || !r3Lock || submittedAt) return;
    const p = r3Lock.r3SolutionParts;
    setMvpValues([
      `${lockedStatement.id} (${lockedStatement.title}): ${p[0] || lockedStatement.crisisTwist}`,
      `New Round 3 MVP built for ${lockedStatement.title}: ${p[2] || "Focused Version-1 solution solving the crisis directly."}`,
      `Integrated Team ${r3Lock.consultingCode}'s Round 3 crisis solution: ${p[2] || p[1] || ""}`,
      `Target users in ${lockedStatement.sector} most affected by the crisis.`,
      p[3] || "Target 38%+ gross margin after crisis shock with sub-60-day break-even.",
      `${p[4] || ""} ${p[5] || ""}`.trim() || "4-week launch roadmap with fallback supplier controls.",
    ]);
  };

  const mvpCount = useMemo(
    () => mvpValues.reduce((n, v) => n + v.trim().split(/\s+/).filter(Boolean).length, 0),
    [mvpValues]
  );

  const handleSubmitR3Mvp = () => {
    if (!lockedStatement || !r3Lock || submittedAt || mvpCount === 0) return;
    dispatch({
      type: "R3_PRODUCT_SUBMIT_MVP",
      productCode: code,
      parts: mvpValues,
    });
  };

  const incumbentExtraShares = Math.max(0, incumbent.requestedShares - incumbentBaseShares);
  const incumbentExtraPrice = Math.max(0, incumbent.requestedPrice - incumbentBasePrice);

  return <>
    <PageTitle
      eyebrow={`ROUND 3 / LIVE EQUITY RE-BID, LEAST-MONEY DRAFT & NEW MVP · ${code}`}
      title="Decide your consultant equity deal, draft your problem statement, and build a new MVP."
      sub={`Live end-to-end Round 3 coordination in Shares & Equity % (${product.company} @ $${product.sharePrice.toFixed(2)}/sh · ${product.totalShares.toLocaleString()} total shares): receive your Round 2 Consultant's equity ask live (dollar value calculated automatically), accept or remove them for re-bid while keeping the option to return, pick 1 exclusive Problem Statement in least-money order, and build your New MVP.`}
    />

    <div className="guide-grid three">
      <Metric
        label="ROUND 3 CONSULTANT"
        value={
          r3Lock
            ? `LOCKED · ${r3Lock.consultingCode}`
            : isRebidding
              ? "RE-BIDDING OPEN"
              : incumbent.status === "CONSULTANT_ASKED"
                ? `${incumbent.consultingCode} ASKING ${incumbent.requestedEquityPct}%`
                : `R2 PARTNER: ${incumbent.consultingCode}`
        }
        delta={
          r3Lock
            ? `${r3Lock.finalEquityPct}% (${r3Lock.finalShares.toLocaleString()} sh · calc $${r3Lock.finalPrice.toLocaleString()})`
            : isRebidding
              ? `RE-BID OR RETURN TO ${incumbent.consultingCode}`
              : incumbent.status === "CONSULTANT_ASKED"
                ? `${incumbent.requestedShares.toLocaleString()} sh (+${incumbent.requestedExtraPct}% · calc $${incumbent.requestedPrice.toLocaleString()})`
                : `BASE ${incumbent.baseEquityPct}% (${incumbentBaseShares.toLocaleString()} sh · calc $${incumbentBasePrice.toLocaleString()})`
        }
      />
      <Metric
        label="DRAFT ORDER (LEAST MONEY FIRST)"
        value={lockedStatement ? `PICKED · ${lockedStatement.id}` : "PICK #3 · YOUR TURN"}
        delta={
          lockedStatement
            ? r3Lock
              ? `DISPATCHED LIVE TO ${r3Lock.consultingCode} ✓`
              : "PERMANENTLY LOCKED · WILL DISPATCH ONCE CONSULTANT LOCKS"
            : "LEAST-MONEY ORDER · 1 TEAM PER STATEMENT"
        }
      />
      <Metric
        label="ROUND 3 NEW MVP"
        value={
          submittedAt
            ? "SUBMITTED ✓"
            : lockedStatement && r3Lock
              ? consultantSubmittedR3
                ? "SOLUTION RECEIVED ✓"
                : `AWAITING ${r3Lock.consultingCode}`
              : "WAITING ON STEPS 1 & 3"
        }
        delta={
          submittedAt
            ? `FINALIZED ${submittedAt}`
            : lockedStatement && r3Lock
              ? consultantSubmittedR3
                ? `${r3Lock.consultingCode} DELIVERED SOLUTION · BUILD MVP`
                : `${lockedStatement.id} DISPATCHED TO ${r3Lock.consultingCode}`
              : "LOCK CONSULTANT & PICK STATEMENT FIRST"
        }
      />
    </div>

    {/* ── STEP 1: KEEP CONSULTANT OR REMOVE FOR RE-BID (SHARES & EQUITY %) ── */}
    <div className="guide-grid two mt-4">
      <Panel
        title="1. Round 3 consultant equity decision (keep or remove for re-bid)"
        tag={
          r3Lock
            ? `FINAL R3 CONSULTANT · ${r3Lock.consultingCode}`
            : isRebidding
              ? "REMOVED FOR RE-BID · OPTION TO RETURN"
              : incumbent.status === "CONSULTANT_ASKED"
                ? `⚡ LIVE EQUITY ASK FROM ${incumbent.consultingCode}`
                : `R2 PARTNER · ${incumbent.consultingCode}`
        }
      >
        {!r3Lock && !isRebidding && (
          <>
            {incumbent.status === "CONSULTANT_ASKED" ? (
              <div className="guide-alert guide-warning mb-3">
                <b>⚡ Live Round 3 Equity Ask from Team {incumbent.consultingCode}:</b> They are asking for{" "}
                <b>{incumbent.requestedEquityPct}% equity ({incumbent.requestedShares.toLocaleString()} shares)</b> — auto-calculated at{" "}
                <b>${incumbent.requestedPrice.toLocaleString()}</b> (@ ${product.sharePrice.toFixed(2)}/sh){" "}
                (
                {incumbent.requestedExtraPct > 0
                  ? `+${incumbent.requestedExtraPct}% / +${incumbentExtraShares.toLocaleString()} sh above their ${incumbent.baseEquityPct}% base rate`
                  : "at base equity 0% extra"}
                ). Accept to lock 1:1 for Round 3, or remove them for re-bid!
              </div>
            ) : (
              <p className="guide-muted">
                Your Round 2 consultant is <b>Team {incumbent.consultingCode}</b> (base equity <b>{incumbent.baseEquityPct}% · {incumbentBaseShares.toLocaleString()} shares · calc ${incumbentBasePrice.toLocaleString()}</b>). Waiting for them to send a Round 3 equity request from their Consulting tab—or keep them at base equity now, or remove them to re-bid for another consultant.
              </p>
            )}

            <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-mono">
              <div className="border border-[#294832] p-2">
                <span className="block text-[#cfa078]">BASE EQUITY</span>
                <b className="mt-0.5 block text-[#fff7f0]">
                  {incumbent.baseEquityPct}% ({incumbentBaseShares.toLocaleString()} sh)
                </b>
                <span className="block text-[#cfa078]">calc ${incumbentBasePrice.toLocaleString()}</span>
              </div>
              <div className="border border-[#294832] p-2">
                <span className="block text-[#cfa078]">LIVE R3 EQUITY ASK</span>
                <b className="mt-0.5 block text-[#fff7f0]">
                  {incumbent.requestedEquityPct}% ({incumbent.requestedShares.toLocaleString()} sh)
                </b>
                <span className="block text-[#cfa078]">calc ${incumbent.requestedPrice.toLocaleString()}</span>
              </div>
              <div className="border border-[#294832] p-2">
                <span className="block text-[#cfa078]">EXTRA OVER BASE</span>
                <b className="mt-0.5 block text-[#ff9b45]">
                  {incumbent.requestedExtraPct > 0
                    ? `+${incumbent.requestedExtraPct}% (+${incumbentExtraShares.toLocaleString()} sh)`
                    : "0% (BASE EQUITY)"}
                </b>
                <span className="block text-[#cfa078]">
                  {incumbentExtraPrice > 0 ? `+$${incumbentExtraPrice.toLocaleString()} calc` : "$0 extra"}
                </span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="guide-btn"
                onClick={() =>
                  dispatch({
                    type: "R3_PRODUCT_ACCEPT_INCUMBENT",
                    productCode: code,
                    consultingCode: incumbent.consultingCode,
                  })
                }
              >
                {incumbent.status === "CONSULTANT_ASKED"
                  ? `ACCEPT ${incumbent.consultingCode} AT ${incumbent.requestedEquityPct}% (${incumbent.requestedShares.toLocaleString()} sh · $${incumbent.requestedPrice.toLocaleString()}) 🔒`
                  : `KEEP ${incumbent.consultingCode} AT BASE ${incumbent.baseEquityPct}% (${incumbentBaseShares.toLocaleString()} sh · $${incumbentBasePrice.toLocaleString()}) 🔒`}
              </button>
              <button
                type="button"
                className="guide-btn secondary"
                onClick={() =>
                  dispatch({
                    type: "R3_PRODUCT_REMOVE_INCUMBENT",
                    productCode: code,
                    consultingCode: incumbent.consultingCode,
                  })
                }
              >
                REMOVE {incumbent.consultingCode} &amp; RE-BID FOR ANOTHER CONSULTANT →
              </button>
            </div>
          </>
        )}

        {isRebidding && (
          <>
            <div className="guide-alert guide-warning mb-3">
              <b>Team {incumbent.consultingCode} removed for Round 3 re-bid (unlocked into Open Equity Auction live).</b> Send a share &amp; equity re-bid offer to any available consultant below, or click <b>Get Back With {incumbent.consultingCode}</b> if they are still available!
            </div>
            <ListFilterBar
              value={rebidFilter}
              onChange={setRebidFilter}
              teamOptions={rebidTeamOptions}
              teamLabel="CONSULTING TEAM CODE"
              allTeamsLabel="All Consultants"
              valueKind="EQUITY"
              amountLabel="CONSULTANT EQUITY %"
              amountRanges={buildEquityRanges()}
              exactAmounts={exactRebidEquities}
              sortOptions={[
                { value: "DEFAULT", label: "Default Order" },
                { value: "AMOUNT_ASC", label: "Equity %: Low → High" },
                { value: "AMOUNT_DESC", label: "Equity %: High → Low" },
                { value: "CODE_ASC", label: "Team Code: A → Z" },
              ]}
              totalCount={consultingTeams.length}
              filteredCount={filteredRebidConsultants.length}
              itemNoun="consultants"
            />
            <div className="guide-scroll-box space-y-2.5">
              {filteredRebidConsultants.length === 0 ? (
                <EmptyFilterState noun="consultants" onReset={() => setRebidFilter(INITIAL_LIST_FILTER)} />
              ) : (
                filteredRebidConsultants.map(firm => {
                  const isInc = firm.code === incumbent.consultingCode;
                  const firmLockedElsewhere = getConsultingR3Lock(state, firm.code);
                  const isTakenElsewhere =
                    firmLockedElsewhere !== null && firmLockedElsewhere.productCode !== code;
                  const d = getR3AuctionDeal(state, code, firm.code);
                  const isConsultingLockIncoming =
                    d.lockInitiatedBy === "CONSULTING" && d.consultingLockAccepted && !d.productLockAccepted;
                  const isProductLockWaiting =
                    d.lockInitiatedBy === "PRODUCT" && d.productLockAccepted && !d.consultingLockAccepted;
                  const visibleEq = getRebidVisibleEquity(firm.code, firm.baseEquityPct);
                  const visibleSh = equityPctToShares(visibleEq, product.totalShares);
                  const visibleCalc = calcMoneyFromShares(visibleSh, product.sharePrice);
                  const baseSh = equityPctToShares(firm.baseEquityPct, product.totalShares);
                  const baseCalc = calcMoneyFromShares(baseSh, product.sharePrice);
                  const extraEq = Math.max(0, Number((visibleEq - firm.baseEquityPct).toFixed(2)));
                  const extraSh = Math.max(0, visibleSh - baseSh);
                  const isNpcFirm = firm.code !== "XC01";

                  return (
                    <div
                      key={firm.code}
                      className="border border-[#294832] p-3"
                      style={{ opacity: isTakenElsewhere ? 0.45 : 1 }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className={`guide-chip ${isInc || isConsultingLockIncoming || d.stage === "COUNTER_DEMANDED" ? "active" : ""}`}>
                            {firm.code} {isInc ? "· PREVIOUS R2 CONSULTANT" : `· R1 SCORE ${firm.r1Score}`}
                          </span>
                          <b className="ml-2 text-sm">Team {firm.code}</b>
                        </div>
                        <span className="guide-status">
                          {isTakenElsewhere
                            ? `CLOSED · LOCKED WITH ${firmLockedElsewhere!.productCode}`
                            : isInc
                              ? `AVAILABLE TO RETURN · ${incumbent.requestedEquityPct}% (${incumbent.requestedShares.toLocaleString()} sh · $${incumbent.requestedPrice.toLocaleString()})`
                              : isConsultingLockIncoming
                                ? `⚡ ${firm.code} SENT LOCK REQUEST (${d.currentEquityPct}% · $${d.currentPrice.toLocaleString()})!`
                                : isProductLockWaiting
                                  ? `● LOCK REQUEST SENT · WAITING FOR ${firm.code}…`
                                  : d.stage === "PROPOSAL_SENT"
                                    ? `● RE-BID SENT (${d.currentEquityPct}%) · WAITING FOR ${firm.code}…`
                                    : d.stage === "COUNTER_DEMANDED"
                                      ? `▲ ASKING +${extraEq}% (+${extraSh.toLocaleString()} sh → ${visibleEq}% · $${visibleCalc.toLocaleString()})`
                                      : d.stage === "DEAL_AGREED_UNLOCKED"
                                        ? `✓ AGREED AT ${d.currentEquityPct}% (${d.currentShares.toLocaleString()} sh · $${d.currentPrice.toLocaleString()})`
                                        : `BASE: ${firm.baseEquityPct}% (${baseSh.toLocaleString()} sh · calc $${baseCalc.toLocaleString()})`}
                        </span>
                      </div>
                      <p className="guide-muted mt-1">{firm.speciality}</p>

                      {!isTakenElsewhere && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          {isInc ? (
                            <button
                              type="button"
                              className="guide-btn secondary"
                              onClick={() =>
                                dispatch({
                                  type: "R3_PRODUCT_RETURN_TO_INCUMBENT",
                                  productCode: code,
                                  consultingCode: firm.code,
                                })
                              }
                            >
                              GET BACK WITH {firm.code} AT {incumbent.requestedEquityPct}% ({incumbent.requestedShares.toLocaleString()} sh · ${incumbent.requestedPrice.toLocaleString()}) 🔒
                            </button>
                          ) : isConsultingLockIncoming ? (
                            <button
                              type="button"
                              className="guide-btn"
                              onClick={() =>
                                dispatch({
                                  type: "R3_ACCEPT_AUCTION_LOCK",
                                  productCode: code,
                                  consultingCode: firm.code,
                                  acceptedBy: "PRODUCT",
                                })
                              }
                            >
                              ACCEPT LOCK FROM {firm.code} ({d.currentEquityPct}% · ${d.currentPrice.toLocaleString()}) 🔒
                            </button>
                          ) : isProductLockWaiting ? (
                            <>
                              <span className="guide-status">● WAITING FOR {firm.code} TO ACCEPT LOCK…</span>
                              {isNpcFirm && (
                                <button
                                  type="button"
                                  className="guide-btn secondary"
                                  onClick={() =>
                                    dispatch({
                                      type: "R3_ACCEPT_AUCTION_LOCK",
                                      productCode: code,
                                      consultingCode: firm.code,
                                      acceptedBy: "CONSULTING",
                                    })
                                  }
                                >
                                  SIMULATE {firm.code} ACCEPT LOCK
                                </button>
                              )}
                            </>
                          ) : d.stage === "COUNTER_DEMANDED" ? (
                            <button
                              type="button"
                              className="guide-btn"
                              onClick={() =>
                                dispatch({
                                  type: "R3_PRODUCT_ACCEPT_AUCTION_DEMAND",
                                  productCode: code,
                                  consultingCode: firm.code,
                                })
                              }
                            >
                              ACCEPT {visibleEq}% (+{extraEq}% · {visibleSh.toLocaleString()} sh · $${visibleCalc.toLocaleString()}) →
                            </button>
                          ) : d.stage === "PROPOSAL_SENT" ? (
                            <>
                              <span className="guide-status">● RE-BID SENT LIVE TO {firm.code}…</span>
                              {isNpcFirm && (
                                <button
                                  type="button"
                                  className="guide-btn secondary"
                                  onClick={() =>
                                    dispatch({
                                      type: "R3_CONSULTING_PUSH_AUCTION_DEMAND",
                                      productCode: code,
                                      consultingCode: firm.code,
                                      extraEquityPct: firm.defaultR3ExtraPct,
                                    })
                                  }
                                >
                                  SIMULATE {firm.code} REPLY (+{firm.defaultR3ExtraPct}% EQ)
                                </button>
                              )}
                            </>
                          ) : d.stage === "DEAL_AGREED_UNLOCKED" ? (
                            <button
                              type="button"
                              className="guide-btn"
                              onClick={() =>
                                dispatch({
                                  type: "R3_SEND_AUCTION_LOCK",
                                  productCode: code,
                                  consultingCode: firm.code,
                                  initiatedBy: "PRODUCT",
                                })
                              }
                            >
                              SEND LOCK REQUEST TO {firm.code} ({d.currentEquityPct}% · {d.currentShares.toLocaleString()} sh · ${d.currentPrice.toLocaleString()}) 🔒
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="guide-btn secondary"
                              onClick={() =>
                                dispatch({
                                  type: "R3_PRODUCT_SEND_REBID",
                                  productCode: code,
                                  consultingCode: firm.code,
                                })
                              }
                            >
                              OFFER {firm.baseEquityPct}% ({baseSh.toLocaleString()} sh · calc ${baseCalc.toLocaleString()}) RE-BID TO {firm.code} →
                            </button>
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

        {r3Lock && lockedConsultant && (
          <div className="space-y-3">
            <div className="guide-alert">
              <b>✓ Round 3 Consultant Locked: Team {lockedConsultant.code}</b> for{" "}
              <b>{r3Lock.finalEquityPct}% equity ({r3Lock.finalShares.toLocaleString()} shares)</b> — auto-calculated at{" "}
              <b>${r3Lock.finalPrice.toLocaleString()}</b> (@ ${product.sharePrice.toFixed(2)}/sh,{" "}
              {r3Lock.extraEquityPct > 0 ? `+${r3Lock.extraEquityPct}% above base` : "at base equity"}).
              {r3Lock.source === "RETURNED_TO_INCUMBENT"
                ? " You chose to return to your previous Round 2 consultant."
                : r3Lock.source === "REBID_AUCTION"
                  ? ` Locked via Round 3 re-bid (${r3Lock.lockedAt}).`
                  : ` Retained from Round 2 (${r3Lock.lockedAt}).`}
            </div>
            <p className="guide-muted">
              {lockedStatement ? (
                <>
                  Problem Statement <b>{lockedStatement.id}</b> has been dispatched live to <b>Team {lockedConsultant.code}</b>! Their written crisis solution streams into Panel 4 below.
                </>
              ) : (
                <>
                  Now pick &amp; lock 1 exclusive Problem Statement in Step 3 below—it will dispatch live to <b>Team {lockedConsultant.code}</b> instantaneously!
                </>
              )}
            </p>
          </div>
        )}
      </Panel>

      {/* ── STEP 2A: REVERSE-MONEY ORDER DRAFT QUEUE (LEAST MONEY PICKS FIRST) ── */}
      <Panel title="2. Draft order (least money chooses first)" tag="1 TEAM PER PROBLEM STATEMENT · LOCKS ON PICK">
        <p className="guide-muted mb-3">
          Problem statement selection starts with the <b>company with the least money</b> (from Round 2 Finance share deals), then the second-least money, up to the richest company. Once a team picks a statement, it is <b>permanently locked (1 team per statement)</b>.
        </p>
        <ListFilterBar
          value={draftFilter}
          onChange={setDraftFilter}
          teamOptions={draftTeamOptions}
          teamLabel="PRODUCT TEAM CODE"
          allTeamsLabel="All Draft Teams"
          amountLabel="CASH BALANCE FILTER"
          amountRanges={buildDraftCashRanges()}
          exactAmounts={exactDraftAmounts}
          minPlaceholder="e.g. 20000"
          maxPlaceholder="e.g. 45000"
          sortOptions={[
            { value: "DEFAULT", label: "Draft Order (Least Money First)" },
            { value: "AMOUNT_DESC", label: "Most Money First" },
            { value: "CODE_ASC", label: "Team Code: A → Z" },
          ]}
          totalCount={draftQueue.length}
          filteredCount={filteredDraftQueue.length}
          itemNoun="draft teams"
        />
        <div className="guide-scroll-box compact space-y-2">
          {filteredDraftQueue.length === 0 ? (
            <EmptyFilterState noun="draft teams" onReset={() => setDraftFilter(INITIAL_LIST_FILTER)} />
          ) : (
            filteredDraftQueue.map(entry => {
              const isYou = entry.code === code;
              return (
                <div
                  key={entry.code}
                  className="flex flex-wrap items-center justify-between gap-2 border border-[#294832] p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className={`guide-chip ${entry.status === "YOUR_TURN" ? "active" : ""}`}>
                      #{String(entry.rank).padStart(2, "0")}
                    </span>
                    <div>
                      <b className="text-xs">
                        {entry.code} · {isYou ? `${product.company} (You)` : entry.company}
                      </b>
                      <span className="block font-mono text-[10px] text-[#cfa078]">
                        CASH: ${entry.cash.toLocaleString()} {entry.rank === 1 ? "(LEAST MONEY)" : entry.rank === draftQueue.length ? "(MOST MONEY)" : ""}
                      </span>
                    </div>
                  </div>
                  <span className="guide-status">
                    {entry.status === "CLAIMED"
                      ? `🔒 LOCKED ${entry.pickedStatementId}`
                      : entry.status === "YOUR_TURN"
                        ? isYou
                          ? "● YOUR TURN NOW"
                          : "● PICKING NOW…"
                        : "WAITING IN ORDER"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </Panel>
    </div>

    {/* ── STEP 2B: PROBLEM STATEMENT POOL (PICK 1 & LOCK PERMANENTLY) ── */}
    <div className="mt-4">
      <Panel
        title="3. Problem statement pool (pick 1 — strictly 1 team per statement, cannot change)"
        tag={
          lockedStatement
            ? `LOCKED: ${lockedStatement.id} · ${r3Lock ? `DISPATCHED TO ${r3Lock.consultingCode}` : "READY FOR CONSULTANT"}`
            : "YOUR TURN (#3 LEAST MONEY) · CHOOSE 1"
        }
      >
        <p className="guide-muted mb-3">
          Showing available &amp; claimed Round 3 problem statements (1 team per statement). Once picked, it locks permanently and dispatches straight to your locked Consulting team&apos;s workspace.
        </p>

        <div className="guide-filter-bar" role="region" aria-label="Problem statement pool filters">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="ps-id-filter" className="guide-label">PROBLEM STATEMENT CODE</label>
              <select
                id="ps-id-filter"
                className="guide-select guide-filter-control font-mono"
                value={psIdFilter}
                onChange={e => {
                  const next = e.target.value;
                  setPsIdFilter(next);
                  if (next !== "ALL") {
                    setPsTeamFilter("ALL");
                    setPsSectorFilter("ALL");
                  }
                }}
              >
                <option value="ALL">All Statements ({statements.length})</option>
                {statements.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.id} · {s.claimedBy ? `Taken (${s.claimedBy})` : "Open"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ps-team-filter" className="guide-label">CLAIMED TEAM CODE / STATUS</label>
              <select
                id="ps-team-filter"
                className="guide-select guide-filter-control font-mono"
                value={psTeamFilter}
                onChange={e => {
                  const next = e.target.value;
                  setPsTeamFilter(next);
                  if (next !== "ALL") setPsIdFilter("ALL");
                }}
              >
                <option value="ALL">All (Open &amp; Claimed)</option>
                <option value="OPEN">Open / Unclaimed Only</option>
                {statementClaimedTeams.length > 0 && (
                  <optgroup label="Claimed by Team Code">
                    {statementClaimedTeams.map(([tCode, tName]) => (
                      <option key={tCode} value={tCode}>
                        {tCode} · {tName}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div>
              <label htmlFor="ps-sector-filter" className="guide-label">SECTOR</label>
              <select
                id="ps-sector-filter"
                className="guide-select guide-filter-control font-mono"
                value={psSectorFilter}
                onChange={e => setPsSectorFilter(e.target.value)}
              >
                <option value="ALL">All Sectors</option>
                {statementSectors.map(sec => (
                  <option key={sec} value={sec}>{sec}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ps-keyword-filter" className="guide-label">KEYWORD SEARCH</label>
              <input
                id="ps-keyword-filter"
                type="text"
                className="guide-input guide-filter-control"
                placeholder="Search title, brief or team…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="guide-filter-meta">
            <span className="guide-muted !text-[10px] font-mono">
              SHOWING <b>{filteredStatements.length}</b> OF <b>{statements.length}</b> PROBLEM STATEMENTS
              {psIdFilter !== "ALL" && ` · ${psIdFilter}`}
              {psTeamFilter === "OPEN" && " · OPEN ONLY"}
              {psTeamFilter !== "ALL" && psTeamFilter !== "OPEN" && ` · CLAIMED BY ${psTeamFilter}`}
              {psSectorFilter !== "ALL" && ` · ${psSectorFilter}`}
            </span>
            <div className="flex items-center gap-2">
              {filteredStatements.length > 1 && (
                <span className="guide-muted !text-[9px] font-mono">↕ SCROLL INSIDE BOX</span>
              )}
              {isStatementFilterActive && (
                <button
                  type="button"
                  className="guide-btn secondary guide-filter-reset"
                  onClick={resetStatementFilters}
                >
                  RESET FILTERS
                </button>
              )}
            </div>
          </div>
        </div>

        {filteredStatements.length === 0 ? (
          <EmptyFilterState noun="problem statements" onReset={resetStatementFilters} />
        ) : (
          <div className="guide-scroll-box grid-8">
            <div className="guide-grid two">
              {filteredStatements.map(ps => {
                const isYours = ps.id === lockedStatement?.id;
                const isTakenByOther = !!ps.claimedBy && !isYours;
                const isDisabled = !!lockedStatement || isTakenByOther;

                return (
                  <div
                    key={ps.id}
                    className="border border-[#294832] p-3.5"
                    style={{ opacity: isTakenByOther || (!!lockedStatement && !isYours) ? 0.45 : 1 }}
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
                          ✓ PERMANENTLY LOCKED TO TEAM {code} · DISPATCHED LIVE TO CONSULTANT
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
          </div>
        )}
      </Panel>
    </div>

    {/* ── STEP 3: DISPATCHED TO CONSULTANT + LIVE SOLUTION + BUILD NEW ROUND 3 MVP ── */}
    {!lockedStatement || !r3Lock || !lockedConsultant ? (
      <div className="mt-4">
        <Panel title="4. Consultant crisis solution & new Round 3 MVP" tag="UNLOCKS ONCE CONSULTANT & PROBLEM STATEMENT ARE LOCKED">
          <div className="guide-alert guide-warning">
            <b>Complete Steps 1 &amp; 3 Above to Unlock Your New Round 3 MVP</b>
            <br />
            • Step 1 (Round 3 Consultant): <b>{r3Lock ? `✓ Locked with Team ${r3Lock.consultingCode} (${r3Lock.finalEquityPct}% · ${r3Lock.finalShares.toLocaleString()} sh · calc $${r3Lock.finalPrice.toLocaleString()})` : `Pending — Accept ${incumbent.consultingCode} or re-bid & lock a consultant`}</b>
            <br />
            • Step 3 (Problem Statement Draft): <b>{lockedStatement ? `✓ Locked ${lockedStatement.id}` : "Pending — Pick & lock 1 open problem statement above"}</b>
            <br />
            Once both are locked, the problem statement dispatches live to your Consultant and their written Round 3 crisis solution streams back here!
          </div>
        </Panel>
      </div>
    ) : (
      <>
        <div className="guide-grid two mt-4">
          <Panel
            title={`4. Dispatched ${lockedStatement.id} → Live solution from Team ${lockedConsultant.code}`}
            tag={
              consultantSubmittedR3
                ? `DELIVERED LIVE · ${r3Lock.r3SolutionSubmittedAt}`
                : consultantDraftedR3
                  ? `${lockedConsultant.code} DRAFTING LIVE…`
                  : `SENT TO ${lockedConsultant.code} · AWAITING SOLUTION`
            }
          >
            <span className="guide-chip active">
              {lockedStatement.id} · DISPATCHED LIVE TO TEAM {lockedConsultant.code} ✓
            </span>
            <h3 className="mt-2.5 text-base font-semibold">{lockedStatement.title}</h3>

            {consultantSubmittedR3 || consultantDraftedR3 ? (
              <>
                <div className="guide-alert mt-3 mb-2">
                  {consultantSubmittedR3 ? (
                    <>
                      <b>✓ Live Round 3 Crisis Solution Delivered by Team {lockedConsultant.code}</b> ({r3Lock.r3SolutionSubmittedAt}).
                    </>
                  ) : (
                    <>
                      <b>● Team {lockedConsultant.code} is currently writing your Round 3 crisis solution…</b>
                    </>
                  )}
                </div>
                <div className="guide-scroll-box compact space-y-2 text-xs">
                  {r3Lock.r3SolutionParts.map((text, idx) => (
                    <div key={consultingR3Labels[idx]} className="border border-[#294832] p-2.5">
                      <span className="guide-status">{consultingR3Labels[idx]}</span>
                      <p className="guide-muted mt-1">{text.trim() || "Not written yet by consultant…"}</p>
                    </div>
                  ))}
                </div>
                {!submittedAt && (
                  <button
                    type="button"
                    className="guide-btn secondary mt-3 w-full"
                    onClick={handlePullConsultantIntoMvp}
                  >
                    PRE-FILL TEAM {lockedConsultant.code}&apos;S LIVE SOLUTION INTO NEW MVP EDITOR ↓
                  </button>
                )}
              </>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="guide-alert guide-warning">
                  <b>⏳ {lockedStatement.id} has been dispatched live to Consultant Team {lockedConsultant.code}!</b>
                  <br />
                  Switch to Team <b>{lockedConsultant.code}&apos;s</b> Round 3 workspace to write and submit their crisis solution—all 6 parts will appear live right here instantaneously!
                </div>
                {isLockedNpcConsultant && (
                  <button
                    type="button"
                    className="guide-btn secondary w-full"
                    onClick={() =>
                      dispatch({
                        type: "R3_CONSULTING_SUBMIT_SOLUTION",
                        productCode: code,
                        consultingCode: lockedConsultant.code,
                        parts: [
                          `Diagnosis for ${lockedStatement.id}: ${lockedStatement.crisisTwist}`,
                          `Evaluated 3 turnaround options tailored to ${lockedStatement.sector}.`,
                          `Build a lean Version-1 solution directly around ${lockedStatement.title} with anchor institutional customers.`,
                          `Target 38%+ gross margin after crisis shock and break-even inside 60 days.`,
                          `Week 1 pilot launch → Week 2–4 scale with pre-committed distributors.`,
                          `Dual-supplier and compliance contingency plan configured upfront.`,
                        ],
                      })
                    }
                  >
                    SIMULATE {lockedConsultant.code} SUBMITTING ROUND 3 SOLUTION →
                  </button>
                )}
              </div>
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
                <small>R3 CONSULTANT STAKE</small>
                <b>Team {lockedConsultant.code}</b>
                <span>{r3Lock.finalEquityPct}% ({r3Lock.finalShares.toLocaleString()} sh · calc ${r3Lock.finalPrice.toLocaleString()})</span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>CONSULTANT STATUS</small>
                <b className="text-base">{consultantSubmittedR3 ? "DELIVERED ✓" : "SOLVING"}</b>
                <span>{r3Lock.r3SolutionSubmittedAt ?? `DISPATCHED TO ${lockedConsultant.code}`}</span>
              </div>
              <div className="guide-metric">
                <small>NEW MVP STATUS</small>
                <b className="text-base">{submittedAt ? "SUBMITTED ✓" : "IN PROGRESS"}</b>
                <span>{submittedAt ? `FINALIZED ${submittedAt}` : "BUILD NEW MVP BELOW"}</span>
              </div>
            </div>
            <div className="guide-alert mt-4">
              <b>{lockedStatement.id}</b> is live on <b>Team {lockedConsultant.code}&apos;s</b> Consulting Round 3 screen. Build your brand-new Round 3 MVP incorporating their crisis solution below and submit it.
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
                  <b>✓ Round 3 New MVP permanently submitted for {lockedStatement.id} (with Team {lockedConsultant.code})</b> · Finalized at {submittedAt} ({mvpCount} words) and synced live to Team {lockedConsultant.code}.
                </div>
                <span className="guide-chip active">FINAL · LOCKED</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="guide-muted">
                Build your new Round 3 MVP for <b>{lockedStatement.id}</b> incorporating Team {lockedConsultant.code}&apos;s crisis solution. Once submitted, it locks permanently.
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
                const next = mvpValues.map((x, i) => (i === active ? e.target.value : x));
                const words = next.reduce((sum, item) => sum + item.trim().split(/\s+/).filter(Boolean).length, 0);
                if (words <= 700) setMvpValues(next);
              }}
              onBlur={() => {
                if (!submittedAt) {
                  dispatch({ type: "R3_PRODUCT_SAVE_MVP", productCode: code, parts: mvpValues });
                }
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
      End-to-end Product Round 3 flow (Shares &amp; Equity %): <b>1. Respond Live to Consultant&apos;s Equity Ask or Remove for Re-Bid (Money Auto-Calculated)</b> → <b>2. Pick 1 Exclusive Problem Statement (Least-Money Order)</b> → <b>3. Dispatched Live to Consultant → Receive Live Solution &amp; Submit New Round 3 MVP</b>.
    </div>
  </>;
}
