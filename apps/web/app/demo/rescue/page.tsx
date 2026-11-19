"use client";
import {useEffect,useMemo,useState} from "react";
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

  const [markupPct, setMarkupPct] = useState<number>(10);
  const [dealFilter, setDealFilter] = useState<ListFilterState>(INITIAL_LIST_FILTER);
  const [active, setActive] = useState(0);
  const [values, setValues] = useState<string[]>(Array(6).fill(""));

  const consultant = useMemo(() => getOrMakeConsultant(state, code), [state, code]);
  const baseValuation = consultant.baseValue;

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

  // Sync collaborative R2 solution editor when lock or submitted state changes
  useEffect(() => {
    if (!ready || !lockedDeal) return;
    const stored = lockedDeal.r2SolutionParts;
    if (stored && stored.length === 6 && stored.some(s => s.trim().length > 0)) {
      setValues(stored);
    } else if (!lockedDeal.r2SolutionSubmittedAt) {
      setValues(Array(6).fill(""));
    }
  }, [ready, lockedDeal?.key, lockedDeal?.r2SolutionSubmittedAt]);

  // Incoming live requests (proposals or lock requests from Product teams)
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
        const price = d.pendingPrice ?? d.currentPrice;
        const badge =
          d.lockInitiatedBy === "PRODUCT" && d.productLockAccepted && !d.consultingLockAccepted
            ? " [LOCK REQ]"
            : d.stage === "PROPOSAL_SENT"
              ? " [PROPOSAL]"
              : "";
        return { code: c.code, label: `${c.code} · ${c.company} ($${price.toLocaleString()})${badge}` };
      }),
    [candidates, state, code]
  );

  const exactDealAmounts = useMemo(
    () =>
      uniqueSortedAmounts(
        candidates.map(c => {
          const d = getR2Deal(state, c.code, code);
          return d.pendingPrice ?? d.currentPrice;
        })
      ),
    [candidates, state, code]
  );

  const filteredCandidates = useMemo(() => {
    const list = candidates.filter(cand => {
      if (dealFilter.teamCode !== "ALL" && cand.code !== dealFilter.teamCode) return false;
      const d = getR2Deal(state, cand.code, code);
      const price = d.pendingPrice ?? d.currentPrice;
      return matchesAmountFilter(price, dealFilter);
    });
    if (dealFilter.sortBy === "AMOUNT_DESC") {
      return [...list].sort((a, b) => {
        const pa = getR2Deal(state, a.code, code);
        const pb = getR2Deal(state, b.code, code);
        return (pb.pendingPrice ?? pb.currentPrice) - (pa.pendingPrice ?? pa.currentPrice);
      });
    }
    if (dealFilter.sortBy === "AMOUNT_ASC") {
      return [...list].sort((a, b) => {
        const pa = getR2Deal(state, a.code, code);
        const pb = getR2Deal(state, b.code, code);
        return (pa.pendingPrice ?? pa.currentPrice) - (pb.pendingPrice ?? pb.currentPrice);
      });
    }
    if (dealFilter.sortBy === "CODE_ASC") {
      return [...list].sort((a, b) => a.code.localeCompare(b.code));
    }
    // Default sort: bubble active/locked or live-negotiating deals (like XP01 proposals/locks) to top for effortless testing
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

  const handlePushIncreasedDeal = (pCode: string) => {
    if (isAnyLockedOrLockPending) return;
    dispatch({
      type: "R2_CONSULTING_PUSH_DEMAND",
      productCode: pCode,
      consultingCode: code,
      markupPct,
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
    return <><PageTitle eyebrow={`ROUND 2 / RESCUE · ${track}`} title="Rescue another company." sub="Your rescue lottery assignment is AquaCare (QAAC). Read its PRD and crisis card, use the public Q&A board, then write a six-part crisis solution."/><div className="guide-grid two"><Panel title="The company you rescue" tag="QAAC · YOUR ASSIGNMENT"><h2 className="text-xl font-semibold">AquaCare</h2><p className="guide-muted mt-1">Built by Team QAAC · PRD score 68 · post-IPO price $11.80</p><div className="guide-alert guide-warning mt-4"><b>CRISIS CARD · TAX CHANGE</b><br/>The GST on your product category rises from 12% to 18% from next month. Shops will take a larger margin.</div><p className="guide-muted mt-3">Review their product requirements document and the financial assumptions before choosing a response.</p></Panel><Panel title="Your own company" tag="FRPK · YOU BUILT"><h2 className="text-xl font-semibold">FreshPack Foods</h2><p className="guide-muted mt-1">Your company has also received its own crisis card. Team QAAC is assigned to rescue it.</p><div className="guide-alert mt-4"><b>YOUR CRISIS CARD · QUALITY FAILURE</b><br/>A batch fails a safety test. One batch fails a food or product safety test. You must recall it from shops, and the news is spreading on social media.</div><p className="guide-muted mt-3">Your Round 2 points come from the solution you write for QAAC, not from how well another team rescues your company.</p></Panel></div><div className="mt-4"><Panel title="Crisis solution editor" tag="6 PARTS · 500 WORDS TOTAL"><div className="flex items-center justify-between"><p className="guide-muted">Autosaves locally · no submit button</p><b className={count>500?"text-red-400":"guide-status"}>{count} / 500 WORDS</b></div><div className="guide-tabs mt-4">{parts.map((p,i)=><button key={p} type="button" className={active===i?"active":""} onClick={()=>setActive(i)}>{String(i+1).padStart(2,"0")} · {p}</button>)}</div><label className="guide-label">{parts[active]!.toUpperCase()}</label><textarea className="guide-textarea" value={values[active]} onChange={e=>setValues(v=>{const next=v.map((x,i)=>i===active?e.target.value:x);const words=next.reduce((sum,item)=>sum+item.trim().split(/\s+/).filter(Boolean).length,0);return words<=500?next:v})} placeholder={"Write your "+parts[active]!.toLowerCase()+"…"} /><div className="mt-3 flex justify-between"><span className="guide-muted">{values[active]!.trim().split(/\s+/).filter(Boolean).length} words in this part</span><span className="guide-status">● AUTOSAVED IN THIS BROWSER</span></div><div className="mt-4 flex justify-between"><button type="button" className="guide-btn secondary" disabled={active===0} onClick={()=>setActive(v=>v-1)}>← PREVIOUS</button><button type="button" className="guide-btn" disabled={active===5} onClick={()=>setActive(v=>v+1)}>NEXT PART →</button></div></Panel></div><div className="guide-alert mt-4">Rescue solution locks at 01:45 IST. AI judging reads your solution together with the rescued company&apos;s PRD and crisis card. Judges see only the ticker, not team or company names.</div></>;
    return <FinanceRound2 />;
  }

  return <>
    <PageTitle
      eyebrow={`ROUND 2 / LIVE END-TO-END NEGOTIATION, MUTUAL LOCK & SHARED CRISIS · ${code}`}
      title="Push your deal demand, then mutually lock 1-to-1."
      sub="Live two-way coordination with Product teams: receive proposals or offered deals, push an increased demand (updates live on the Product team's screen—still unlocked), then send or accept a 1-to-1 Lock Request. Once both teams accept, you lock permanently and your written crisis solution flows live into the Product team's MVP."
    />

    <div className="guide-grid three">
      <Metric
        label="ROUND 1 BASE VALUATION"
        value={`$${baseValuation.toLocaleString()}`}
        delta={`R1 SCORE ${consultant.r1Score} / 100 · ${consultant.r1SubmittedAt ? "R1 SUBMITTED ✓" : "STARTING BENCHMARK"}`}
      />
      <Metric
        label="YOUR DEMAND MARKUP"
        value={lockedDeal ? `+${lockedDeal.currentMarkupPct}% ($${lockedDeal.currentPrice.toLocaleString()})` : `+${markupPct}%`}
        delta={
          lockedDeal
            ? "LOCKED DEAL PRICE · CANNOT BE UPDATED"
            : "PUSH LIVE TO ANY PRODUCT TEAM TO UPDATE PRICE"
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
            ? `MUTUALLY LOCKED WITH ${lockedPartner.code} AT $${lockedDeal!.currentPrice.toLocaleString()}`
            : waitingLockCode
              ? `AWAITING ${waitingLockCode} TO ACCEPT IN PRODUCT TAB…`
              : `${incomingRequests.length} INCOMING REQUEST${incomingRequests.length === 1 ? "" : "S"} LIVE`
        }
      />
    </div>

    <div className="guide-grid two mt-4">
      <Panel
        title="1. Increase your demand (before locking)"
        tag={isAnyLockedOrLockPending ? "LOCKED / PENDING · NO FURTHER UPDATES" : `TEAM ${code} · DEAL MARKUP`}
      >
        <p className="guide-muted">
          Your Round 1 evaluation score (<b>{consultant.r1Score} / 100</b>) gave Team <b>{code}</b> a base value of <b>${baseValuation.toLocaleString()}</b>. Choose a percentage increase below and click <b>Push Deal</b> on any Product team—they receive your counter-demand live on their screen.
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
              {pct === 0 ? `BASE (0% · $${baseValuation.toLocaleString()})` : `+${pct}% DEMAND`}
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
            <label className="guide-label">EXAMPLE ON ${baseValuation.toLocaleString()} OFFER</label>
            <input
              type="text"
              readOnly
              className="guide-input font-mono"
              value={`$${Math.round(baseValuation * (1 + markupPct / 100)).toLocaleString()} (+${markupPct}%)`}
            />
          </div>
        </div>

        <div className="guide-alert mt-4">
          <b>Live End-to-End Flow (Consulting ⇄ Product):</b>
          <br />
          1. <b>Push Demand:</b> Sends your higher price directly to the Product team&apos;s workspace. When they click <b>Accept</b>, the deal updates live (<b>still unlocked</b>).
          <br />
          2. <b>Mutual 1:1 Lock Request:</b> Either side sends a <b>Lock Request</b>; the other team accepts it live in their workspace. Once both accept, you lock permanently 1:1 and unlock their shared crisis below.
        </div>
      </Panel>

      <Panel title="2. Product team offered deals & lock requests" tag="LIVE TWO-WAY SYNC · MUTUALLY LOCK 1:1">
        {incomingRequests.length > 0 && !isAnyLockedOrLockPending && (
          <div className="guide-alert guide-warning mb-3 flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>⚡ Live incoming request{incomingRequests.length > 1 ? "s" : ""}:</b>{" "}
              {incomingRequests.map(c => c.code).join(", ")} sent a live proposal or Lock Request to Team {code}.
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
          amountLabel="OFFERED DEAL AMOUNT"
          amountRanges={buildDealAmountRanges()}
          exactAmounts={exactDealAmounts}
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
              const pushedPreviewAmount = Math.round((d.initialOffer || baseValuation) * (1 + markupPct / 100));
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
                        {cand.code} · {cand.ticker}
                      </span>
                      <b className="ml-2 text-sm">{cand.company}</b>
                    </div>
                    <span className="guide-status">
                      {isThisLocked
                        ? `🔒 LOCKED 1:1 AT $${d.currentPrice.toLocaleString()} · PERMANENT`
                        : isLockedByOtherConsultant
                          ? `CLOSED · ${cand.code} LOCKED WITH ${productLockedElsewhere!.consultingCode}`
                          : isThisWaitingLock
                            ? `● LOCK SENT TO ${cand.code} · AWAITING PRODUCT ACCEPTANCE…`
                            : isClosedByOtherLock
                              ? "CLOSED · 1:1 LOCKED WITH ANOTHER TEAM"
                              : isProductLockIncoming
                                ? `⚡ ${cand.code} SENT LOCK REQUEST AT $${d.currentPrice.toLocaleString()}!`
                                : d.stage === "PROPOSAL_SENT"
                                  ? `⚡ LIVE PROPOSAL FROM ${cand.code} AT $${d.currentPrice.toLocaleString()}`
                                  : d.stage === "COUNTER_DEMANDED"
                                    ? `● PUSHED +${d.pendingMarkupPct}% ($${d.pendingPrice?.toLocaleString()}) · AWAITING ${cand.code}…`
                                    : d.stage === "DEAL_AGREED_UNLOCKED"
                                      ? `✓ DEAL AGREED AT $${d.currentPrice.toLocaleString()} (+${d.currentMarkupPct}%) · UNLOCKED`
                                      : d.stage === "DECLINED"
                                        ? `✕ ${cand.code} DECLINED DEMAND · PUSH NEW PRICE OR LOCK AT $${d.currentPrice.toLocaleString()}`
                                        : `OFFERED DEAL: $${d.initialOffer.toLocaleString()} · NOT LOCKED`}
                    </span>
                  </div>

                  <p className="guide-muted mt-1.5">
                    <b>Topic:</b> {cand.topic} · <b>Initial Offer:</b> ${d.initialOffer.toLocaleString()}
                    {cand.r1SubmittedAt ? ` · R1 MVP ✓` : ""}
                  </p>

                  {/* Deal & Lock Status Boxes */}
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-mono">
                    <div className="border border-[#294832] p-2">
                      <span className="block text-[#81a4d1]">ACTIVE DEAL PRICE</span>
                      <b className="mt-1 block text-[#f0f7ff]">
                        ${d.currentPrice.toLocaleString()}{" "}
                        {d.stage === "COUNTER_DEMANDED" && d.pendingPrice
                          ? `→ ASK $${d.pendingPrice.toLocaleString()}`
                          : d.currentMarkupPct > 0
                            ? `(+${d.currentMarkupPct}%)`
                            : "(BASE/OFFER)"}
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
                          ? isProductLockIncoming
                            ? "⚡ SENT LOCK REQUEST"
                            : "✓ LOCK ACCEPTED"
                          : "NOT LOCKED"}
                      </b>
                    </div>
                  </div>

                  {/* Live Action Buttons */}
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
                              ACCEPT ${d.currentPrice.toLocaleString()} OFFER (UNLOCKED)
                            </button>
                          )}

                          <button
                            type="button"
                            className="guide-btn secondary"
                            onClick={() => handlePushIncreasedDeal(cand.code)}
                          >
                            {d.stage === "COUNTER_DEMANDED"
                              ? `UPDATE DEMAND TO +${markupPct}% ($${pushedPreviewAmount.toLocaleString()}) →`
                              : `PUSH +${markupPct}% DEAL ($${pushedPreviewAmount.toLocaleString()}) TO ${cand.code} →`}
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
                              SIMULATE {cand.code} ACCEPT (+{d.pendingMarkupPct}%)
                            </button>
                          )}

                          {isProductLockIncoming ? (
                            <>
                              <button
                                type="button"
                                className="guide-btn"
                                onClick={() => handleAcceptProductLockRequest(cand.code)}
                              >
                                ACCEPT LOCK REQUEST FROM {cand.code} AT ${d.currentPrice.toLocaleString()} 🔒
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
                              SEND LOCK REQUEST TO {cand.code} AT ${d.currentPrice.toLocaleString()} →
                            </button>
                          )}
                        </>
                      )}

                      {isThisWaitingLock && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="guide-status">
                            ● LOCK REQUEST SENT TO {cand.code} AT ${d.currentPrice.toLocaleString()} · WAITING FOR {cand.code} TO ACCEPT IN PRODUCT WORKSPACE…
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
                                  bypassCashCheck: true,
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
                          🔒 BOTH TEAMS ACCEPTED LOCK REQUEST ({d.lockedAt}) · PERMANENTLY LOCKED AT ${d.currentPrice.toLocaleString()} · SHARED CRISIS UNLOCKED BELOW
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
                : "Not Locked Yet — Negotiate Price & Complete a Mutual 1:1 Lock Request Above"}
            </b>
            <br />
            1. When a Product team sends you a proposal or you push an increased demand (<b>+{markupPct}%</b>), they see it instantaneously in their Product Round 2 workspace.
            <br />
            2. Once a <b>Lock Request</b> is accepted by <b>both</b> Team {code} and the Product team, both screens lock permanently 1-to-1 and unlock the shared crisis below.
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
                <b className="text-lg">${lockedDeal.currentPrice.toLocaleString()}</b>
                <span>
                  {lockedDeal.currentMarkupPct > 0 ? `+${lockedDeal.currentMarkupPct}% INCREASED DEAL` : "BASE / INITIAL DEAL"} · PERMANENT
                </span>
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
              Both <b>Team {code}</b> and <b>Product Team {lockedPartner.code} ({lockedPartner.company})</b> are locked 1-to-1 at <b>${lockedDeal.currentPrice.toLocaleString()}</b>. When you submit your 6-part crisis solution below, it is delivered immediately into <b>{lockedPartner.code}&apos;s</b> Round 2 MVP workspace.
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
      End-to-end Round 2 coordination: <b>1. Product Proposal / Offered Deal</b> → <b>2. Push Demand (Product Accepts Live)</b> → <b>3. Mutual 1:1 Lock Request</b> → <b>4. Submit Crisis Solution (Delivered Live to Product&apos;s MVP)</b>.
    </div>
  </>;
}
