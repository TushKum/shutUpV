"use client";
import {useEffect,useMemo,useState} from "react";
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
  calcMoneyFromEquity,
  equityPctToShares,
  getConsultingR2Lock,
  getConsultingR2PendingLock,
  getOrMakeConsultant,
  getOrMakeProduct,
  getProductR2Lock,
  getR2Deal,
} from "../coordination-types";
import {ProductRound2} from "./product-round2";
import {FinanceRound2} from "./finance-round2";

const parts=["Diagnosis","Three options","Recommendation","Per-pack maths","Timeline","Risks"];
const consultingPlaceholders=[
  "Diagnose what this topic's crisis does to the locked Product team's unit economics, revenue and operations in concrete numbers.",
  "Outline three distinct turnaround options for the Product team, with the cost, trade-offs and expected effect of each.",
  "State the single collaborative recommendation for your locked Product team and why it wins.",
  "Work out the post-crisis unit economics (new price, unit cost, margin and break-even) after your fix.",
  "Provide a week-by-week collaborative execution timeline with clear milestones.",
  "Identify remaining operational or market risks and your contingency plan B.",
];

export default function Rescue(){
  const [track] = useDemoTrack();
  const code = useTeamCode();
  const { state, dispatch, ready } = useCoordination();

  // Extra equity % to ask above a Product team's offered equity (0 = accept base/initial equity)
  const [extraEquityPct, setExtraEquityPct] = useState<number>(1.0);
  const [dealFilter, setDealFilter] = useState<ListFilterState>(INITIAL_LIST_FILTER);
  const [active, setActive] = useState(0);
  const [values, setValues] = useState<string[]>(Array(6).fill(""));

  const consultant = useMemo(() => getOrMakeConsultant(state, code), [state, code]);
  const baseEquityPct = consultant.baseEquityPct;
  const baseShares = equityPctToShares(baseEquityPct);

  const candidates = useMemo(
    () => state.productOrder.map(pCode => state.products[pCode]!).filter(Boolean),
    [state.productOrder, state.products]
  );

  const lockedDeal = useMemo(() => getConsultingR2Lock(state, code), [state, code]);
  const lockedPartnerCode = lockedDeal?.productCode ?? null;
  const lockedPartner = useMemo(
    () => (lockedPartnerCode ? getOrMakeProduct(state, lockedPartnerCode) : null),
    [state, lockedPartnerCode]
  );

  const waitingLockDeal = useMemo(() => getConsultingR2PendingLock(state, code), [state, code]);
  const waitingLockCode = waitingLockDeal?.productCode ?? null;
  const isAnyLockedOrLockPending = lockedPartnerCode !== null || waitingLockCode !== null;

  useEffect(() => {
    if (!ready || !lockedDeal) return;
    const stored = lockedDeal.r2SolutionParts;
    if (stored && stored.length === 6 && stored.some(s => s.trim().length > 0)) {
      setValues(stored);
    } else if (!lockedDeal.r2SolutionSubmittedAt) {
      setValues(Array(6).fill(""));
    }
  }, [ready, lockedDeal?.key, lockedDeal?.r2SolutionSubmittedAt]);

  const incomingRequests = useMemo(() => {
    if (lockedPartnerCode) return [];
    return candidates.filter(cand => {
      const otherLock = getProductR2Lock(state, cand.code);
      if (otherLock && otherLock.consultingCode !== code) return false;
      const d = getR2Deal(state, cand.code, code);
      return (
        (d.lockInitiatedBy === "PRODUCT" && d.productLockAccepted && !d.consultingLockAccepted) ||
        d.stage === "PROPOSAL_SENT"
      );
    });
  }, [candidates, state, code, lockedPartnerCode]);

  const dealTeamOptions = useMemo(
    () =>
      candidates.map(c => {
        const d = getR2Deal(state, c.code, code);
        const eq = d.pendingEquityPct ?? d.currentEquityPct;
        const sh = d.pendingShares ?? d.currentShares;
        const val = d.pendingPrice ?? d.currentPrice;
        const badge =
          d.lockInitiatedBy === "PRODUCT" && d.productLockAccepted && !d.consultingLockAccepted
            ? " [LOCK REQ]"
            : d.stage === "PROPOSAL_SENT"
              ? " [OFFER]"
              : "";
        return {
          code: c.code,
          label: `${c.code} · ${c.company} — ${eq}% (${sh.toLocaleString()} sh · $${val.toLocaleString()})${badge}`,
        };
      }),
    [candidates, state, code]
  );

  const exactEquityLevels = useMemo(
    () =>
      uniqueSortedAmounts(
        candidates.map(c => {
          const d = getR2Deal(state, c.code, code);
          return d.pendingEquityPct ?? d.currentEquityPct;
        })
      ),
    [candidates, state, code]
  );

  const filteredCandidates = useMemo(() => {
    const list = candidates.filter(cand => {
      if (dealFilter.teamCode !== "ALL" && cand.code !== dealFilter.teamCode) return false;
      const d = getR2Deal(state, cand.code, code);
      const eq = d.pendingEquityPct ?? d.currentEquityPct;
      return matchesAmountFilter(eq, dealFilter);
    });
    if (dealFilter.sortBy === "EQUITY_DESC") {
      return [...list].sort((a, b) => {
        const pa = getR2Deal(state, a.code, code);
        const pb = getR2Deal(state, b.code, code);
        return (pb.pendingEquityPct ?? pb.currentEquityPct) - (pa.pendingEquityPct ?? pa.currentEquityPct);
      });
    }
    if (dealFilter.sortBy === "EQUITY_ASC") {
      return [...list].sort((a, b) => {
        const pa = getR2Deal(state, a.code, code);
        const pb = getR2Deal(state, b.code, code);
        return (pa.pendingEquityPct ?? pa.currentEquityPct) - (pb.pendingEquityPct ?? pb.currentEquityPct);
      });
    }
    if (dealFilter.sortBy === "VALUE_DESC") {
      return [...list].sort((a, b) => {
        const pa = getR2Deal(state, a.code, code);
        const pb = getR2Deal(state, b.code, code);
        return (pb.pendingPrice ?? pb.currentPrice) - (pa.pendingPrice ?? pa.currentPrice);
      });
    }
    if (dealFilter.sortBy === "CODE_ASC") {
      return [...list].sort((a, b) => a.code.localeCompare(b.code));
    }
    return [...list].sort((a, b) => {
      const score = (pCode: string) => {
        if (lockedPartnerCode === pCode) return 5;
        if (waitingLockCode === pCode) return 4;
        const d = getR2Deal(state, pCode, code);
        if (d.stage === "PROPOSAL_SENT" || d.stage === "COUNTER_DEMANDED" || d.stage === "DEAL_AGREED_UNLOCKED") return 3;
        if (d.lockInitiatedBy === "PRODUCT" && d.productLockAccepted) return 2;
        return 1;
      };
      return score(b.code) - score(a.code);
    });
  }, [candidates, state, code, dealFilter, lockedPartnerCode, waitingLockCode]);

  const activePartnerCode = lockedPartnerCode ?? waitingLockCode;
  const isActivePartnerHidden =
    activePartnerCode !== null && !filteredCandidates.some(c => c.code === activePartnerCode);

  const count = useMemo(
    () => values.reduce((n, v) => n + v.trim().split(/\s+/).filter(Boolean).length, 0),
    [values]
  );

  const submittedAt = lockedDeal?.r2SolutionSubmittedAt ?? null;

  const handlePushIncreasedEquity = (pCode: string) => {
    if (isAnyLockedOrLockPending) return;
    dispatch({
      type: "R2_CONSULTING_PUSH_DEMAND",
      productCode: pCode,
      consultingCode: code,
      extraEquityPct,
    });
  };

  const handleAcceptProposal = (pCode: string) => {
    if (isAnyLockedOrLockPending) return;
    dispatch({
      type: "R2_CONSULTING_ACCEPT_PROPOSAL",
      productCode: pCode,
      consultingCode: code,
    });
  };

  const handleSendLockRequest = (pCode: string) => {
    if (isAnyLockedOrLockPending) return;
    dispatch({
      type: "R2_SEND_LOCK_REQUEST",
      productCode: pCode,
      consultingCode: code,
      initiatedBy: "CONSULTING",
    });
  };

  const handleAcceptProductLockRequest = (pCode: string) => {
    if (isAnyLockedOrLockPending) return;
    dispatch({
      type: "R2_ACCEPT_LOCK_REQUEST",
      productCode: pCode,
      consultingCode: code,
      acceptedBy: "CONSULTING",
    });
  };

  const handleDeclineLockRequest = (pCode: string) => {
    dispatch({
      type: "R2_DECLINE_LOCK_REQUEST",
      productCode: pCode,
      consultingCode: code,
      declinedBy: "CONSULTING",
    });
  };

  const handleSaveDraft = (nextValues: string[]) => {
    setValues(nextValues);
    if (lockedPartnerCode && !submittedAt) {
      dispatch({
        type: "R2_CONSULTING_SAVE_SOLUTION",
        productCode: lockedPartnerCode,
        consultingCode: code,
        parts: nextValues,
      });
    }
  };

  const handleSubmit = () => {
    if (!lockedPartnerCode || submittedAt || count === 0) return;
    dispatch({
      type: "R2_CONSULTING_SUBMIT_SOLUTION",
      productCode: lockedPartnerCode,
      consultingCode: code,
      parts: values,
    });
  };

  if (track === "PRODUCT") {
    return <ProductRound2 />;
  }

  if (track !== "CONSULTING") {
    return <FinanceRound2 />;
  }

  const benchmarkEq = Number((baseEquityPct + extraEquityPct).toFixed(2));
  const benchmarkShares = equityPctToShares(benchmarkEq);
  const benchmarkCalcMoney = calcMoneyFromEquity(benchmarkEq, 11.8);

  return <>
    <PageTitle
      eyebrow={`ROUND 2 / SHARE & EQUITY NEGOTIATION, MUTUAL LOCK & SHARED CRISIS · ${code}`}
      title="Ask for company shares & equity, then mutually lock 1-to-1."
      sub="Instead of asking for raw money, your consultancy negotiates in Shares & Equity % with Product teams—and the money value is calculated automatically from shares × share price. Push an equity demand, complete a mutual 1:1 Lock Request, and deliver your crisis solution live."
    />

    <div className="guide-grid three">
      <Metric
        label="R1 BASE EQUITY RATE"
        value={`${baseEquityPct}% (${baseShares.toLocaleString()} sh)`}
        delta={`R1 SCORE ${consultant.r1Score}/100 · BENCHMARK ~$${consultant.baseValue.toLocaleString()}`}
      />
      <Metric
        label="YOUR EQUITY DEMAND"
        value={
          lockedDeal
            ? `${lockedDeal.currentEquityPct}% (${lockedDeal.currentShares.toLocaleString()} sh)`
            : `+${extraEquityPct}% EXTRA`
        }
        delta={
          lockedDeal
            ? `AUTO-CALC VALUE: $${lockedDeal.currentPrice.toLocaleString()} · LOCKED`
            : `PUSH TO ANY PRODUCT TEAM (CALC ~$${benchmarkCalcMoney.toLocaleString()})`
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
            ? `${lockedDeal!.currentEquityPct}% (${lockedDeal!.currentShares.toLocaleString()} SH · CALC $${lockedDeal!.currentPrice.toLocaleString()})`
            : waitingLockCode
              ? `AWAITING ${waitingLockCode} TO ACCEPT IN PRODUCT TAB…`
              : `${incomingRequests.length} INCOMING REQUEST${incomingRequests.length === 1 ? "" : "S"} LIVE`
        }
      />
    </div>

    <div className="guide-grid two mt-4">
      <Panel
        title="1. Set your share & equity demand (before locking)"
        tag={isAnyLockedOrLockPending ? "LOCKED / PENDING · NO FURTHER UPDATES" : `TEAM ${code} · EQUITY DEMAND`}
      >
        <p className="guide-muted">
          Your Round 1 evaluation score (<b>{consultant.r1Score} / 100</b>) sets Team <b>{code}&apos;s</b> base rate at <b>{baseEquityPct}% equity ({baseShares.toLocaleString()} shares)</b>. Choose how much extra equity % to ask above a Product team&apos;s offer—money is calculated automatically from <b>shares × share price</b>.
        </p>

        <label className="guide-label">SELECT EXTRA EQUITY TO ASK (0% = BASE OFFER OR +EXTRA EQUITY %)</label>
        <div className="guide-tabs">
          {[0, 0.5, 1, 1.5, 2, 3].map(extra => (
            <button
              key={extra}
              type="button"
              disabled={isAnyLockedOrLockPending}
              className={extraEquityPct === extra ? "active" : ""}
              onClick={() => setExtraEquityPct(extra)}
            >
              {extra === 0
                ? `BASE (0% EXTRA · ${baseEquityPct}%)`
                : `+${extra}% EQUITY (+${equityPctToShares(extra).toLocaleString()} sh)`}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="guide-label">CUSTOM EXTRA EQUITY (%)</label>
            <input
              type="number"
              min={0}
              max={25}
              step={0.1}
              disabled={isAnyLockedOrLockPending}
              className="guide-input font-mono"
              value={extraEquityPct}
              onChange={e => setExtraEquityPct(Math.max(0, Math.min(25, Number(e.target.value) || 0)))}
            />
          </div>
          <div>
            <label className="guide-label">EXAMPLE ON $11.80/SH COMPANY</label>
            <input
              type="text"
              readOnly
              className="guide-input font-mono"
              value={`${benchmarkEq}% (${benchmarkShares.toLocaleString()} sh · $${benchmarkCalcMoney.toLocaleString()})`}
            />
          </div>
        </div>

        <div className="guide-alert mt-4">
          <b>How Shares &amp; Equity Negotiation Works:</b>
          <br />
          1. <b>Push Equity Demand:</b> Asks the Product team for more company equity &amp; shares (money equivalent auto-calculates from their share price). Deal stays <b>unlocked</b> until a Lock Request is accepted by both teams.
          <br />
          2. <b>Mutual 1:1 Lock Request:</b> Once both teams accept the Lock Request, those shares &amp; equity lock permanently 1-to-1 and unlock their shared crisis below.
        </div>
      </Panel>

      <Panel title="2. Product team offered equity deals & lock requests" tag="DEAL IN SHARES & EQUITY · AUTO-CALC $">
        {incomingRequests.length > 0 && !isAnyLockedOrLockPending && (
          <div className="guide-alert guide-warning mb-3 flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>⚡ Live incoming request{incomingRequests.length > 1 ? "s" : ""}:</b>{" "}
              {incomingRequests.map(c => c.code).join(", ")} sent a live equity offer or Lock Request to Team {code}.
            </span>
            <button
              type="button"
              className="guide-btn secondary guide-filter-reset"
              onClick={() => setDealFilter({ ...INITIAL_LIST_FILTER, teamCode: incomingRequests[0]!.code })}
            >
              JUMP TO {incomingRequests[0]!.code}
            </button>
          </div>
        )}

        <ListFilterBar
          value={dealFilter}
          onChange={setDealFilter}
          teamOptions={dealTeamOptions}
          teamLabel="PRODUCT TEAM CODE"
          allTeamsLabel="All Product Teams"
          valueKind="EQUITY"
          amountLabel="OFFERED EQUITY % / SHARES"
          amountRanges={buildEquityRanges()}
          exactAmounts={exactEquityLevels}
          sortOptions={[
            { value: "DEFAULT", label: "Live Requests First" },
            { value: "EQUITY_DESC", label: "Equity %: High → Low" },
            { value: "VALUE_DESC", label: "Calculated $: High → Low" },
            { value: "EQUITY_ASC", label: "Equity %: Low → High" },
            { value: "CODE_ASC", label: "Team Code: A → Z" },
          ]}
          totalCount={candidates.length}
          filteredCount={filteredCandidates.length}
          itemNoun="product teams"
        />

        {isActivePartnerHidden && activePartnerCode && (
          <div className="guide-alert mb-3 flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>{lockedPartnerCode ? `🔒 Locked 1:1 with ${activePartnerCode}` : `● Lock request pending with ${activePartnerCode}`}</b> — currently hidden by your active filter.
            </span>
            <button
              type="button"
              className="guide-btn secondary guide-filter-reset"
              onClick={() => setDealFilter({ ...INITIAL_LIST_FILTER, teamCode: activePartnerCode })}
            >
              SHOW {activePartnerCode}
            </button>
          </div>
        )}

        <div className="guide-scroll-box space-y-3">
          {filteredCandidates.length === 0 ? (
            <EmptyFilterState noun="product teams" onReset={() => setDealFilter(INITIAL_LIST_FILTER)} />
          ) : (
            filteredCandidates.map(cand => {
              const d = getR2Deal(state, cand.code, code);
              const productLockedElsewhere = getProductR2Lock(state, cand.code);
              const isLockedByOtherConsultant =
                productLockedElsewhere !== null && productLockedElsewhere.consultingCode !== code;
              const isThisLocked = lockedPartnerCode === cand.code;
              const isThisWaitingLock = waitingLockCode === cand.code;
              const isClosedByOtherLock =
                (isAnyLockedOrLockPending && !isThisLocked && !isThisWaitingLock) || isLockedByOtherConsultant;
              const pushedEq = Number(((d.initialOfferEquityPct || baseEquityPct) + extraEquityPct).toFixed(2));
              const pushedShares = equityPctToShares(pushedEq, cand.totalShares);
              const pushedCalcMoney = calcMoneyFromEquity(pushedEq, cand.sharePrice, cand.totalShares);
              const isProductLockIncoming =
                d.lockInitiatedBy === "PRODUCT" && d.productLockAccepted && !d.consultingLockAccepted;
              const isSimulatedNpc = cand.code !== "XP01";

              return (
                <div
                  key={cand.code}
                  className="border border-[#294832] p-3.5"
                  style={{ opacity: isClosedByOtherLock ? 0.42 : 1 }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className={`guide-chip ${isThisLocked || isProductLockIncoming || d.stage === "PROPOSAL_SENT" ? "active" : ""}`}>
                        {cand.code} · {cand.ticker} · ${cand.sharePrice.toFixed(2)}/sh
                      </span>
                      <b className="ml-2 text-sm">{cand.company}</b>
                    </div>
                    <span className="guide-status">
                      {isThisLocked
                        ? `🔒 LOCKED 1:1 · ${d.currentEquityPct}% (${d.currentShares.toLocaleString()} sh)`
                        : isLockedByOtherConsultant
                          ? `CLOSED · ${cand.code} LOCKED WITH ${productLockedElsewhere!.consultingCode}`
                          : isThisWaitingLock
                            ? `● LOCK SENT TO ${cand.code} · AWAITING PRODUCT ACCEPTANCE…`
                            : isClosedByOtherLock
                              ? "CLOSED · 1:1 LOCKED WITH ANOTHER TEAM"
                              : isProductLockIncoming
                                ? `⚡ ${cand.code} SENT LOCK REQUEST (${d.currentEquityPct}% · ${d.currentShares.toLocaleString()} sh)!`
                                : d.stage === "PROPOSAL_SENT"
                                  ? `⚡ LIVE EQUITY OFFER FROM ${cand.code}: ${d.currentEquityPct}% (${d.currentShares.toLocaleString()} sh)`
                                  : d.stage === "COUNTER_DEMANDED"
                                    ? `● ASKED ${d.pendingEquityPct}% (+${d.pendingExtraEquityPct}% · ${d.pendingShares?.toLocaleString()} sh) · AWAITING ${cand.code}…`
                                    : d.stage === "DEAL_AGREED_UNLOCKED"
                                      ? `✓ AGREED AT ${d.currentEquityPct}% (${d.currentShares.toLocaleString()} sh) · UNLOCKED`
                                      : d.stage === "DECLINED"
                                        ? `✕ ${cand.code} DECLINED DEMAND · PUSH NEW EQUITY OR LOCK AT ${d.currentEquityPct}%`
                                        : `OFFERING ${d.initialOfferEquityPct}% EQUITY (${d.currentShares.toLocaleString()} sh)`}
                    </span>
                  </div>

                  <p className="guide-muted mt-1.5">
                    <b>Topic:</b> {cand.topic} · <b>Share Price:</b> ${cand.sharePrice.toFixed(2)} (100,000 shares)
                  </p>

                  {/* Shares, Equity & Auto-Calculated Money Strip */}
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-mono">
                    <div className="border border-[#294832] p-2">
                      <span className="block text-[#81a4d1]">EQUITY &amp; SHARES</span>
                      <b className="mt-1 block text-[#f0f7ff]">
                        {d.stage === "COUNTER_DEMANDED" && d.pendingEquityPct
                          ? `${d.pendingEquityPct}% (${d.pendingShares?.toLocaleString()} sh)`
                          : `${d.currentEquityPct}% (${d.currentShares.toLocaleString()} sh)`}
                      </b>
                    </div>
                    <div className="border border-[#294832] p-2">
                      <span className="block text-[#81a4d1]">CALCULATED VALUE</span>
                      <b className="mt-1 block text-[#63a8ff]">
                        ${(d.stage === "COUNTER_DEMANDED" && d.pendingPrice ? d.pendingPrice : d.currentPrice).toLocaleString()}
                      </b>
                    </div>
                    <div className="border border-[#294832] p-2">
                      <span className="block text-[#81a4d1]">LOCK STATUS</span>
                      <b className="mt-1 block text-[#f0f7ff]">
                        {isThisLocked
                          ? "🔒 BOTH ACCEPTED"
                          : isProductLockIncoming
                            ? `⚡ ${cand.code} LOCK REQ`
                            : d.consultingLockAccepted
                              ? `WAITING ${cand.code}`
                              : "NOT LOCKED"}
                      </b>
                    </div>
                  </div>

                  {!isClosedByOtherLock && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {!isThisLocked && !isThisWaitingLock && (
                        <>
                          {d.stage === "PROPOSAL_SENT" && (
                            <button
                              type="button"
                              className="guide-btn secondary"
                              onClick={() => handleAcceptProposal(cand.code)}
                            >
                              ACCEPT {d.currentEquityPct}% ({d.currentShares.toLocaleString()} SH · CALC ${d.currentPrice.toLocaleString()})
                            </button>
                          )}

                          <button
                            type="button"
                            className="guide-btn secondary"
                            onClick={() => handlePushIncreasedEquity(cand.code)}
                          >
                            {d.stage === "COUNTER_DEMANDED"
                              ? `UPDATE ASK TO ${pushedEq}% (${pushedShares.toLocaleString()} SH · $${pushedCalcMoney.toLocaleString()}) →`
                              : `ASK ${pushedEq}% EQUITY (+${extraEquityPct}% · ${pushedShares.toLocaleString()} SH · $${pushedCalcMoney.toLocaleString()}) →`}
                          </button>

                          {d.stage === "COUNTER_DEMANDED" && isSimulatedNpc && (
                            <button
                              type="button"
                              className="guide-btn secondary"
                              onClick={() =>
                                dispatch({
                                  type: "R2_PRODUCT_ACCEPT_DEMAND",
                                  productCode: cand.code,
                                  consultingCode: code,
                                })
                              }
                            >
                              SIMULATE {cand.code} ACCEPT ({d.pendingEquityPct}%)
                            </button>
                          )}

                          {isProductLockIncoming ? (
                            <>
                              <button
                                type="button"
                                className="guide-btn"
                                onClick={() => handleAcceptProductLockRequest(cand.code)}
                              >
                                ACCEPT LOCK REQUEST ({d.currentEquityPct}% · {d.currentShares.toLocaleString()} SH · ${d.currentPrice.toLocaleString()}) 🔒
                              </button>
                              <button
                                type="button"
                                className="guide-btn secondary"
                                onClick={() => handleDeclineLockRequest(cand.code)}
                              >
                                DECLINE LOCK
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={d.stage === "COUNTER_DEMANDED"}
                              className="guide-btn"
                              onClick={() => handleSendLockRequest(cand.code)}
                            >
                              SEND LOCK REQUEST ({d.currentEquityPct}% · {d.currentShares.toLocaleString()} SH) →
                            </button>
                          )}
                        </>
                      )}

                      {isThisWaitingLock && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="guide-status">
                            ● LOCK REQUEST SENT TO {cand.code} ({d.currentEquityPct}% · {d.currentShares.toLocaleString()} sh) · WAITING FOR {cand.code}…
                          </span>
                          <button
                            type="button"
                            className="guide-btn secondary"
                            onClick={() => handleDeclineLockRequest(cand.code)}
                          >
                            CANCEL LOCK REQUEST
                          </button>
                          {isSimulatedNpc && (
                            <button
                              type="button"
                              className="guide-btn secondary"
                              onClick={() =>
                                dispatch({
                                  type: "R2_ACCEPT_LOCK_REQUEST",
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
                          🔒 PERMANENTLY LOCKED 1:1 ({d.lockedAt}) · {d.currentEquityPct}% ({d.currentShares.toLocaleString()} SHARES · CALC ${d.currentPrice.toLocaleString()})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Panel>
    </div>

    {!lockedPartner || !lockedDeal ? (
      <div className="mt-4">
        <Panel title="3. Shared product topic crisis & collaborative solution" tag="LOCKED UNTIL BOTH TEAMS ACCEPT LOCK REQUEST">
          <div className="guide-alert guide-warning">
            <b>
              {waitingLockCode
                ? `Lock Request Sent to ${waitingLockCode} — Waiting for ${waitingLockCode} to Accept Lock Request in Their Product Workspace…`
                : "Not Locked Yet — Negotiate Shares & Equity and Complete a Mutual 1:1 Lock Request Above"}
            </b>
            <br />
            1. Negotiate your equity &amp; share stake with any Product team above (money value calculates automatically from shares × share price).
            <br />
            2. Once a <b>Lock Request</b> is accepted by <b>both</b> Team {code} and the Product team, you lock permanently 1-to-1 and unlock their shared crisis below.
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
            <p className="guide-muted mt-1">
              <b>Product Pitch:</b> {lockedPartner.pitchLine}
            </p>
            <div className="guide-alert guide-warning mt-3">
              <b>{lockedPartner.crisisCategory}</b>
              <br />
              <b>{lockedPartner.crisisTitle}:</b> {lockedPartner.crisisBody}
            </div>
            <p className="guide-muted mt-3">{lockedPartner.baselineContext}</p>
          </Panel>

          <Panel
            title="1:1 Locked equity collaboration details"
            tag={`PERMANENT 1:1 LOCK · ${code} ⇄ ${lockedPartner.code}`}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>EQUITY &amp; SHARES EARNED</small>
                <b>{lockedDeal.currentEquityPct}%</b>
                <span>{lockedDeal.currentShares.toLocaleString()} SHARES @ ${lockedPartner.sharePrice.toFixed(2)}</span>
              </div>
              <div className="guide-metric">
                <small>AUTO-CALCULATED VALUE</small>
                <b>${lockedDeal.currentPrice.toLocaleString()}</b>
                <span>{lockedPartner.code} · {lockedPartner.ticker}</span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>LOCKED PAIR</small>
                <b className="text-lg">{code} ⇄ {lockedPartner.code}</b>
                <span>PERMANENT 1:1 LOCK ✓</span>
              </div>
              <div className="guide-metric">
                <small>LIVE HANDOFF STATUS</small>
                <b className="text-lg">{submittedAt ? "DELIVERED ✓" : "WRITING"}</b>
                <span>
                  {lockedPartner.r2MvpSubmittedAt
                    ? `${lockedPartner.code} SUBMITTED MVP ✓`
                    : submittedAt
                      ? `SENT TO ${lockedPartner.code} (${submittedAt})`
                      : `AWAITING YOUR SOLUTION`}
                </span>
              </div>
            </div>
            <p className="guide-muted mt-3">
              Both <b>Team {code}</b> and <b>Product Team {lockedPartner.code} ({lockedPartner.company})</b> are locked 1-to-1 for <b>{lockedDeal.currentEquityPct}% equity ({lockedDeal.currentShares.toLocaleString()} shares · calculated value ${lockedDeal.currentPrice.toLocaleString()})</b>. Submitting your 6-part solution delivers it immediately to <b>{lockedPartner.code}&apos;s</b> Updated MVP workspace.
            </p>
          </Panel>
        </div>

        <div className="mt-4">
          <Panel
            title={`Collaborative crisis solution editor for ${lockedPartner.company} (${lockedPartner.ticker})`}
            tag="6 PARTS · 500 WORDS TOTAL · DELIVERS LIVE TO PRODUCT TEAM"
          >
            {submittedAt && (
              <div className="guide-alert mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <b>✓ Round 2 crisis solution permanently submitted ({code} ⇄ {lockedPartner.code})</b> · Finalized at {submittedAt} ({count} words) and delivered live to <b>{lockedPartner.code}&apos;s</b> Updated MVP editor.
                </div>
                <span className="guide-chip active">DELIVERED LIVE ✓</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="guide-muted">
                Solving {lockedPartner.company}&apos;s crisis ({lockedPartner.crisisCategory}) · Submitting sends all 6 parts live to {lockedPartner.code}.
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
              onBlur={() => handleSaveDraft(values)}
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
                    handleSaveDraft(values);
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
                    handleSaveDraft(values);
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
                {submittedAt ? "SOLUTION DELIVERED TO PRODUCT ✓" : "SUBMIT & DELIVER SOLUTION TO PRODUCT →"}
              </button>
            </div>
          </Panel>
        </div>
      </>
    )}

    <div className="guide-alert mt-4">
      Round 2 Share &amp; Equity flow: <b>1. Product Equity Offer</b> → <b>2. Push Higher Equity/Shares Demand (Auto-Calc $)</b> → <b>3. Mutual 1:1 Lock Request</b> → <b>4. Deliver Live Crisis Solution to Product&apos;s MVP</b>.
    </div>
  </>;
}
