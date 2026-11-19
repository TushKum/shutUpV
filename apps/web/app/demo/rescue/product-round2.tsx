"use client";
import {useEffect,useMemo,useState} from "react";
import {PageTitle,Panel,Metric,useTeamCode} from "../ui";
import {
  EmptyFilterState,
  INITIAL_LIST_FILTER,
  ListFilterBar,
  buildCapitalAmountRanges,
  buildDealAmountRanges,
  matchesAmountFilter,
  uniqueSortedAmounts,
  type ListFilterState,
} from "../list-filter-bar";
import {useCoordination} from "../coordination-store";
import {
  getConsultingR2Lock,
  getOrMakeConsultant,
  getOrMakeProduct,
  getProductAvailableCash,
  getProductR2Lock,
  getProductR2PendingLock,
  getR2Deal,
} from "../coordination-types";

const mvpUpdateParts = [
  "Crisis Impact on Our MVP",
  "Consulting Solution Adopted",
  "Revised MVP Features & Spec",
  "Updated Unit Maths & Pricing",
  "Rollout & Recovery Timeline",
  "Residual Risks & Mitigations",
];

const mvpUpdateGuides = [
  "Explain how the Round 2 crisis breaks your original Round 1 MVP economics.",
  "Write how your Product team adopts and integrates your locked Consulting team's crisis solution directly into your product strategy.",
  "Detail the exact changes to your MVP features, SKU / pack architecture, or user experience based on the consultant's solution.",
  "Show the revised pricing, unit cost, tax/margin impact and break-even numbers in your updated MVP.",
  "Lay out the week-by-week timeline to ship these MVP updates and recover market share.",
  "List remaining risks after updating the MVP and your fallback plan.",
];

const consultingPartLabels = [
  "01 · DIAGNOSIS",
  "02 · THREE OPTIONS",
  "03 · RECOMMENDED SOLUTION",
  "04 · PER-PACK MATHS",
  "05 · TIMELINE",
  "06 · RISKS & FALLBACK",
];

export function ProductRound2() {
  const code = useTeamCode();
  const { state, dispatch, ready } = useCoordination();

  const product = useMemo(() => getOrMakeProduct(state, code), [state, code]);
  const financeTeams = state.financeTeams;
  const consultingTeams = useMemo(
    () => state.consultantOrder.map(cCode => state.consultants[cCode]!).filter(Boolean),
    [state.consultantOrder, state.consultants]
  );

  // Fundraising inputs
  const [reqAmountInput, setReqAmountInput] = useState<string>("");
  const [reqEquityInput, setReqEquityInput] = useState<string>("");
  const [raiseNote, setRaiseNote] = useState<string>("");
  const reqAmount = Math.max(0, Number(reqAmountInput) || 0);
  const reqEquityPct = Math.max(0, Number(reqEquityInput) || 0);

  // Filters
  const [financeFilter, setFinanceFilter] = useState<ListFilterState>(INITIAL_LIST_FILTER);
  const [consultingFilter, setConsultingFilter] = useState<ListFilterState>(INITIAL_LIST_FILTER);

  // MVP update editor
  const [active, setActive] = useState(0);
  const [mvpValues, setMvpValues] = useState<string[]>(Array(6).fill(""));

  useEffect(() => {
    if (!ready) return;
    if (product.r2MvpParts.length === 6 && product.r2MvpParts.some(s => s.trim().length > 0)) {
      setMvpValues(product.r2MvpParts);
    } else if (!product.r2MvpSubmittedAt) {
      setMvpValues(Array(6).fill(""));
    }
  }, [ready, code, product.r2MvpSubmittedAt, state.version === 1]);

  const lockedDeal = useMemo(() => getProductR2Lock(state, code), [state, code]);
  const lockedFirmCode = lockedDeal?.consultingCode ?? null;
  const lockedFirm = useMemo(
    () => (lockedFirmCode ? getOrMakeConsultant(state, lockedFirmCode) : null),
    [state, lockedFirmCode]
  );

  const lockWaitingDeal = useMemo(() => getProductR2PendingLock(state, code), [state, code]);
  const lockWaitingFirmCode = lockWaitingDeal?.consultingCode ?? null;
  const isLockedOrLockPending = lockedFirmCode !== null || lockWaitingFirmCode !== null;

  const raisedCash = product.raisedCash;
  const equityGivenPct = product.equityGivenPct;
  const availableCash = useMemo(() => getProductAvailableCash(state, code), [state, code]);
  const equityRetainedPct = Math.max(0, Number((100 - equityGivenPct).toFixed(2)));
  const impliedValuation = reqEquityPct > 0 ? Math.round(reqAmount / (reqEquityPct / 100)) : 0;
  const submittedAt = product.r2MvpSubmittedAt;

  // Incoming live updates from Consulting teams (counter-demands or lock requests)
  const incomingConsultingActions = useMemo(() => {
    if (lockedFirmCode) return [];
    return consultingTeams.filter(firm => {
      const otherLock = getConsultingR2Lock(state, firm.code);
      if (otherLock && otherLock.productCode !== code) return false;
      const d = getR2Deal(state, code, firm.code);
      return (
        d.stage === "COUNTER_DEMANDED" ||
        (d.lockInitiatedBy === "CONSULTING" && d.consultingLockAccepted && !d.productLockAccepted)
      );
    });
  }, [consultingTeams, state, code, lockedFirmCode]);

  // ── FINANCE TEAMS FILTER MEMOS ──
  const financeTeamOptions = useMemo(
    () =>
      financeTeams.map(ft => ({
        code: ft.code,
        label: `${ft.code} · ${ft.name} ($${ft.availableCapital.toLocaleString()})`,
      })),
    [financeTeams]
  );

  const exactFinanceAmounts = useMemo(
    () => uniqueSortedAmounts(financeTeams.map(ft => ft.availableCapital)),
    [financeTeams]
  );

  const filteredFinanceTeams = useMemo(() => {
    const list = financeTeams.filter(ft => {
      if (financeFilter.teamCode !== "ALL" && ft.code !== financeFilter.teamCode) return false;
      return matchesAmountFilter(ft.availableCapital, financeFilter);
    });
    if (financeFilter.sortBy === "AMOUNT_DESC") return [...list].sort((a, b) => b.availableCapital - a.availableCapital);
    if (financeFilter.sortBy === "AMOUNT_ASC") return [...list].sort((a, b) => a.availableCapital - b.availableCapital);
    if (financeFilter.sortBy === "CODE_ASC") return [...list].sort((a, b) => a.code.localeCompare(b.code));
    return list;
  }, [financeTeams, financeFilter]);

  // ── CONSULTING TEAMS FILTER MEMOS ──
  const consultingTeamOptions = useMemo(
    () =>
      consultingTeams.map(firm => {
        const d = getR2Deal(state, code, firm.code);
        const price = d.pendingPrice ?? d.currentPrice;
        const tag =
          d.lockInitiatedBy === "CONSULTING" && d.consultingLockAccepted && !d.productLockAccepted
            ? " [LOCK REQ]"
            : d.stage === "COUNTER_DEMANDED"
              ? ` [+${d.pendingMarkupPct}% ASK]`
              : "";
        return {
          code: firm.code,
          label: `${firm.code} · R1 ${firm.r1Score}/100 ($${price.toLocaleString()})${tag}`,
        };
      }),
    [consultingTeams, state, code]
  );

  const exactConsultingAmounts = useMemo(
    () =>
      uniqueSortedAmounts(
        consultingTeams.map(firm => {
          const d = getR2Deal(state, code, firm.code);
          return d.pendingPrice ?? d.currentPrice;
        })
      ),
    [consultingTeams, state, code]
  );

  const filteredConsultingTeams = useMemo(() => {
    const list = consultingTeams.filter(firm => {
      if (consultingFilter.teamCode !== "ALL" && firm.code !== consultingFilter.teamCode) return false;
      const d = getR2Deal(state, code, firm.code);
      const price = d.pendingPrice ?? d.currentPrice;
      return matchesAmountFilter(price, consultingFilter);
    });
    if (consultingFilter.sortBy === "AMOUNT_ASC") {
      return [...list].sort((a, b) => {
        const da = getR2Deal(state, code, a.code);
        const db = getR2Deal(state, code, b.code);
        return (da.pendingPrice ?? da.currentPrice) - (db.pendingPrice ?? db.currentPrice);
      });
    }
    if (consultingFilter.sortBy === "AMOUNT_DESC") {
      return [...list].sort((a, b) => {
        const da = getR2Deal(state, code, a.code);
        const db = getR2Deal(state, code, b.code);
        return (db.pendingPrice ?? db.currentPrice) - (da.pendingPrice ?? da.currentPrice);
      });
    }
    if (consultingFilter.sortBy === "SCORE_DESC") {
      return [...list].sort((a, b) => b.r1Score - a.r1Score);
    }
    if (consultingFilter.sortBy === "CODE_ASC") {
      return [...list].sort((a, b) => a.code.localeCompare(b.code));
    }
    // Bubble active/locked/incoming requests to top in default order
    return [...list].sort((a, b) => {
      const score = (cCode: string) => {
        if (lockedFirmCode === cCode) return 5;
        if (lockWaitingFirmCode === cCode) return 4;
        const d = getR2Deal(state, code, cCode);
        if (d.lockInitiatedBy === "CONSULTING" && d.consultingLockAccepted) return 4;
        if (d.stage === "COUNTER_DEMANDED") return 3;
        if (d.stage === "PROPOSAL_SENT" || d.stage === "DEAL_AGREED_UNLOCKED") return 2;
        return 1;
      };
      return score(b.code) - score(a.code);
    });
  }, [consultingTeams, state, code, consultingFilter, lockedFirmCode, lockWaitingFirmCode]);

  const activeFirmCode = lockedFirmCode ?? lockWaitingFirmCode;
  const isActiveFirmHidden =
    activeFirmCode !== null && !filteredConsultingTeams.some(f => f.code === activeFirmCode);

  const handleBroadcastRaise = () => {
    if (reqAmount <= 0 || reqEquityPct <= 0 || reqEquityPct > equityRetainedPct) return;
    dispatch({
      type: "PRODUCT_RAISE_BROADCAST",
      productCode: code,
      amount: reqAmount,
      equityPct: reqEquityPct,
      note: raiseNote.trim() || undefined,
    });
    setReqAmountInput("");
    setReqEquityInput("");
    setRaiseNote("");
  };

  // Live consultant solution received from lockedDeal
  const consultantHasLiveSubmitted = !!lockedDeal?.r2SolutionSubmittedAt;
  const consultantHasLiveDraft =
    !!lockedDeal && lockedDeal.r2SolutionParts.some(p => p.trim().length > 0);
  const isLockedNpcFirm = lockedFirmCode !== null && lockedFirmCode !== "XC01";

  const handleCopySolutionIntoMvp = () => {
    if (!lockedFirm || !lockedDeal || submittedAt) return;
    if (consultantHasLiveSubmitted || consultantHasLiveDraft) {
      const p = lockedDeal.r2SolutionParts;
      setMvpValues([
        p[0] || `Crisis impact analyzed with Team ${lockedFirm.code}.`,
        `Adopting Team ${lockedFirm.code}'s recommendation: ${p[2] || p[1] || ""}`,
        `Revised MVP features based on Team ${lockedFirm.code}'s strategy: ${p[2] || ""}`,
        p[3] || "",
        p[4] || "",
        p[5] || "",
      ]);
      return;
    }
    const s = lockedFirm.presetSolution;
    setMvpValues([
      s.diagnosis,
      `Adopting Team ${lockedFirm.code}'s crisis turnaround plan: ${s.recommendation}`,
      `Updated MVP Architecture: ${s.recommendation}`,
      s.perPackMaths,
      s.timeline,
      s.risks,
    ]);
  };

  const mvpCount = useMemo(
    () => mvpValues.reduce((n, v) => n + v.trim().split(/\s+/).filter(Boolean).length, 0),
    [mvpValues]
  );

  const handleSubmitUpdatedMvp = () => {
    if (!lockedFirm || submittedAt || mvpCount === 0) return;
    dispatch({
      type: "R2_PRODUCT_SUBMIT_MVP",
      productCode: code,
      parts: mvpValues,
    });
  };

  return <>
    <PageTitle
      eyebrow={`ROUND 2 / LIVE RAISE, END-TO-END CONSULTANT LOCK & MVP UPDATE · ${code}`}
      title="Raise funds from Finance, lock a Consultant, and update your MVP."
      sub="Product teams start with $0 cash. First, broadcast an overall equity-for-cash raise request to ALL Finance teams. Then negotiate live with any Consulting team—proposals, counter-demands, and 1:1 Lock Requests sync end-to-end across both workspaces, and your Consultant's submitted crisis solution streams directly into your MVP below."
    />

    <div className="guide-grid three">
      <Metric
        label="PRODUCT CASH BALANCE"
        value={`$${availableCash.toLocaleString()}`}
        delta={
          raisedCash === 0
            ? "STARTED WITH $0 · RAISE FROM FINANCE BELOW"
            : lockedDeal
              ? `RAISED $${raisedCash.toLocaleString()} − PAID $${lockedDeal.currentPrice.toLocaleString()} TO ${lockedDeal.consultingCode}`
              : `RAISED $${raisedCash.toLocaleString()} FROM FINANCE SECTOR`
        }
      />
      <Metric
        label="FOUNDER EQUITY RETAINED"
        value={`${equityRetainedPct}%`}
        delta={
          equityGivenPct > 0
            ? `${equityGivenPct}% EQUITY ALLOCATED TO FINANCE INVESTORS`
            : "100% RETAINED · OFFER EQUITY TO RAISE FUNDS"
        }
      />
      <Metric
        label="CONSULTING LOCK (1:1)"
        value={
          lockedFirm
            ? `LOCKED · ${lockedFirm.code}`
            : lockWaitingFirmCode
              ? `LOCK SENT · ${lockWaitingFirmCode}`
              : "NOT LOCKED"
        }
        delta={
          lockedFirm
            ? consultantHasLiveSubmitted
              ? `${lockedFirm.code} DELIVERED SOLUTION ✓`
              : `${code} ⇄ ${lockedFirm.code} · AWAITING SOLUTION`
            : lockWaitingFirmCode
              ? `AWAITING ${lockWaitingFirmCode} TO ACCEPT IN CONSULTING TAB…`
              : incomingConsultingActions.length > 0
                ? `${incomingConsultingActions.length} LIVE UPDATE${incomingConsultingActions.length === 1 ? "" : "S"} FROM CONSULTANTS`
                : "REQUIRES RAISED CASH TO LOCK CONSULTANT"
        }
      />
    </div>

    {/* ── STEP 1: RAISE CAPITAL OVERALL TO ALL FINANCE TEAMS (EQUITY FOR CASH) ── */}
    <div className="guide-grid two mt-4">
      <Panel title="1. Raise capital from Finance sector (broadcast to all)" tag="PRODUCT STARTS WITH $0 · EQUITY TRADEOFF">
        <p className="guide-muted">
          Your Product team starts Round 2 with <b>$0 cash</b>. To pay a Consulting team to solve your crisis, broadcast an overall equity raise request to <b>all Finance teams</b> at once. Finance teams decide whether to fund you based on your <b>Round 1 MVP</b>.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="guide-label !mt-0">EQUITY YOU WANT TO OFFER (%)</label>
            <input
              type="number"
              min={0.01}
              max={equityRetainedPct}
              step="any"
              className="guide-input font-mono"
              placeholder="e.g. 3"
              value={reqEquityInput}
              onChange={e => setReqEquityInput(e.target.value)}
            />
          </div>
          <div>
            <label className="guide-label !mt-0">MONEY YOU WANT TO RAISE ($)</label>
            <input
              type="number"
              min={1}
              step="any"
              className="guide-input font-mono"
              placeholder="e.g. 45000"
              value={reqAmountInput}
              onChange={e => setReqAmountInput(e.target.value)}
            />
          </div>
        </div>

        <label className="guide-label">YOUR OFFER NOTE TO ALL FINANCE TEAMS (OPTIONAL · LINKED TO YOUR R1 MVP)</label>
        <input
          type="text"
          className="guide-input"
          placeholder="Explain why Finance teams should fund your MVP at this equity & amount…"
          value={raiseNote}
          onChange={e => setRaiseNote(e.target.value)}
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#cfa078]">
          <span>
            {reqEquityPct > 0 && reqAmount > 0 ? (
              <>OFFERING <b>{reqEquityPct}% EQUITY</b> FOR <b>${reqAmount.toLocaleString()}</b></>
            ) : (
              "ENTER ANY EQUITY % AND AMOUNT YOU DECIDE"
            )}
          </span>
          <span>
            IMPLIED VALUATION: <b className="text-[#ff9b45]">{impliedValuation > 0 ? `$${impliedValuation.toLocaleString()}` : "—"}</b>
          </span>
        </div>

        {reqEquityPct > equityRetainedPct && (
          <p className="mt-2 text-xs text-red-400">
            You only have {equityRetainedPct}% founder equity remaining.
          </p>
        )}

        <button
          type="button"
          className="guide-btn mt-3 w-full"
          disabled={reqAmount <= 0 || reqEquityPct <= 0 || reqEquityPct > equityRetainedPct}
          onClick={handleBroadcastRaise}
        >
          {reqEquityPct > 0 && reqAmount > 0
            ? `RAISE REQUEST OVERALL TO ALL FINANCE TEAMS (${reqEquityPct}% FOR $${reqAmount.toLocaleString()}) →`
            : "ENTER EQUITY % & AMOUNT TO BROADCAST RAISE →"}
        </button>

        {product.raiseHistory.length > 0 && (
          <div className="guide-scroll-box mini mt-3 space-y-2">
            {product.raiseHistory.map(r => (
              <div key={r.id} className="guide-alert">
                <b>✓ Funded by {r.fundedBy} ({r.fundedByName}) ({r.timestamp}):</b> Received <b>+${r.amount.toLocaleString()}</b> cash for <b>{r.equityPct}% equity</b> based on your Round 1 MVP.
              </div>
            ))}
            {product.raiseHistory.map(r => {
              const liveReq = state.raiseRequests.find(req => req.id === r.id);
              const isOpen = r.status === "BROADCASTING" && liveReq?.status === "OPEN";
              const eligibleFin = financeTeams.find(ft => ft.availableCapital >= r.amount) ?? financeTeams[0];
              return (
                <div key={r.id} className={`guide-alert ${isOpen ? "guide-warning" : ""}`}>
                  {isOpen ? (
                    <div className="space-y-2">
                      <div>
                        <b>● Broadcast Live to ALL Finance Teams ({r.timestamp}):</b> Asking{" "}
                        <b>${r.amount.toLocaleString()}</b> for <b>{r.equityPct}% equity</b> — waiting for a Finance team to inspect your MVP &amp; close the deal in Finance Round 2!
                        {liveReq && liveReq.passedBy.length > 0 && (
                          <span className="block text-[10px]">
                            Passed by: {liveReq.passedBy.join(", ")} (still open to all other Finance teams).
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="guide-btn secondary guide-filter-reset"
                          onClick={() =>
                            dispatch({
                              type: "PRODUCT_RAISE_CANCEL",
                              productCode: code,
                              requestId: r.id,
                            })
                          }
                        >
                          CANCEL &amp; EDIT OFFER
                        </button>
                        {eligibleFin && (
                          <button
                            type="button"
                            className="guide-btn secondary guide-filter-reset"
                            onClick={() =>
                              dispatch({
                                type: "FINANCE_CLOSE_DEAL",
                                financeCode: eligibleFin.code,
                                requestId: r.id,
                              })
                            }
                          >
                            SIMULATE {eligibleFin.code} CLOSING DEAL →
                          </button>
                        )}
                      </div>
                    </div>
                  ) : r.status === "CANCELLED" ? (
                    <>
                      <b>✕ Cancelled ({r.timestamp}):</b> Raise request for <b>${r.amount.toLocaleString()}</b> ({r.equityPct}% equity) was cancelled.
                    </>
                  ) : (
                    <>
                      <b>✓ Deal Closed by {r.fundedBy} ({r.fundedByName}) ({r.timestamp}):</b> Received <b>+${r.amount.toLocaleString()}</b> cash for <b>{r.equityPct}% equity</b> based on your Round 1 MVP!
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="2. All Finance sector teams & available capital" tag={`${financeTeams.length} FINANCE TEAMS · LIVE CAPITAL`}>
        <p className="guide-muted mb-3">
          Every Finance team and how much money they currently hold is listed below. Your raise request is sent overall to the entire Finance sector—any Finance team can choose to fund your MVP.
        </p>
        <ListFilterBar
          value={financeFilter}
          onChange={setFinanceFilter}
          teamOptions={financeTeamOptions}
          teamLabel="FINANCE TEAM CODE"
          allTeamsLabel="All Finance Teams"
          amountLabel="AVAILABLE CAPITAL FILTER"
          amountRanges={buildCapitalAmountRanges()}
          exactAmounts={exactFinanceAmounts}
          minPlaceholder="e.g. 400000"
          maxPlaceholder="e.g. 500000"
          sortOptions={[
            { value: "DEFAULT", label: "Default Order" },
            { value: "AMOUNT_DESC", label: "Capital: High → Low" },
            { value: "AMOUNT_ASC", label: "Capital: Low → High" },
            { value: "CODE_ASC", label: "Team Code: A → Z" },
          ]}
          totalCount={financeTeams.length}
          filteredCount={filteredFinanceTeams.length}
          itemNoun="finance teams"
        />
        <div className="guide-scroll-box compact space-y-2.5">
          {filteredFinanceTeams.length === 0 ? (
            <EmptyFilterState noun="finance teams" onReset={() => setFinanceFilter(INITIAL_LIST_FILTER)} />
          ) : (
            filteredFinanceTeams.map(ft => (
              <div key={ft.code} className="border border-[#294832] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="guide-chip">{ft.code}</span>
                    <b className="ml-2 text-sm">{ft.name}</b>
                  </div>
                  <span className="font-mono text-sm font-bold text-[#ff9b45]">
                    ${ft.availableCapital.toLocaleString()} <small className="text-[9px] font-normal text-[#cfa078]">AVAILABLE</small>
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="guide-muted">Focus: {ft.focus}</span>
                  <span className="guide-status">{ft.lastAction}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>

    {/* ── STEP 2: YOUR CRISIS & HIRING / LOCKING A CONSULTING TEAM ── */}
    <div className="guide-grid two mt-4">
      <Panel title="3. Your Round 2 crisis brief" tag={`${product.ticker} · ${product.sector}`}>
        <span className="guide-chip active">{product.company} ({product.ticker}) · TEAM {code}</span>
        <h2 className="mt-3 text-xl font-semibold">{product.crisisTitle}</h2>
        <div className="guide-alert guide-warning mt-3">
          <b>{product.crisisCategory}</b>
          <br />
          {product.crisisBody}
        </div>
        <p className="guide-muted mt-3">
          <b>End-to-End Coordination (Product ⇄ Consulting):</b>
          <br />
          1. You start with <b>$0 cash</b>—raise funds from Finance teams above (e.g. <b>4% for $45,000</b>).
          <br />
          2. Send a proposal to any Consulting team on the right (e.g. <b>XC01</b>). When they push a price increase or send a Lock Request from their Blue Consulting tab, it appears live on your screen instantaneously.
          <br />
          3. Once both teams accept the <b>1:1 Lock Request</b> (requires enough raised cash), your Consultant&apos;s written Round 2 solution streams live into Panel 5 below so you can write it into your Updated MVP.
        </p>
      </Panel>

      <Panel title="4. Consulting teams & initial evaluated values" tag={`CASH AVAILABLE: $${availableCash.toLocaleString()}`}>
        {incomingConsultingActions.length > 0 && !isLockedOrLockPending && (
          <div className="guide-alert guide-warning mb-3 flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>⚡ Live Consulting update{incomingConsultingActions.length > 1 ? "s" : ""}:</b>{" "}
              {incomingConsultingActions.map(f => f.code).join(", ")} pushed a price demand or sent a Lock Request to {code}.
            </span>
            <button
              type="button"
              className="guide-btn secondary guide-filter-reset"
              onClick={() => setConsultingFilter({ ...INITIAL_LIST_FILTER, teamCode: incomingConsultingActions[0]!.code })}
            >
              JUMP TO {incomingConsultingActions[0]!.code}
            </button>
          </div>
        )}

        <ListFilterBar
          value={consultingFilter}
          onChange={setConsultingFilter}
          teamOptions={consultingTeamOptions}
          teamLabel="CONSULTING TEAM CODE"
          allTeamsLabel="All Consulting Teams"
          amountLabel="CONSULTING FEE / VALUE"
          amountRanges={buildDealAmountRanges()}
          exactAmounts={exactConsultingAmounts}
          sortOptions={[
            { value: "DEFAULT", label: "Default Order" },
            { value: "AMOUNT_ASC", label: "Fee: Low → High" },
            { value: "AMOUNT_DESC", label: "Fee: High → Low" },
            { value: "SCORE_DESC", label: "R1 Score: High → Low" },
            { value: "CODE_ASC", label: "Team Code: A → Z" },
          ]}
          totalCount={consultingTeams.length}
          filteredCount={filteredConsultingTeams.length}
          itemNoun="consulting teams"
        />

        {isActiveFirmHidden && activeFirmCode && (
          <div className="guide-alert mb-3 flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>{lockedFirmCode ? `🔒 Locked 1:1 with ${activeFirmCode}` : `● Lock request pending with ${activeFirmCode}`}</b> — currently hidden by your filter.
            </span>
            <button
              type="button"
              className="guide-btn secondary guide-filter-reset"
              onClick={() => setConsultingFilter({ ...INITIAL_LIST_FILTER, teamCode: activeFirmCode })}
            >
              SHOW {activeFirmCode}
            </button>
          </div>
        )}

        <div className="guide-scroll-box space-y-3">
          {filteredConsultingTeams.length === 0 ? (
            <EmptyFilterState noun="consulting teams" onReset={() => setConsultingFilter(INITIAL_LIST_FILTER)} />
          ) : (
            filteredConsultingTeams.map(firm => {
              const d = getR2Deal(state, code, firm.code);
              const firmLockedElsewhere = getConsultingR2Lock(state, firm.code);
              const isLockedByOtherProduct =
                firmLockedElsewhere !== null && firmLockedElsewhere.productCode !== code;
              const isThisLocked = lockedFirmCode === firm.code;
              const isThisLockWaiting = lockWaitingFirmCode === firm.code;
              const isClosedByOther =
                (isLockedOrLockPending && !isThisLocked && !isThisLockWaiting) || isLockedByOtherProduct;
              const isConsultingLockIncoming =
                d.lockInitiatedBy === "CONSULTING" && d.consultingLockAccepted && !d.productLockAccepted;

              const activeDemandPrice = d.stage === "COUNTER_DEMANDED" && d.pendingPrice ? d.pendingPrice : d.currentPrice;
              const extraOverBase = Math.max(0, activeDemandPrice - firm.baseValue);
              const extraOverBasePct =
                d.stage === "COUNTER_DEMANDED" && d.pendingMarkupPct !== undefined
                  ? d.pendingMarkupPct
                  : firm.baseValue > 0
                    ? Math.round((extraOverBase / firm.baseValue) * 100)
                    : 0;
              const shortfall = Math.max(0, d.currentPrice - availableCash);
              const isSimulatedNpcFirm = firm.code !== "XC01";

              return (
                <div
                  key={firm.code}
                  className="border border-[#294832] p-3.5"
                  style={{ opacity: isClosedByOther ? 0.42 : 1 }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className={`guide-chip ${isThisLocked || isConsultingLockIncoming || d.stage === "COUNTER_DEMANDED" ? "active" : ""}`}>
                        {firm.code} · R1 SCORE {firm.r1Score}/100
                      </span>
                      <b className="ml-2 text-sm">Team {firm.code}</b>
                      {firm.r1SubmittedAt && (
                        <span className="ml-2 font-mono text-[9px] text-[#ff9b45]">R1 ✓</span>
                      )}
                    </div>
                    <span className="guide-status">
                      {isThisLocked
                        ? `🔒 LOCKED 1:1 AT $${d.currentPrice.toLocaleString()}`
                        : isLockedByOtherProduct
                          ? `CLOSED · ${firm.code} LOCKED WITH ${firmLockedElsewhere!.productCode}`
                          : isThisLockWaiting
                            ? `● LOCK REQUEST SENT TO ${firm.code} · AWAITING CONSULTING ACCEPT…`
                            : isClosedByOther
                              ? "CLOSED · 1:1 LOCKED WITH ANOTHER FIRM"
                              : isConsultingLockIncoming
                                ? `⚡ ${firm.code} SENT LOCK REQUEST AT $${d.currentPrice.toLocaleString()}!`
                                : d.stage === "PROPOSAL_SENT"
                                  ? `● PROPOSAL SENT TO ${firm.code} · AWAITING RESPONSE…`
                                  : d.stage === "COUNTER_DEMANDED"
                                    ? `▲ DEMANDING +$${extraOverBase.toLocaleString()} (+${extraOverBasePct}%) MORE THAN BASE`
                                    : d.stage === "DEAL_AGREED_UNLOCKED"
                                      ? `✓ DEAL AGREED AT $${d.currentPrice.toLocaleString()} · READY TO LOCK`
                                      : d.stage === "DECLINED"
                                        ? "COUNTER DECLINED · AVAILABLE TO RE-SEND"
                                        : `BASE EVALUATED VALUE: $${firm.baseValue.toLocaleString()}`}
                    </span>
                  </div>

                  <p className="guide-muted mt-1.5">
                    <b>Focus:</b> {firm.speciality}
                  </p>

                  <div className="mt-2.5 grid grid-cols-3 gap-2 text-[10px] font-mono">
                    <div className="border border-[#294832] p-2">
                      <span className="block text-[#cfa078]">BASE VALUE (R1)</span>
                      <b className="mt-0.5 block text-[#fff7f0]">${firm.baseValue.toLocaleString()}</b>
                    </div>
                    <div className="border border-[#294832] p-2">
                      <span className="block text-[#cfa078]">CURRENT DEMAND</span>
                      <b className="mt-0.5 block text-[#fff7f0]">${activeDemandPrice.toLocaleString()}</b>
                    </div>
                    <div className="border border-[#294832] p-2">
                      <span className="block text-[#cfa078]">MORE THAN BASE</span>
                      <b className="mt-0.5 block text-[#ff9b45]">
                        {extraOverBase > 0
                          ? `+$${extraOverBase.toLocaleString()} (+${extraOverBasePct}%)`
                          : "$0 (BASE RATE)"}
                      </b>
                    </div>
                  </div>

                  {d.stage === "COUNTER_DEMANDED" && (
                    <div className="guide-alert guide-warning mt-3">
                      <b>Team {firm.code} pushed a price increase!</b> They are demanding <b>${activeDemandPrice.toLocaleString()}</b> — that is{" "}
                      <b>+${extraOverBase.toLocaleString()} (+{extraOverBasePct}%) more than their ${firm.baseValue.toLocaleString()} base value</b>.
                    </div>
                  )}

                  {isConsultingLockIncoming && !isClosedByOther && (
                    <div className="guide-alert mt-3">
                      <b>⚡ Live Lock Request from Team {firm.code}:</b> They want to lock 1:1 with {code} at <b>${d.currentPrice.toLocaleString()}</b>.
                    </div>
                  )}

                  {!isClosedByOther && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {!isThisLocked && !isThisLockWaiting && (
                        <>
                          {isConsultingLockIncoming ? (
                            <>
                              <button
                                type="button"
                                disabled={shortfall > 0}
                                className="guide-btn"
                                onClick={() =>
                                  dispatch({
                                    type: "R2_ACCEPT_LOCK_REQUEST",
                                    productCode: code,
                                    consultingCode: firm.code,
                                    acceptedBy: "PRODUCT",
                                  })
                                }
                              >
                                {shortfall > 0
                                  ? `NEED $${shortfall.toLocaleString()} MORE CASH FROM FINANCE TO ACCEPT LOCK`
                                  : `ACCEPT LOCK REQUEST FROM ${firm.code} AT $${d.currentPrice.toLocaleString()} 🔒`}
                              </button>
                              <button
                                type="button"
                                className="guide-btn secondary"
                                onClick={() =>
                                  dispatch({
                                    type: "R2_DECLINE_LOCK_REQUEST",
                                    productCode: code,
                                    consultingCode: firm.code,
                                    declinedBy: "PRODUCT",
                                  })
                                }
                              >
                                DECLINE LOCK
                              </button>
                            </>
                          ) : d.stage === "COUNTER_DEMANDED" ? (
                            <>
                              <button
                                type="button"
                                className="guide-btn"
                                onClick={() =>
                                  dispatch({
                                    type: "R2_PRODUCT_ACCEPT_DEMAND",
                                    productCode: code,
                                    consultingCode: firm.code,
                                  })
                                }
                              >
                                ACCEPT +${extraOverBase.toLocaleString()} INCREASE (${activeDemandPrice.toLocaleString()}) →
                              </button>
                              <button
                                type="button"
                                className="guide-btn secondary"
                                onClick={() =>
                                  dispatch({
                                    type: "R2_PRODUCT_DECLINE_DEMAND",
                                    productCode: code,
                                    consultingCode: firm.code,
                                  })
                                }
                              >
                                DECLINE DEMAND
                              </button>
                            </>
                          ) : d.stage === "PROPOSAL_SENT" ? (
                            <>
                              <span className="guide-status">
                                ● PROPOSAL SENT TO {firm.code} · AWAITING {firm.code} IN CONSULTING WORKSPACE…
                              </span>
                              {isSimulatedNpcFirm && (
                                <button
                                  type="button"
                                  className="guide-btn secondary"
                                  onClick={() =>
                                    firm.defaultCounterMarkupPct > 0
                                      ? dispatch({
                                          type: "R2_CONSULTING_PUSH_DEMAND",
                                          productCode: code,
                                          consultingCode: firm.code,
                                          markupPct: firm.defaultCounterMarkupPct,
                                        })
                                      : dispatch({
                                          type: "R2_CONSULTING_ACCEPT_PROPOSAL",
                                          productCode: code,
                                          consultingCode: firm.code,
                                        })
                                  }
                                >
                                  SIMULATE {firm.code} RESPONSE
                                </button>
                              )}
                            </>
                          ) : d.stage === "DEAL_AGREED_UNLOCKED" ? (
                            <>
                              <button
                                type="button"
                                disabled={shortfall > 0}
                                className="guide-btn"
                                onClick={() =>
                                  dispatch({
                                    type: "R2_SEND_LOCK_REQUEST",
                                    productCode: code,
                                    consultingCode: firm.code,
                                    initiatedBy: "PRODUCT",
                                  })
                                }
                              >
                                {shortfall > 0
                                  ? `NEED $${shortfall.toLocaleString()} MORE CASH FROM FINANCE TO LOCK`
                                  : `SEND LOCK REQUEST TO ${firm.code} AT $${d.currentPrice.toLocaleString()} 🔒`}
                              </button>
                              {shortfall > 0 && (
                                <span className="guide-muted">
                                  Raise at least <b>${shortfall.toLocaleString()}</b> more from Finance teams in Panel 1 above.
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="guide-btn"
                                onClick={() =>
                                  dispatch({
                                    type: "R2_PRODUCT_SEND_PROPOSAL",
                                    productCode: code,
                                    consultingCode: firm.code,
                                  })
                                }
                              >
                                SEND PROPOSAL TO {firm.code} (${firm.baseValue.toLocaleString()}) →
                              </button>
                              <button
                                type="button"
                                disabled={shortfall > 0}
                                className="guide-btn secondary"
                                onClick={() =>
                                  dispatch({
                                    type: "R2_SEND_LOCK_REQUEST",
                                    productCode: code,
                                    consultingCode: firm.code,
                                    initiatedBy: "PRODUCT",
                                  })
                                }
                              >
                                {shortfall > 0
                                  ? `LOCK NEEDS $${shortfall.toLocaleString()} MORE CASH`
                                  : `DIRECT LOCK REQUEST ($${d.currentPrice.toLocaleString()}) 🔒`}
                              </button>
                            </>
                          )}
                        </>
                      )}

                      {isThisLockWaiting && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="guide-status">
                            ● LOCK REQUEST SENT TO {firm.code} AT ${d.currentPrice.toLocaleString()} · WAITING FOR {firm.code} TO ACCEPT IN CONSULTING WORKSPACE…
                          </span>
                          <button
                            type="button"
                            className="guide-btn secondary"
                            onClick={() =>
                              dispatch({
                                type: "R2_DECLINE_LOCK_REQUEST",
                                productCode: code,
                                consultingCode: firm.code,
                                declinedBy: "PRODUCT",
                              })
                            }
                          >
                            CANCEL LOCK REQUEST
                          </button>
                          {isSimulatedNpcFirm && (
                            <button
                              type="button"
                              className="guide-btn secondary"
                              onClick={() =>
                                dispatch({
                                  type: "R2_ACCEPT_LOCK_REQUEST",
                                  productCode: code,
                                  consultingCode: firm.code,
                                  acceptedBy: "CONSULTING",
                                })
                              }
                            >
                              SIMULATE {firm.code} ACCEPT LOCK
                            </button>
                          )}
                        </div>
                      )}

                      {isThisLocked && (
                        <span className="guide-status">
                          🔒 PERMANENTLY LOCKED 1:1 WITH {firm.code} ({d.lockedAt}) · CANNOT BE UPDATED
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

    {/* ── STEP 3: CONSULTING TEAM'S LIVE CRISIS SOLUTION + WRITE INTO UPDATED MVP ── */}
    {!lockedFirm || !lockedDeal ? (
      <div className="mt-4">
        <Panel title="5. Consulting crisis solution & updated MVP" tag="LOCKED UNTIL FUNDED & 1:1 CONSULTING TEAM IS LOCKED">
          <div className="guide-alert guide-warning">
            <b>
              {raisedCash === 0
                ? "Step 1: Broadcast a Raise Request to All Finance Teams Above ($0 Cash Available)"
                : lockWaitingFirmCode
                  ? `Lock Request Sent to Team ${lockWaitingFirmCode} — Switch to ${lockWaitingFirmCode}'s Consulting Tab to Accept Lock Request…`
                  : "Step 2: Negotiate & Complete a 1:1 Mutual Lock Request With a Consulting Team Above"}
            </b>
            <br />
            1. Raise funds by broadcasting an overall equity-for-cash request to all Finance teams (e.g. <b>4% equity for $45,000</b>).
            <br />
            2. Send a proposal to a Consulting team, respond to any live price increase demand, and complete a mutual <b>1:1 Lock Request</b>.
            <br />
            3. Once locked 1-to-1, your Consultant&apos;s written crisis solution streams straight into this panel so you can <b>write it into your updated MVP</b>.
          </div>
        </Panel>
      </div>
    ) : (
      <>
        <div className="guide-grid two mt-4">
          <Panel
            title={`5. Live crisis solution from locked Consulting Team ${lockedFirm.code}`}
            tag={
              consultantHasLiveSubmitted
                ? `DELIVERED LIVE BY ${lockedFirm.code} · ${lockedDeal.r2SolutionSubmittedAt}`
                : consultantHasLiveDraft
                  ? `${lockedFirm.code} DRAFTING LIVE…`
                  : `LOCKED 1:1 · WAITING FOR ${lockedFirm.code}`
            }
          >
            {consultantHasLiveSubmitted || consultantHasLiveDraft ? (
              <>
                <div className="guide-alert mb-3">
                  {consultantHasLiveSubmitted ? (
                    <>
                      <b>✓ Live Crisis Solution Delivered by Team {lockedFirm.code}</b> ({lockedDeal.r2SolutionSubmittedAt}). Pull it directly into your Updated MVP editor below.
                    </>
                  ) : (
                    <>
                      <b>● Team {lockedFirm.code} is actively drafting your crisis solution…</b> Live draft preview shown below.
                    </>
                  )}
                </div>
                <div className="guide-scroll-box compact space-y-2.5 text-xs leading-relaxed">
                  {lockedDeal.r2SolutionParts.map((text, idx) => (
                    <div key={consultingPartLabels[idx]} className="border border-[#294832] p-3">
                      <span className="guide-status">{consultingPartLabels[idx]}</span>
                      <p className="guide-muted mt-1">{text.trim() || "Not filled yet by consultant…"}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="guide-alert guide-warning">
                  <b>⏳ Waiting for Consulting Team {lockedFirm.code} to write &amp; submit your Round 2 Crisis Solution.</b>
                  <br />
                  As soon as Team <b>{lockedFirm.code}</b> writes and clicks <b>Submit &amp; Deliver Solution</b> in their Consulting Round 2 workspace, all 6 parts will appear live right here!
                </div>
                {isLockedNpcFirm && (
                  <button
                    type="button"
                    className="guide-btn secondary w-full"
                    onClick={() => {
                      const s = lockedFirm.presetSolution;
                      dispatch({
                        type: "R2_CONSULTING_SUBMIT_SOLUTION",
                        productCode: code,
                        consultingCode: lockedFirm.code,
                        parts: [s.diagnosis, `Three turnaround options evaluated for ${product.company}.`, s.recommendation, s.perPackMaths, s.timeline, s.risks],
                      });
                    }}
                  >
                    SIMULATE {lockedFirm.code} DELIVERING CRISIS SOLUTION →
                  </button>
                )}
              </div>
            )}

            {!submittedAt && (consultantHasLiveSubmitted || consultantHasLiveDraft) && (
              <button
                type="button"
                className="guide-btn secondary mt-3 w-full"
                onClick={handleCopySolutionIntoMvp}
              >
                PRE-FILL TEAM {lockedFirm.code}&apos;S LIVE SOLUTION INTO UPDATED MVP EDITOR ↓
              </button>
            )}
          </Panel>

          <Panel title="Locked 1:1 hiring & funding summary" tag="PERMANENT · CANNOT CHANGE">
            <div className="grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>LOCKED CONSULTANT</small>
                <b>Team {lockedFirm.code}</b>
                <span>R1 SCORE {lockedFirm.r1Score} / 100</span>
              </div>
              <div className="guide-metric">
                <small>AGREED FEE PAID</small>
                <b>${lockedDeal.currentPrice.toLocaleString()}</b>
                <span>
                  {lockedDeal.currentMarkupPct > 0
                    ? `+${lockedDeal.currentMarkupPct}% OVER BASE`
                    : "AT BASE / INITIAL PRICE"}
                </span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>FINANCE EQUITY GIVEN</small>
                <b className="text-lg">{equityGivenPct}%</b>
                <span>RAISED ${raisedCash.toLocaleString()} · LEFT ${availableCash.toLocaleString()}</span>
              </div>
              <div className="guide-metric">
                <small>UPDATED MVP STATUS</small>
                <b className="text-lg">{submittedAt ? "SUBMITTED ✓" : "IN PROGRESS"}</b>
                <span>{submittedAt ? `FINALIZED ${submittedAt}` : "WRITE SOLUTION INTO MVP"}</span>
              </div>
            </div>
            <div className="guide-alert mt-4">
              Your 1:1 pairing <b>{code} ⇄ {lockedFirm.code}</b> automatically carries forward into <b>Round 3</b>! Write their crisis solution into your Updated MVP below and submit.
            </div>
          </Panel>
        </div>

        <div className="mt-4">
          <Panel
            title={`Write Consulting Team ${lockedFirm.code}'s solution into your Updated MVP (${product.company})`}
            tag="6 PARTS · 600 WORDS TOTAL · FINAL ON SUBMIT"
          >
            {submittedAt && (
              <div className="guide-alert mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <b>✓ Updated MVP permanently submitted for {product.company} ({code} ⇄ {lockedFirm.code})</b> · Finalized at {submittedAt} ({mvpCount} words) and synced live to Team {lockedFirm.code}.
                </div>
                <span className="guide-chip active">FINAL · LOCKED</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="guide-muted">
                Integrate Team {lockedFirm.code}&apos;s crisis solution directly into your MVP below. Once submitted, it locks for judging.
              </p>
              <b className={mvpCount > 600 ? "text-red-400" : "guide-status"}>{mvpCount} / 600 WORDS</b>
            </div>
            <div className="guide-tabs mt-4">
              {mvpUpdateParts.map((p, i) => (
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
            <label className="guide-label">{mvpUpdateParts[active]!.toUpperCase()}</label>
            <textarea
              className="guide-textarea"
              readOnly={!!submittedAt}
              value={mvpValues[active]}
              onChange={e => {
                if (submittedAt) return;
                const next = mvpValues.map((x, i) => (i === active ? e.target.value : x));
                const words = next.reduce((sum, item) => sum + item.trim().split(/\s+/).filter(Boolean).length, 0);
                if (words <= 600) setMvpValues(next);
              }}
              onBlur={() => {
                if (!submittedAt) {
                  dispatch({ type: "R2_PRODUCT_SAVE_MVP", productCode: code, parts: mvpValues });
                }
              }}
              placeholder={mvpUpdateGuides[active]}
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
                onClick={handleSubmitUpdatedMvp}
              >
                {submittedAt ? "UPDATED MVP SUBMITTED ✓" : "SUBMIT UPDATED MVP →"}
              </button>
            </div>
          </Panel>
        </div>
      </>
    )}

    <div className="guide-alert mt-4">
      End-to-end Round 2 flow: <b>1. Broadcast Equity Raise to All Finance Teams ($0 Start)</b> → <b>2. Live Proposal &amp; Counter-Demand With Consulting Team</b> → <b>3. Mutual 1:1 Lock Request</b> → <b>4. Receive Live Consultant Solution &amp; Submit Updated MVP</b>.
    </div>
  </>;
}
