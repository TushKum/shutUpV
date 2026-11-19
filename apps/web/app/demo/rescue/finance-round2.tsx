"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageTitle, Panel, Metric, useTeamCode } from "../ui";
import {
  EmptyFilterState,
  INITIAL_LIST_FILTER,
  ListFilterBar,
  buildDealAmountRanges,
  matchesAmountFilter,
  uniqueSortedAmounts,
  type ListFilterState,
} from "../list-filter-bar";
import { useCoordination } from "../coordination-store";
import {
  getFinancePortfolio,
  getFinanceTeam,
  getProductMvpDisplayParts,
  getProductR2Lock,
  type LiveRaiseRequest,
  type ProductTeamState,
} from "../coordination-types";
import { FINANCE_ROUTES } from "../finance/_desk/routes";

export function FinanceRound2() {
  const rawCode = useTeamCode();
  const code = rawCode.startsWith("XF") ? rawCode : "XF01";
  const { state, dispatch } = useCoordination();

  const finTeam = useMemo(() => getFinanceTeam(state, code), [state, code]);
  const portfolio = useMemo(() => getFinancePortfolio(state, code), [state, code]);
  const products = useMemo(
    () => state.productOrder.map(pCode => state.products[pCode]!).filter(Boolean),
    [state.productOrder, state.products]
  );

  // Filters for Product Deal Room (Left Panel) & Portfolio (Right Panel)
  const [statusTab, setStatusTab] = useState<"ALL" | "OPEN" | "BACKED">("ALL");
  const [productFilter, setProductFilter] = useState<ListFilterState>(INITIAL_LIST_FILTER);
  const [portfolioFilter, setPortfolioFilter] = useState<ListFilterState>(INITIAL_LIST_FILTER);

  // MVP & Complete Details Modal Popup
  const [modalProductCode, setModalProductCode] = useState<string | null>(null);

  useEffect(() => {
    if (!modalProductCode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalProductCode(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalProductCode]);

  // Map each Product team -> its latest OPEN raise request (or latest funded request)
  const openRequestByProduct = useMemo(() => {
    const map = new Map<string, LiveRaiseRequest>();
    for (const r of state.raiseRequests) {
      if (r.status === "OPEN" && !map.has(r.productCode)) {
        map.set(r.productCode, r);
      }
    }
    return map;
  }, [state.raiseRequests]);

  const myDealsByProduct = useMemo(() => {
    const map = new Map<string, typeof portfolio>();
    for (const d of portfolio) {
      const list = map.get(d.productCode) ?? [];
      list.push(d);
      map.set(d.productCode, list);
    }
    return map;
  }, [portfolio]);

  const totalDeployed = useMemo(
    () => portfolio.reduce((sum, d) => sum + d.amountInvested, 0),
    [portfolio]
  );
  const uniqueCompaniesBacked = useMemo(
    () => new Set(portfolio.map(d => d.productCode)).size,
    [portfolio]
  );
  const openRequestCount = openRequestByProduct.size;

  // Check if XP01 (live Product user) has an open request right now for instant callout
  const liveXp01Request = openRequestByProduct.get("XP01") ?? null;

  // ── DEAL ROOM FILTER OPTIONS ──
  const productTeamOptions = useMemo(
    () =>
      products.map(p => {
        const req = openRequestByProduct.get(p.code);
        const backed = (myDealsByProduct.get(p.code)?.length ?? 0) > 0;
        const suffix = req
          ? ` — Ask $${req.amount.toLocaleString()} (${req.equityPct}%)`
          : backed
            ? " [IN PORTFOLIO ✓]"
            : " (No active ask)";
        return { code: p.code, label: `${p.code} · ${p.company}${suffix}` };
      }),
    [products, openRequestByProduct, myDealsByProduct]
  );

  const exactRequestAmounts = useMemo(
    () =>
      uniqueSortedAmounts(
        products
          .map(p => openRequestByProduct.get(p.code)?.amount)
          .filter((n): n is number => typeof n === "number" && n > 0)
      ),
    [products, openRequestByProduct]
  );

  const filteredProducts = useMemo(() => {
    const list = products.filter(p => {
      const req = openRequestByProduct.get(p.code);
      const myDeals = myDealsByProduct.get(p.code) ?? [];
      if (statusTab === "OPEN" && !req) return false;
      if (statusTab === "BACKED" && myDeals.length === 0) return false;
      if (productFilter.teamCode !== "ALL" && p.code !== productFilter.teamCode) return false;
      const amountFilterActive =
        productFilter.amountFilter !== "ALL" ||
        productFilter.minAmount.trim() !== "" ||
        productFilter.maxAmount.trim() !== "";
      if (amountFilterActive) {
        if (!req) return false;
        if (!matchesAmountFilter(req.amount, productFilter)) return false;
      }
      return true;
    });

    if (productFilter.sortBy === "AMOUNT_DESC") {
      return [...list].sort(
        (a, b) => (openRequestByProduct.get(b.code)?.amount ?? 0) - (openRequestByProduct.get(a.code)?.amount ?? 0)
      );
    }
    if (productFilter.sortBy === "AMOUNT_ASC") {
      return [...list].sort(
        (a, b) =>
          (openRequestByProduct.get(a.code)?.amount ?? Number.MAX_SAFE_INTEGER) -
          (openRequestByProduct.get(b.code)?.amount ?? Number.MAX_SAFE_INTEGER)
      );
    }
    if (productFilter.sortBy === "EQUITY_DESC") {
      return [...list].sort(
        (a, b) =>
          (openRequestByProduct.get(b.code)?.equityPct ?? 0) -
          (openRequestByProduct.get(a.code)?.equityPct ?? 0)
      );
    }
    if (productFilter.sortBy === "SCORE_DESC") {
      return [...list].sort((a, b) => b.r1Score - a.r1Score);
    }
    if (productFilter.sortBy === "CODE_ASC") {
      return [...list].sort((a, b) => a.code.localeCompare(b.code));
    }
    // Default sort: bubble XP01 live open request first, then other open non-passed requests, then backed/idle
    return [...list].sort((a, b) => {
      const rank = (p: ProductTeamState) => {
        const req = openRequestByProduct.get(p.code);
        if (req && p.code === "XP01") return 6;
        if (req && !req.passedBy.includes(code)) return 4;
        if (req && req.passedBy.includes(code)) return 2;
        if ((myDealsByProduct.get(p.code)?.length ?? 0) > 0) return 3;
        return 1;
      };
      return rank(b) - rank(a);
    });
  }, [products, openRequestByProduct, myDealsByProduct, statusTab, productFilter, code]);

  // ── PORTFOLIO FILTER OPTIONS ──
  const portfolioTeamOptions = useMemo(() => {
    const seen = new Map<string, { company: string; totalAmt: number; totalEq: number }>();
    for (const d of portfolio) {
      const cur = seen.get(d.productCode) ?? { company: d.company, totalAmt: 0, totalEq: 0 };
      seen.set(d.productCode, {
        company: d.company,
        totalAmt: cur.totalAmt + d.amountInvested,
        totalEq: Number((cur.totalEq + d.equityPct).toFixed(2)),
      });
    }
    return Array.from(seen.entries()).map(([pCode, info]) => ({
      code: pCode,
      label: `${pCode} · ${info.company} ($${info.totalAmt.toLocaleString()} · ${info.totalEq}%)`,
    }));
  }, [portfolio]);

  const exactPortfolioAmounts = useMemo(
    () => uniqueSortedAmounts(portfolio.map(d => d.amountInvested)),
    [portfolio]
  );

  const filteredPortfolio = useMemo(() => {
    const list = portfolio.filter(d => {
      if (portfolioFilter.teamCode !== "ALL" && d.productCode !== portfolioFilter.teamCode) return false;
      return matchesAmountFilter(d.amountInvested, portfolioFilter);
    });
    if (portfolioFilter.sortBy === "AMOUNT_DESC") {
      return [...list].sort((a, b) => b.amountInvested - a.amountInvested);
    }
    if (portfolioFilter.sortBy === "AMOUNT_ASC") {
      return [...list].sort((a, b) => a.amountInvested - b.amountInvested);
    }
    if (portfolioFilter.sortBy === "CODE_ASC") {
      return [...list].sort((a, b) => a.productCode.localeCompare(b.productCode));
    }
    return list;
  }, [portfolio, portfolioFilter]);

  const modalProduct = useMemo(
    () => (modalProductCode ? state.products[modalProductCode] ?? null : null),
    [modalProductCode, state.products]
  );
  const modalRequest = modalProduct ? openRequestByProduct.get(modalProduct.code) ?? null : null;
  const modalMvp = modalProduct ? getProductMvpDisplayParts(modalProduct) : null;

  const handleCloseDeal = (requestId: number) => {
    dispatch({
      type: "FINANCE_CLOSE_DEAL",
      financeCode: code,
      requestId,
    });
  };

  return (
    <>
      <PageTitle
        eyebrow={`ROUND 2 / PRODUCT MVP DEAL ROOM & EQUITY PORTFOLIO · ${finTeam.code} (${finTeam.name})`}
        title="Inspect Product MVPs and close equity deals."
        sub="Every Product team and their Round 1 MVP is listed below along with their live funding request (amount requested and equity offered). Open any team's full MVP popup, decide whether to close the deal or pass, and build a multi-company equity portfolio with your Round 1 capital."
      />

      <div className="guide-grid three">
        <Metric
          label="AVAILABLE CAPITAL"
          value={`$${finTeam.availableCapital.toLocaleString()}`}
          delta={`STARTED R1 WITH $${finTeam.initialCapital.toLocaleString()} · DEPLOYED $${totalDeployed.toLocaleString()}`}
        />
        <Metric
          label="OPEN RAISE REQUESTS"
          value={`${openRequestCount} LIVE`}
          delta={
            liveXp01Request
              ? `⚡ XP01 ASKING $${liveXp01Request.amount.toLocaleString()} FOR ${liveXp01Request.equityPct}% EQUITY`
              : `${products.length} PRODUCT TEAMS & MVPS AVAILABLE`
          }
        />
        <Metric
          label="PORTFOLIO HOLDINGS"
          value={`${portfolio.length} DEAL${portfolio.length === 1 ? "" : "S"}`}
          delta={
            uniqueCompaniesBacked > 0
              ? `BACKED ${uniqueCompaniesBacked} PRODUCT COMPAN${uniqueCompaniesBacked === 1 ? "Y" : "IES"} · MULTIPLE DEALS ALLOWED`
              : "NO DEALS CLOSED YET · CLOSE DEALS BELOW"
          }
        />
      </div>

      <div className="guide-grid two mt-4">
        {/* ── PANEL 1: ALL PRODUCT TEAMS, LIVE RAISE REQUESTS & MVP POPUP ── */}
        <Panel
          title="1. Product teams, Round 1 MVPs & live funding requests"
          tag={`${openRequestCount} OPEN REQUESTS · CLICK MVP FOR FULL DETAILS`}
        >
          {liveXp01Request && (
            <div className="guide-alert guide-warning mb-3 flex flex-wrap items-center justify-between gap-2">
              <span>
                <b>⚡ Live Raise Request from XP01 ({state.products.XP01?.company}):</b> Asking{" "}
                <b>${liveXp01Request.amount.toLocaleString()}</b> for{" "}
                <b>{liveXp01Request.equityPct}% equity</b> (Implied Val: ${liveXp01Request.impliedValuation.toLocaleString()}).
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className="guide-btn secondary guide-filter-reset"
                  onClick={() => setModalProductCode("XP01")}
                >
                  VIEW XP01 MVP
                </button>
                <button
                  type="button"
                  className="guide-btn guide-filter-reset"
                  disabled={finTeam.availableCapital < liveXp01Request.amount}
                  onClick={() => handleCloseDeal(liveXp01Request.id)}
                >
                  CLOSE DEAL ✓
                </button>
              </div>
            </div>
          )}

          <div className="guide-tabs mb-3">
            <button
              type="button"
              className={statusTab === "ALL" ? "active" : ""}
              onClick={() => setStatusTab("ALL")}
            >
              ALL PRODUCTS ({products.length})
            </button>
            <button
              type="button"
              className={statusTab === "OPEN" ? "active" : ""}
              onClick={() => setStatusTab("OPEN")}
            >
              OPEN RAISE REQUESTS ({openRequestCount})
            </button>
            <button
              type="button"
              className={statusTab === "BACKED" ? "active" : ""}
              onClick={() => setStatusTab("BACKED")}
            >
              IN MY PORTFOLIO ({uniqueCompaniesBacked})
            </button>
          </div>

          <ListFilterBar
            value={productFilter}
            onChange={setProductFilter}
            teamOptions={productTeamOptions}
            teamLabel="PRODUCT TEAM CODE"
            allTeamsLabel="All Product Teams"
            amountLabel="REQUESTED AMOUNT FILTER"
            amountRanges={buildDealAmountRanges()}
            exactAmounts={exactRequestAmounts}
            minPlaceholder="e.g. 30000"
            maxPlaceholder="e.g. 50000"
            sortOptions={[
              { value: "DEFAULT", label: "Live Requests First" },
              { value: "AMOUNT_DESC", label: "Ask Amount: High → Low" },
              { value: "AMOUNT_ASC", label: "Ask Amount: Low → High" },
              { value: "EQUITY_DESC", label: "Equity Offered: High → Low" },
              { value: "SCORE_DESC", label: "R1 MVP Score: High → Low" },
              { value: "CODE_ASC", label: "Team Code: A → Z" },
            ]}
            totalCount={products.length}
            filteredCount={filteredProducts.length}
            itemNoun="product teams"
          />

          <div className="guide-scroll-box space-y-3">
            {filteredProducts.length === 0 ? (
              <EmptyFilterState
                noun="product teams"
                onReset={() => {
                  setStatusTab("ALL");
                  setProductFilter(INITIAL_LIST_FILTER);
                }}
              />
            ) : (
              filteredProducts.map(p => {
                const req = openRequestByProduct.get(p.code) ?? null;
                const myDeals = myDealsByProduct.get(p.code) ?? [];
                const myTotalInvested = myDeals.reduce((s, d) => s + d.amountInvested, 0);
                const myTotalEquity = Number(myDeals.reduce((s, d) => s + d.equityPct, 0).toFixed(2));
                const isPassed = req ? req.passedBy.includes(code) : false;
                const canAfford = req ? finTeam.availableCapital >= req.amount : false;
                const latestFundedByOther = !req
                  ? state.raiseRequests.find(
                      r => r.productCode === p.code && r.status === "FUNDED" && r.fundedBy !== code
                    )
                  : null;

                return (
                  <div
                    key={p.code}
                    className="border border-[#294832] p-3.5"
                    style={{ opacity: isPassed ? 0.52 : 1 }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className={`guide-chip ${req && !isPassed ? "active" : ""}`}>
                          {p.code} · {p.ticker} · R1 {p.r1Score}/100
                        </span>
                        <b className="ml-2 text-sm">{p.company}</b>
                      </div>
                      <span className="guide-status">
                        {req
                          ? isPassed
                            ? "PASSED BY YOUR DESK · STILL OPEN"
                            : `⚡ ASKING $${req.amount.toLocaleString()} FOR ${req.equityPct}% EQUITY`
                          : myDeals.length > 0
                            ? `✓ IN YOUR PORTFOLIO (${myTotalEquity}% · $${myTotalInvested.toLocaleString()})`
                            : latestFundedByOther
                              ? `FUNDED BY ${latestFundedByOther.fundedBy} ($${latestFundedByOther.amount.toLocaleString()})`
                              : "NO ACTIVE RAISE REQUEST YET"}
                      </span>
                    </div>

                    <p className="guide-muted mt-1.5">
                      <b>{p.sector}:</b> {p.pitchLine}
                    </p>

                    {req ? (
                      <>
                        <div className="mt-2.5 grid grid-cols-3 gap-2 text-[10px] font-mono">
                          <div className="border border-[#294832] p-2">
                            <span className="block text-[#9ba2ad]">MONEY REQUESTED</span>
                            <b className="mt-0.5 block text-[#f0f1f4]">${req.amount.toLocaleString()}</b>
                          </div>
                          <div className="border border-[#294832] p-2">
                            <span className="block text-[#9ba2ad]">EQUITY OFFERED</span>
                            <b className="mt-0.5 block text-[#ffd84d]">{req.equityPct}% EQUITY</b>
                          </div>
                          <div className="border border-[#294832] p-2">
                            <span className="block text-[#9ba2ad]">IMPLIED VALUATION</span>
                            <b className="mt-0.5 block text-[#f0f1f4]">${req.impliedValuation.toLocaleString()}</b>
                          </div>
                        </div>
                        {req.note && (
                          <p className="guide-muted mt-2">
                            <b>Founder Note:</b> &ldquo;{req.note}&rdquo;
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="mt-2.5 grid grid-cols-3 gap-2 text-[10px] font-mono">
                        <div className="border border-[#294832] p-2">
                          <span className="block text-[#9ba2ad]">RAISED SO FAR</span>
                          <b className="mt-0.5 block text-[#f0f1f4]">${p.raisedCash.toLocaleString()}</b>
                        </div>
                        <div className="border border-[#294832] p-2">
                          <span className="block text-[#9ba2ad]">EQUITY DILUTED</span>
                          <b className="mt-0.5 block text-[#f0f1f4]">{p.equityGivenPct}%</b>
                        </div>
                        <div className="border border-[#294832] p-2">
                          <span className="block text-[#9ba2ad]">R1 MVP STATUS</span>
                          <b className="mt-0.5 block text-[#ffd84d]">{p.r1SubmittedAt ? "SUBMITTED ✓" : "BASELINE READY"}</b>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="guide-btn secondary"
                        onClick={() => setModalProductCode(p.code)}
                      >
                        VIEW FULL MVP &amp; DETAILS ↗
                      </button>

                      {req && !isPassed && (
                        <>
                          <button
                            type="button"
                            disabled={!canAfford}
                            className="guide-btn"
                            onClick={() => handleCloseDeal(req.id)}
                          >
                            {canAfford
                              ? `CLOSE DEAL ($${req.amount.toLocaleString()} FOR ${req.equityPct}%) ✓`
                              : `INSUFFICIENT CAPITAL ($${finTeam.availableCapital.toLocaleString()} LEFT)`}
                          </button>
                          <button
                            type="button"
                            className="guide-btn secondary"
                            onClick={() =>
                              dispatch({
                                type: "FINANCE_PASS_REQUEST",
                                financeCode: code,
                                requestId: req.id,
                              })
                            }
                          >
                            PASS
                          </button>
                        </>
                      )}

                      {req && isPassed && (
                        <button
                          type="button"
                          className="guide-btn secondary"
                          onClick={() =>
                            dispatch({
                              type: "FINANCE_UNPASS_REQUEST",
                              financeCode: code,
                              requestId: req.id,
                            })
                          }
                        >
                          RECONSIDER DEAL
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Panel>

        {/* ── PANEL 2: LIVE FINANCE EQUITY PORTFOLIO (MULTIPLE DEALS SUPPORTED) ── */}
        <Panel
          title={`2. ${finTeam.name} (${finTeam.code}) — Live equity portfolio`}
          tag={`${portfolio.length} CLOSED DEALS · $${totalDeployed.toLocaleString()} DEPLOYED`}
        >
          <p className="guide-muted mb-3">
            Your Finance team can close deals with <b>multiple Product teams</b> as long as you have capital available. Every closed deal immediately updates your cash balance, equity stakes, and the Product team&apos;s live balance.
          </p>

          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="guide-metric">
              <small>R1 CAPITAL</small>
              <b className="!text-base">${finTeam.initialCapital.toLocaleString()}</b>
              <span>STARTING</span>
            </div>
            <div className="guide-metric">
              <small>CASH LEFT</small>
              <b className="!text-base">${finTeam.availableCapital.toLocaleString()}</b>
              <span>DEPLOYABLE</span>
            </div>
            <div className="guide-metric">
              <small>DEPLOYED</small>
              <b className="!text-base">${totalDeployed.toLocaleString()}</b>
              <span>{Math.round((totalDeployed / finTeam.initialCapital) * 100)}% USED</span>
            </div>
            <div className="guide-metric">
              <small>COMPANIES</small>
              <b className="!text-base">{uniqueCompaniesBacked}</b>
              <span>{portfolio.length} TOTAL DEALS</span>
            </div>
          </div>

          {portfolio.length === 0 ? (
            <div className="guide-alert">
              <b>Your Round 2 Venture Portfolio is empty.</b>
              <br />
              Inspect Product MVPs on the left via <b>View Full MVP &amp; Details</b> and click <b>Close Deal</b> on one or more Product teams to acquire equity stakes.
            </div>
          ) : (
            <>
              <ListFilterBar
                value={portfolioFilter}
                onChange={setPortfolioFilter}
                teamOptions={portfolioTeamOptions}
                teamLabel="BACKED PRODUCT TEAM"
                allTeamsLabel="All Portfolio Companies"
                amountLabel="INVESTMENT AMOUNT"
                amountRanges={buildDealAmountRanges()}
                exactAmounts={exactPortfolioAmounts}
                totalCount={portfolio.length}
                filteredCount={filteredPortfolio.length}
                itemNoun="portfolio deals"
              />

              <div className="guide-scroll-box compact space-y-2.5">
                {filteredPortfolio.length === 0 ? (
                  <EmptyFilterState
                    noun="portfolio deals"
                    onReset={() => setPortfolioFilter(INITIAL_LIST_FILTER)}
                  />
                ) : (
                  filteredPortfolio.map(deal => {
                    const pLive = state.products[deal.productCode];
                    const r2ConsultantLock = getProductR2Lock(state, deal.productCode);
                    return (
                      <div key={deal.id} className="border border-[#294832] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="guide-chip active">
                              {deal.productCode} · {deal.ticker}
                            </span>
                            <b className="ml-2 text-sm">{deal.company}</b>
                          </div>
                          <span className="font-mono text-sm font-bold text-[#ffd84d]">
                            {deal.equityPct}% EQUITY · ${deal.amountInvested.toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] font-mono">
                          <div className="border border-[#294832] p-1.5">
                            <span className="block text-[#9ba2ad]">IMPLIED VAL</span>
                            <b className="text-[#f0f1f4]">${deal.impliedValuation.toLocaleString()}</b>
                          </div>
                          <div className="border border-[#294832] p-1.5">
                            <span className="block text-[#9ba2ad]">CONSULTANT</span>
                            <b className="text-[#f0f1f4]">
                              {r2ConsultantLock ? `LOCKED ${r2ConsultantLock.consultingCode}` : "HIRING…"}
                            </b>
                          </div>
                          <div className="border border-[#294832] p-1.5">
                            <span className="block text-[#9ba2ad]">R2 MVP</span>
                            <b className="text-[#ffd84d]">
                              {pLive?.r2MvpSubmittedAt ? "UPDATED ✓" : `CLOSED ${deal.closedAt}`}
                            </b>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[10px]">
                          <span className="guide-muted">{deal.sector}</span>
                          <button
                            type="button"
                            className="font-mono text-[10px] text-[#ffd84d] underline"
                            onClick={() => setModalProductCode(deal.productCode)}
                          >
                            INSPECT MVP ↗
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#292e38] pt-4">
            <span className="guide-muted">
              Your equity portfolio &amp; cash carry straight into Round 3 Trading.
            </span>
            <Link href={FINANCE_ROUTES.overview} className="guide-btn">
              OPEN FINANCE DESK →
            </Link>
          </div>
        </Panel>
      </div>

      {/* ── COMPLETE PRODUCT MVP & DETAILS POPUP MODAL ── */}
      {modalProduct && modalMvp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mvp-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setModalProductCode(null)}
        >
          <div
            className="w-full max-w-3xl rounded-xl border border-[#ffd84d]/35 bg-[#0e1118] p-5 text-[#e6e8ed] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#292e38] pb-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="guide-chip active">
                    {modalProduct.code} · {modalProduct.ticker}
                  </span>
                  <span className="font-mono text-[10px] text-[#9ba2ad]">{modalProduct.sector}</span>
                  <span className="font-mono text-[10px] text-[#ffd84d]">
                    R1 SCORE {modalProduct.r1Score}/100 · {modalMvp.isLiveWritten ? "LIVE R1 SUBMISSION" : "BASELINE MVP"}
                  </span>
                </div>
                <h2 id="mvp-modal-title" className="mt-2 text-xl font-bold text-[#f0f1f4]">
                  {modalProduct.company} — Complete Round 1 MVP &amp; Deal Brief
                </h2>
                <p className="guide-muted mt-1">{modalProduct.pitchLine}</p>
              </div>
              <button
                type="button"
                className="guide-btn secondary"
                onClick={() => setModalProductCode(null)}
              >
                CLOSE ✕
              </button>
            </div>

            {/* Active Funding Ask Summary inside Popup */}
            {modalRequest ? (
              <div className="guide-alert guide-warning mt-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <b>ACTIVE FUNDING REQUEST:</b> Seeking <b>${modalRequest.amount.toLocaleString()}</b> for{" "}
                  <b>{modalRequest.equityPct}% equity</b> (Implied Valuation:{" "}
                  <b>${modalRequest.impliedValuation.toLocaleString()}</b>)
                  {modalRequest.note ? ` — "${modalRequest.note}"` : ""}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={finTeam.availableCapital < modalRequest.amount}
                    className="guide-btn"
                    onClick={() => {
                      handleCloseDeal(modalRequest.id);
                    }}
                  >
                    {finTeam.availableCapital >= modalRequest.amount
                      ? `CLOSE DEAL ($${modalRequest.amount.toLocaleString()} FOR ${modalRequest.equityPct}%) ✓`
                      : "INSUFFICIENT CAPITAL"}
                  </button>
                  {!modalRequest.passedBy.includes(code) && (
                    <button
                      type="button"
                      className="guide-btn secondary"
                      onClick={() =>
                        dispatch({
                          type: "FINANCE_PASS_REQUEST",
                          financeCode: code,
                          requestId: modalRequest.id,
                        })
                      }
                    >
                      PASS
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="guide-alert mt-3">
                <b>Funding Status:</b> Total Raised <b>${modalProduct.raisedCash.toLocaleString()}</b> · Equity Diluted{" "}
                <b>{modalProduct.equityGivenPct}%</b> · No open funding request at this moment.
              </div>
            )}

            {/* Complete 7-Part MVP + Round 2 Crisis Details (Scrolls Inside Popup) */}
            <div className="guide-scroll-box mt-4 space-y-2.5">
              {modalMvp.sections.map(sec => (
                <div key={sec.title} className="border border-[#292e38] bg-[#131722] p-3">
                  <span className="guide-status">{sec.title}</span>
                  <p className="guide-muted mt-1">{sec.body}</p>
                </div>
              ))}
              <div className="guide-alert guide-warning">
                <b>ROUND 2 CRISIS HITTING {modalProduct.company.toUpperCase()}: {modalProduct.crisisCategory}</b>
                <br />
                <b>{modalProduct.crisisTitle}:</b> {modalProduct.crisisBody}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#292e38] pt-3">
              <span className="font-mono text-[10px] text-[#9ba2ad]">
                YOUR AVAILABLE CAPITAL ({finTeam.code}): <b className="text-[#ffd84d]">${finTeam.availableCapital.toLocaleString()}</b>
              </span>
              <button
                type="button"
                className="guide-btn secondary"
                onClick={() => setModalProductCode(null)}
              >
                DONE
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="guide-alert mt-4">
        Finance Round 2 flow: <b>1. Review All Product Teams &amp; Open Full MVP Popups</b> → <b>2. Evaluate Money Requested vs. Equity Offered</b> → <b>3. Close Deals With One or Multiple Product Teams</b> → <b>4. Portfolio &amp; Available Cash Update Live Across Both Workspaces</b>.
      </div>
    </>
  );
}
