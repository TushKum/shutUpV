"use client";
import {useEffect,useMemo,useState} from "react";
import {PageTitle,Panel,Metric,useTeamCode} from "../ui";
import {
  EmptyFilterState,
  INITIAL_LIST_FILTER,
  ListFilterBar,
  buildCapitalAmountRanges,
  buildEquityRanges,
  matchesAmountFilter,
  uniqueSortedAmounts,
  type ListFilterState,
} from "../list-filter-bar";
import {useCoordination} from "../coordination-store";
import {
  calcMoneyFromShares,
  equityPctToShares,
  getConsultingR2Lock,
  getOrMakeConsultant,
  getOrMakeProduct,
  getProductAvailableCash,
  getProductEquityRetainedPct,
  getProductR2Lock,
  getProductR2PendingLock,
  getProductSharesRetained,
  getR2Deal,
  sharesToEquityPct,
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

  // Linked Equity % <-> Shares inputs for Finance broadcast (money auto-calculated!)
  const [reqEquityInput, setReqEquityInput] = useState<string>("");
  const [reqSharesInput, setReqSharesInput] = useState<string>("");
  const [raiseNote, setRaiseNote] = useState<string>("");

  const reqEquityPct = Math.max(0, Number(reqEquityInput) || 0);
  const reqShares = equityPctToShares(reqEquityPct, product.totalShares);
  const calcRaiseAmount = calcMoneyFromShares(reqShares, product.sharePrice);

  const handleEquityInputChange = (val: string) => {
    setReqEquityInput(val);
    const num = Number(val);
    if (!val.trim() || Number.isNaN(num) || num <= 0) {
      setReqSharesInput("");
    } else {
      setReqSharesInput(String(equityPctToShares(num, product.totalShares)));
    }
  };

  const handleSharesInputChange = (val: string) => {
    setReqSharesInput(val);
    const num = Number(val);
    if (!val.trim() || Number.isNaN(num) || num <= 0) {
      setReqEquityInput("");
    } else {
      setReqEquityInput(String(sharesToEquityPct(num, product.totalShares)));
    }
  };

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

  const availableCash = useMemo(() => getProductAvailableCash(state, code), [state, code]);
  const equityRetainedPct = useMemo(() => getProductEquityRetainedPct(state, code), [state, code]);
  const sharesRetained = useMemo(() => getProductSharesRetained(state, code), [state, code]);
  const companyValuation = Math.round(product.totalShares * product.sharePrice);
  const submittedAt = product.r2MvpSubmittedAt;

  // Incoming live updates from Consulting teams (higher equity demands or lock requests)
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

  // ── CONSULTING TEAMS FILTER MEMOS (SHARES & EQUITY) ──
  const consultingTeamOptions = useMemo(
    () =>
      consultingTeams.map(firm => {
        const d = getR2Deal(state, code, firm.code);
        const eq = d.pendingEquityPct ?? d.currentEquityPct;
        const sh = d.pendingShares ?? d.currentShares;
        const val = d.pendingPrice ?? d.currentPrice;
        const tag =
          d.lockInitiatedBy === "CONSULTING" && d.consultingLockAccepted && !d.productLockAccepted
            ? " [LOCK REQ]"
            : d.stage === "COUNTER_DEMANDED"
              ? ` [+${d.pendingExtraEquityPct}% ASK]`
              : "";
        return {
          code: firm.code,
          label: `${firm.code} · ${eq}% (${sh.toLocaleString()} sh · $${val.toLocaleString()})${tag}`,
        };
      }),
    [consultingTeams, state, code]
  );

  const exactConsultingEquities = useMemo(
    () =>
      uniqueSortedAmounts(
        consultingTeams.map(firm => {
          const d = getR2Deal(state, code, firm.code);
          return d.pendingEquityPct ?? d.currentEquityPct;
        })
      ),
    [consultingTeams, state, code]
  );

  const filteredConsultingTeams = useMemo(() => {
    const list = consultingTeams.filter(firm => {
      if (consultingFilter.teamCode !== "ALL" && firm.code !== consultingFilter.teamCode) return false;
      const d = getR2Deal(state, code, firm.code);
      const eq = d.pendingEquityPct ?? d.currentEquityPct;
      return matchesAmountFilter(eq, consultingFilter);
    });
    if (consultingFilter.sortBy === "EQUITY_ASC") {
      return [...list].sort((a, b) => {
        const da = getR2Deal(state, code, a.code);
        const db = getR2Deal(state, code, b.code);
        return (da.pendingEquityPct ?? da.currentEquityPct) - (db.pendingEquityPct ?? db.currentEquityPct);
      });
    }
    if (consultingFilter.sortBy === "EQUITY_DESC") {
      return [...list].sort((a, b) => {
        const da = getR2Deal(state, code, a.code);
        const db = getR2Deal(state, code, b.code);
        return (db.pendingEquityPct ?? db.currentEquityPct) - (da.pendingEquityPct ?? da.currentEquityPct);
      });
    }
    if (consultingFilter.sortBy === "SCORE_DESC") {
      return [...list].sort((a, b) => b.r1Score - a.r1Score);
    }
    if (consultingFilter.sortBy === "CODE_ASC") {
      return [...list].sort((a, b) => a.code.localeCompare(b.code));
    }
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
    if (reqEquityPct <= 0 || reqEquityPct > equityRetainedPct) return;
    dispatch({
      type: "PRODUCT_RAISE_BROADCAST",
      productCode: code,
      equityPct: reqEquityPct,
      note: raiseNote.trim() || undefined,
    });
    setReqEquityInput("");
    setReqSharesInput("");
    setRaiseNote("");
  };

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
      eyebrow={`ROUND 2 / SHARE & EQUITY DEALS WITH FINANCE & CONSULTING · ${code}`}
      title="Offer shares & equity to Finance and lock a Consultant 1-to-1."
      sub="All Round 2 deals run on Shares & Equity %—money values are calculated automatically from shares × share price. Broadcast a share & equity offer overall to ALL Finance teams, negotiate equity & shares with a Consulting team, lock 1-to-1, and integrate their live crisis solution into your MVP."
    />

    <div className="guide-grid three">
      <Metric
        label="FOUNDER EQUITY RETAINED"
        value={`${equityRetainedPct}%`}
        delta={`${sharesRetained.toLocaleString()} OF ${product.totalShares.toLocaleString()} SHARES LEFT @ $${product.sharePrice.toFixed(2)}/SH`}
      />
      <Metric
        label="CALCULATED CAPITAL RAISED"
        value={`$${availableCash.toLocaleString()}`}
        delta={
          product.equityGivenFinancePct > 0
            ? `${product.equityGivenFinancePct}% (${equityPctToShares(product.equityGivenFinancePct).toLocaleString()} SH) TO FINANCE · VAL $${companyValuation.toLocaleString()}`
            : `STARTED AT $0 · OFFER SHARES TO FINANCE BELOW`
        }
      />
      <Metric
        label="CONSULTING EQUITY LOCK (1:1)"
        value={
          lockedFirm
            ? `LOCKED · ${lockedFirm.code}`
            : lockWaitingFirmCode
              ? `LOCK SENT · ${lockWaitingFirmCode}`
              : "NOT LOCKED"
        }
        delta={
          lockedDeal
            ? `${lockedDeal.currentEquityPct}% (${lockedDeal.currentShares.toLocaleString()} SH · CALC $${lockedDeal.currentPrice.toLocaleString()})`
            : lockWaitingFirmCode
              ? `AWAITING ${lockWaitingFirmCode} IN CONSULTING TAB…`
              : incomingConsultingActions.length > 0
                ? `${incomingConsultingActions.length} LIVE EQUITY UPDATE${incomingConsultingActions.length === 1 ? "" : "S"}`
                : "PAY CONSULTANT IN COMPANY SHARES & EQUITY"
        }
      />
    </div>

    {/* ── STEP 1: OFFER SHARES & EQUITY OVERALL TO ALL FINANCE TEAMS (MONEY AUTO-CALCULATED) ── */}
    <div className="guide-grid two mt-4">
      <Panel title="1. Offer shares & equity to Finance sector (broadcast to all)" tag={`SHARE PRICE $${product.sharePrice.toFixed(2)} · AUTO-CALC $`}>
        <p className="guide-muted">
          Finance teams deal strictly in <b>Shares &amp; Equity %</b>. Enter either the <b>Equity %</b> or <b>Number of Shares</b> you want to offer overall to <b>all Finance teams</b>—the money raised is calculated automatically from <b>shares × ${product.sharePrice.toFixed(2)}/share</b>.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="guide-label !mt-0">EQUITY TO OFFER (%)</label>
            <input
              type="number"
              min={0.1}
              max={equityRetainedPct}
              step="0.5"
              className="guide-input font-mono"
              placeholder="e.g. 3.5"
              value={reqEquityInput}
              onChange={e => handleEquityInputChange(e.target.value)}
            />
          </div>
          <div>
            <label className="guide-label !mt-0">SHARES TO OFFER (OF 100,000)</label>
            <input
              type="number"
              min={100}
              max={sharesRetained}
              step={500}
              className="guide-input font-mono"
              placeholder="e.g. 3500"
              value={reqSharesInput}
              onChange={e => handleSharesInputChange(e.target.value)}
            />
          </div>
        </div>

        <label className="guide-label">AUTO-CALCULATED MONEY VALUE (SHARES × ${product.sharePrice.toFixed(2)}/SH)</label>
        <input
          type="text"
          readOnly
          className="guide-input font-mono"
          value={
            reqEquityPct > 0
              ? `$${calcRaiseAmount.toLocaleString()} (${reqShares.toLocaleString()} shares × $${product.sharePrice.toFixed(2)} · Company Val $${companyValuation.toLocaleString()})`
              : "Enter equity % or shares above — money calculates automatically"
          }
        />

        <label className="guide-label">YOUR OFFER NOTE TO ALL FINANCE TEAMS (OPTIONAL · LINKED TO YOUR R1 MVP)</label>
        <input
          type="text"
          className="guide-input"
          placeholder="Explain why Finance teams should acquire your shares based on your R1 MVP…"
          value={raiseNote}
          onChange={e => setRaiseNote(e.target.value)}
        />

        {reqEquityPct > equityRetainedPct && (
          <p className="mt-2 text-xs text-red-400">
            You only have {equityRetainedPct}% ({sharesRetained.toLocaleString()} shares) remaining.
          </p>
        )}

        <button
          type="button"
          className="guide-btn mt-3 w-full"
          disabled={reqEquityPct <= 0 || reqEquityPct > equityRetainedPct}
          onClick={handleBroadcastRaise}
        >
          {reqEquityPct > 0
            ? `OFFER ${reqEquityPct}% EQUITY (${reqShares.toLocaleString()} SH · CALC $${calcRaiseAmount.toLocaleString()}) TO ALL FINANCE TEAMS →`
            : "ENTER EQUITY % OR SHARES TO BROADCAST TO FINANCE →"}
        </button>

        {product.raiseHistory.length > 0 && (
          <div className="guide-scroll-box mini mt-3 space-y-2">
            {product.raiseHistory.map(r => {
              const liveReq = state.raiseRequests.find(req => req.id === r.id);
              const isOpen = r.status === "BROADCASTING" && liveReq?.status === "OPEN";
              const eligibleFin = financeTeams.find(ft => ft.availableCapital >= r.amount) ?? financeTeams[0];
              return (
                <div key={r.id} className={`guide-alert ${isOpen ? "guide-warning" : ""}`}>
                  {isOpen ? (
                    <div className="space-y-2">
                      <div>
                        <b>● Broadcast Live to ALL Finance Teams ({r.timestamp}):</b> Offering{" "}
                        <b>{r.equityPct}% equity ({r.shares.toLocaleString()} shares)</b> → Auto-Calculated Value{" "}
                        <b>${r.amount.toLocaleString()}</b> — waiting for a Finance team to close the deal!
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
                            SIMULATE {eligibleFin.code} ACQUIRING SHARES →
                          </button>
                        )}
                      </div>
                    </div>
                  ) : r.status === "CANCELLED" ? (
                    <>
                      <b>✕ Cancelled ({r.timestamp}):</b> {r.equityPct}% ({r.shares.toLocaleString()} shares) offer cancelled.
                    </>
                  ) : (
                    <>
                      <b>✓ Share Deal Closed by {r.fundedBy} ({r.fundedByName}) ({r.timestamp}):</b> Issued{" "}
                      <b>{r.shares.toLocaleString()} shares ({r.equityPct}% equity)</b> → Calculated Cash Received{" "}
                      <b>+${r.amount.toLocaleString()}</b>!
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
          Every Finance team and their remaining calculated capital is listed below. Your share &amp; equity offer broadcasts to the entire Finance sector—any Finance team can inspect your MVP and acquire your shares.
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
                    ${ft.availableCapital.toLocaleString()} <small className="text-[9px] font-normal text-[#cfa078]">CALC CAPITAL</small>
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

    {/* ── STEP 2: YOUR CRISIS & HIRING / LOCKING A CONSULTING TEAM IN SHARES & EQUITY ── */}
    <div className="guide-grid two mt-4">
      <Panel title="3. Your Round 2 crisis brief" tag={`${product.ticker} · $${product.sharePrice.toFixed(2)}/SH`}>
        <span className="guide-chip active">{product.company} ({product.ticker}) · TEAM {code}</span>
        <h2 className="mt-3 text-xl font-semibold">{product.crisisTitle}</h2>
        <div className="guide-alert guide-warning mt-3">
          <b>{product.crisisCategory}</b>
          <br />
          {product.crisisBody}
        </div>
        <p className="guide-muted mt-3">
          <b>How Shares &amp; Equity Work Across Finance &amp; Consulting:</b>
          <br />
          1. You hold <b>{equityRetainedPct}% founder equity ({sharesRetained.toLocaleString()} shares)</b> valued at <b>${product.sharePrice.toFixed(2)}/share</b>.
          <br />
          2. Offer shares &amp; equity to <b>Finance teams</b> above (money calculates automatically from shares × share price) and offer shares &amp; equity to a <b>Consulting team</b> on the right.
          <br />
          3. If a Consultant asks for more equity above their base rate, you see the exact <b>+% equity, +shares, and auto-calculated $ value</b>. Once locked 1:1, their crisis solution streams live into Panel 5 below.
        </p>
      </Panel>

      <Panel title="4. Consulting teams & base equity rates" tag={`EQUITY LEFT: ${equityRetainedPct}% (${sharesRetained.toLocaleString()} SH)`}>
        {incomingConsultingActions.length > 0 && !isLockedOrLockPending && (
          <div className="guide-alert guide-warning mb-3 flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>⚡ Live Consulting update{incomingConsultingActions.length > 1 ? "s" : ""}:</b>{" "}
              {incomingConsultingActions.map(f => f.code).join(", ")} pushed a higher equity demand or sent a Lock Request to {code}.
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
          valueKind="EQUITY"
          amountLabel="CONSULTING EQUITY % / SHARES"
          amountRanges={buildEquityRanges()}
          exactAmounts={exactConsultingEquities}
          sortOptions={[
            { value: "DEFAULT", label: "Live Updates First" },
            { value: "EQUITY_ASC", label: "Equity %: Low → High" },
            { value: "EQUITY_DESC", label: "Equity %: High → Low" },
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

              const activeEq = d.stage === "COUNTER_DEMANDED" && d.pendingEquityPct ? d.pendingEquityPct : d.currentEquityPct;
              const activeShares = d.stage === "COUNTER_DEMANDED" && d.pendingShares ? d.pendingShares : d.currentShares;
              const activeCalcMoney = d.stage === "COUNTER_DEMANDED" && d.pendingPrice ? d.pendingPrice : d.currentPrice;
              const extraEq = Math.max(0, Number((activeEq - firm.baseEquityPct).toFixed(2)));
              const extraShares = equityPctToShares(extraEq, product.totalShares);
              const baseShares = equityPctToShares(firm.baseEquityPct, product.totalShares);
              const baseCalcMoney = calcMoneyFromShares(baseShares, product.sharePrice);
              const lacksEquity = equityRetainedPct < d.currentEquityPct;
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
                        ? `🔒 LOCKED 1:1 · ${d.currentEquityPct}% (${d.currentShares.toLocaleString()} sh)`
                        : isLockedByOtherProduct
                          ? `CLOSED · ${firm.code} LOCKED WITH ${firmLockedElsewhere!.productCode}`
                          : isThisLockWaiting
                            ? `● LOCK REQUEST SENT TO ${firm.code} · AWAITING CONSULTING…`
                            : isClosedByOther
                              ? "CLOSED · 1:1 LOCKED WITH ANOTHER FIRM"
                              : isConsultingLockIncoming
                                ? `⚡ ${firm.code} SENT LOCK REQUEST (${d.currentEquityPct}% · ${d.currentShares.toLocaleString()} sh)!`
                                : d.stage === "PROPOSAL_SENT"
                                  ? `● EQUITY OFFER SENT TO ${firm.code} · AWAITING RESPONSE…`
                                  : d.stage === "COUNTER_DEMANDED"
                                    ? `▲ ASKING +${extraEq}% (+${extraShares.toLocaleString()} SH) ABOVE BASE`
                                    : d.stage === "DEAL_AGREED_UNLOCKED"
                                      ? `✓ AGREED AT ${d.currentEquityPct}% (${d.currentShares.toLocaleString()} sh) · READY TO LOCK`
                                      : d.stage === "DECLINED"
                                        ? "DEMAND DECLINED · AVAILABLE TO RE-OFFER"
                                        : `BASE RATE: ${firm.baseEquityPct}% (${baseShares.toLocaleString()} sh)`}
                    </span>
                  </div>

                  <p className="guide-muted mt-1.5">
                    <b>Focus:</b> {firm.speciality}
                  </p>

                  <div className="mt-2.5 grid grid-cols-3 gap-2 text-[10px] font-mono">
                    <div className="border border-[#294832] p-2">
                      <span className="block text-[#cfa078]">BASE EQUITY (R1)</span>
                      <b className="mt-0.5 block text-[#fff7f0]">
                        {firm.baseEquityPct}% ({baseShares.toLocaleString()} sh)
                      </b>
                    </div>
                    <div className="border border-[#294832] p-2">
                      <span className="block text-[#cfa078]">CURRENT EQUITY ASK</span>
                      <b className="mt-0.5 block text-[#fff7f0]">
                        {activeEq}% ({activeShares.toLocaleString()} sh)
                      </b>
                    </div>
                    <div className="border border-[#294832] p-2">
                      <span className="block text-[#cfa078]">AUTO-CALC VALUE</span>
                      <b className="mt-0.5 block text-[#ff9b45]">
                        ${activeCalcMoney.toLocaleString()}{" "}
                        {extraEq > 0 ? `(+${extraEq}%)` : "(BASE)"}
                      </b>
                    </div>
                  </div>

                  {d.stage === "COUNTER_DEMANDED" && (
                    <div className="guide-alert guide-warning mt-3">
                      <b>Team {firm.code} asked for more equity &amp; shares!</b> They want{" "}
                      <b>{activeEq}% equity ({activeShares.toLocaleString()} shares)</b> — that is{" "}
                      <b>+{extraEq}% (+{extraShares.toLocaleString()} shares) more than their {firm.baseEquityPct}% base rate</b> (Auto-Calculated Value: <b>${activeCalcMoney.toLocaleString()}</b> vs. base ${baseCalcMoney.toLocaleString()}).
                    </div>
                  )}

                  {isConsultingLockIncoming && !isClosedByOther && (
                    <div className="guide-alert mt-3">
                      <b>⚡ Live Lock Request from Team {firm.code}:</b> Lock 1:1 for <b>{d.currentEquityPct}% equity ({d.currentShares.toLocaleString()} shares · calculated value ${d.currentPrice.toLocaleString()})</b>.
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
                                disabled={lacksEquity}
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
                                {lacksEquity
                                  ? `INSUFFICIENT FOUNDER EQUITY (${equityRetainedPct}% LEFT)`
                                  : `ACCEPT LOCK (${d.currentEquityPct}% · ${d.currentShares.toLocaleString()} SH · $${d.currentPrice.toLocaleString()}) 🔒`}
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
                                ACCEPT {activeEq}% ({activeShares.toLocaleString()} SH · CALC ${activeCalcMoney.toLocaleString()}) →
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
                                ● EQUITY OFFER SENT TO {firm.code} · AWAITING {firm.code} IN CONSULTING WORKSPACE…
                              </span>
                              {isSimulatedNpcFirm && (
                                <button
                                  type="button"
                                  className="guide-btn secondary"
                                  onClick={() =>
                                    firm.defaultCounterExtraPct > 0
                                      ? dispatch({
                                          type: "R2_CONSULTING_PUSH_DEMAND",
                                          productCode: code,
                                          consultingCode: firm.code,
                                          extraEquityPct: firm.defaultCounterExtraPct,
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
                            <button
                              type="button"
                              disabled={lacksEquity}
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
                              {lacksEquity
                                ? `INSUFFICIENT FOUNDER EQUITY (${equityRetainedPct}% LEFT)`
                                : `SEND LOCK REQUEST (${d.currentEquityPct}% · ${d.currentShares.toLocaleString()} SH · CALC $${d.currentPrice.toLocaleString()}) 🔒`}
                            </button>
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
                                    offeredEquityPct: firm.baseEquityPct,
                                  })
                                }
                              >
                                OFFER {firm.baseEquityPct}% EQUITY ({baseShares.toLocaleString()} SH · CALC ${baseCalcMoney.toLocaleString()}) →
                              </button>
                              <button
                                type="button"
                                disabled={lacksEquity}
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
                                DIRECT LOCK REQUEST ({d.currentEquityPct}%) 🔒
                              </button>
                            </>
                          )}
                        </>
                      )}

                      {isThisLockWaiting && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="guide-status">
                            ● LOCK REQUEST SENT TO {firm.code} ({d.currentEquityPct}% · {d.currentShares.toLocaleString()} sh) · WAITING FOR {firm.code}…
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
                          🔒 PERMANENTLY LOCKED 1:1 WITH {firm.code} ({d.lockedAt}) · {d.currentEquityPct}% ({d.currentShares.toLocaleString()} SH · CALC ${d.currentPrice.toLocaleString()})
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
        <Panel title="5. Consulting crisis solution & updated MVP" tag="LOCKED UNTIL 1:1 CONSULTING EQUITY LOCK IS COMPLETE">
          <div className="guide-alert guide-warning">
            <b>
              {lockWaitingFirmCode
                ? `Lock Request Sent to Team ${lockWaitingFirmCode} — Switch to ${lockWaitingFirmCode}'s Consulting Tab to Accept Lock Request…`
                : "Offer Shares & Equity to a Consulting Team and Complete a Mutual 1:1 Lock Above"}
            </b>
            <br />
            1. Offer shares &amp; equity to Finance teams above (money calculates automatically from shares × share price).
            <br />
            2. Offer equity &amp; shares to a Consulting team, review any extra equity demand, and complete a mutual <b>1:1 Lock Request</b>.
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
                  As soon as Team <b>{lockedFirm.code}</b> clicks <b>Submit &amp; Deliver Solution</b> in their Consulting Round 2 tab, all 6 parts appear live right here!
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

          <Panel title="Locked 1:1 equity & cap-table summary" tag="PERMANENT · AUTO-CALC $">
            <div className="grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>LOCKED CONSULTANT</small>
                <b>Team {lockedFirm.code}</b>
                <span>{lockedDeal.currentEquityPct}% ({lockedDeal.currentShares.toLocaleString()} SH)</span>
              </div>
              <div className="guide-metric">
                <small>AUTO-CALC DEAL VALUE</small>
                <b>${lockedDeal.currentPrice.toLocaleString()}</b>
                <span>@ ${product.sharePrice.toFixed(2)}/SHARE</span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>CAP TABLE SPLIT</small>
                <b className="text-lg">{equityRetainedPct}% LEFT</b>
                <span>FIN {product.equityGivenFinancePct}% · CONS {product.equityGivenConsultantPct}%</span>
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
      Round 2 Share &amp; Equity flow: <b>1. Offer Shares &amp; Equity to Finance (Auto-Calc $)</b> → <b>2. Offer &amp; Negotiate Shares/Equity With Consulting Team</b> → <b>3. Mutual 1:1 Lock</b> → <b>4. Receive Live Solution &amp; Submit Updated MVP</b>.
    </div>
  </>;
}
