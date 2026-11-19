"use client";
import {useEffect,useMemo,useState} from "react";
import {PageTitle,Panel,Metric,useTeamCode} from "../ui";

interface FinanceTeam {
  code: string;
  name: string;
  availableCapital: number;
  focus: string;
  lastAction: string;
}

interface RaiseRecord {
  id: number;
  amount: number;
  equityPct: number;
  status: "BROADCASTING" | "FUNDED";
  fundedBy?: string;
  fundedByName?: string;
  timestamp: string;
}

const INITIAL_FINANCE_TEAMS: FinanceTeam[] = [
  { code: "XF01", name: "Vanguard Capital", availableCapital: 500000, focus: "FMCG & High-Velocity Consumer", lastAction: "Reviewing Round 1 MVPs" },
  { code: "XF02", name: "Apex Sovereign Fund", availableCapital: 460000, focus: "FinTech & B2B Infrastructure", lastAction: "Active · Open to equity pitches" },
  { code: "XF05", name: "Crestline Ventures", availableCapital: 520000, focus: "Turnaround & Growth Equity", lastAction: "Active · Open to equity pitches" },
  { code: "XF08", name: "Ironclad Partners", availableCapital: 390000, focus: "HealthTech & CleanTech", lastAction: "Reviewing Round 1 MVPs" },
  { code: "XF11", name: "Meridian Capital", availableCapital: 440000, focus: "Multi-Sector Seed & Bridge", lastAction: "Active · Open to equity pitches" },
];

interface ConsultingFirm {
  code: string;
  r1Score: number;
  baseValue: number;
  speciality: string;
  counterMarkupPct: number;
  solutionSummary: {
    diagnosis: string;
    recommendation: string;
    perPackMaths: string;
    timeline: string;
    risks: string;
  };
}

const CONSULTING_TEAMS: ConsultingFirm[] = [
  {
    code: "XC01",
    r1Score: 82,
    baseValue: 40000,
    speciality: "Pricing Turnarounds, GST Structuring & FMCG Margins",
    counterMarkupPct: 10,
    solutionSummary: {
      diagnosis:
        "The 12% → 18% GST jump adds ₹1.07/pack tax burden while the 3% retailer margin demand adds ₹0.60/pack—wiping out ₹1.67/pack of contribution margin unless SKU architecture changes.",
      recommendation:
        "Re-architect the core SKU from a single ₹20 pouch to a ₹22 'Electrolyte+ Mini-Pack' (10% lighter volume, same hydration dose) while shifting 30% of volume to direct school-canteen bulk boxes.",
      perPackMaths:
        "New MRP ₹22.00 · Net realisation after 18% GST ₹18.64 · COGS ₹10.40 (re-sized pouch) · Retailer margin ₹3.10 (protected) · Net contribution ₹5.14/pack · Break-even drops to 34,000 packs/mo.",
      timeline:
        "Week 1: Lock Pune foil supplier for revised pack size. Week 2: Pilot ₹22 pack in 40 Tier-1 stores & sign 15 school canteens. Week 3–4: National distributor rollover.",
      risks:
        "If urban parents resist the ₹22 price point, launch a ₹99 5-pack value bundle (₹19.80/pack effective) for modern trade & quick-commerce.",
    },
  },
  {
    code: "XC04",
    r1Score: 78,
    baseValue: 36000,
    speciality: "Supply Chain Optimization & Retail Distribution",
    counterMarkupPct: 0,
    solutionSummary: {
      diagnosis:
        "Unchanged MRP under 18% GST plus higher retailer demands compresses contribution margin below working-capital break-even within 45 days.",
      recommendation:
        "Consolidate regional co-packers to cut COGS by 11% and offer retailers volume-linked quarterly rebates instead of flat upfront shelf margins.",
      perPackMaths:
        "MRP ₹20.00 · Net after 18% GST ₹16.95 · New COGS ₹10.65 · Channel margin ₹2.60 + ₹0.40 rebate · Net contribution ₹3.30/pack · Break-even at 38,500 packs/mo.",
      timeline:
        "Week 1: Renegotiate toll-manufacturing contract. Week 2: Roll out tiered distributor slab. Week 3–4: Replenish top 300 outlets.",
      risks:
        "Single co-packer concentration risk mitigated by retaining secondary supplier at 20% standby volume.",
    },
  },
  {
    code: "XC07",
    r1Score: 88,
    baseValue: 46000,
    speciality: "High-Margin D2C Positioning & Crisis Recovery",
    counterMarkupPct: 20,
    solutionSummary: {
      diagnosis:
        "Retailers hold pricing leverage because 85% of revenue depends on general trade; the GST hike exposes weak channel diversification.",
      recommendation:
        "Reposition AquaCare into a dual-tier MVP: keep an entry ₹20 sachet in kiranas while launching a ₹149 weekly school-hydration subscription box direct to parents via WhatsApp & D2C.",
      perPackMaths:
        "D2C 7-pack at ₹149 (₹21.28/pack) eliminates ₹2.90 distributor cut; blended gross margin rises from 27% to 41% within 6 weeks.",
      timeline:
        "Week 1: Launch WhatsApp subscription MVP flow. Week 2: Partner with 25 parent communities. Week 3–4: Rebalance retail allocation to top-performing stores.",
      risks:
        "Higher D2C delivery cost offset by restricting subscriptions to multi-pack weekly drops.",
    },
  },
  {
    code: "XC12",
    r1Score: 74,
    baseValue: 32000,
    speciality: "Cost Restructuring & Packaging Value Engineering",
    counterMarkupPct: 15,
    solutionSummary: {
      diagnosis:
        "Combined tax and trade-margin shock cuts monthly operating cash flow by ₹6.8 lakh unless packaging and ingredient costs are re-engineered.",
      recommendation:
        "Switch to mono-material recyclable pouches (−₹1.20/pack) and introduce a ₹15 compact trial SKU alongside a ₹25 family pack.",
      perPackMaths:
        "Blended realization ₹19.10 net of GST · Blended COGS ₹10.50 · Trade margin ₹3.00 · Net contribution ₹5.60/unit.",
      timeline:
        "Week 1: Approve mono-material pouch print plates. Week 2: Test stability. Week 3–4: Dispatch dual-SKU assortment.",
      risks:
        "Transition inventory overlap managed via 15-day clearance discount on legacy stock.",
    },
  },
];

const mvpUpdateParts = [
  "Crisis Impact on Our MVP",
  "Consulting Solution Adopted",
  "Revised MVP Features & Spec",
  "Updated Unit Maths & Pricing",
  "Rollout & Recovery Timeline",
  "Residual Risks & Mitigations",
];

const mvpUpdateGuides = [
  "Explain how the Round 2 crisis (GST hike 12% → 18% and retailer margin pressure) breaks your original Round 1 MVP economics.",
  "Write how your Product team adopts and integrates your locked Consulting team's crisis solution directly into your product strategy.",
  "Detail the exact changes to your MVP features, SKU / pack architecture, or user experience based on the consultant's solution.",
  "Show the revised pricing, unit cost, GST impact, margin and break-even numbers in your updated MVP.",
  "Lay out the week-by-week timeline to ship these MVP updates and recover market share.",
  "List remaining risks after updating the MVP and your fallback plan.",
];

type ProposalStage =
  | "AVAILABLE"
  | "REQUEST_SENT_WAITING"
  | "PRICE_INCREASE_DEMANDED"
  | "PROPOSAL_ACCEPTED_UNLOCKED"
  | "LOCK_SENT_WAITING"
  | "LOCKED_1_TO_1"
  | "DECLINED";

interface ConsultingNegotiation {
  stage: ProposalStage;
  offeredPrice: number;
  demandedPrice: number;
  extraOverBase: number;
  extraOverBasePct: number;
  lockedAt?: string;
}

function initNegotiations(): Record<string, ConsultingNegotiation> {
  const map: Record<string, ConsultingNegotiation> = {};
  for (const f of CONSULTING_TEAMS) {
    map[f.code] = {
      stage: "AVAILABLE",
      offeredPrice: f.baseValue,
      demandedPrice: f.baseValue,
      extraOverBase: 0,
      extraOverBasePct: 0,
    };
  }
  return map;
}

export function ProductRound2() {
  const code = useTeamCode();
  const [companyMeta, setCompanyMeta] = useState({
    company: "AquaCare",
    ticker: "QAAC",
    sector: "SECTOR 01 · FMCG & CONSUMER",
  });

  // ── FINANCE FUNDRAISING STATE (Product team starts with $0 cash and 100% equity) ──
  const [financeTeams, setFinanceTeams] = useState<FinanceTeam[]>(INITIAL_FINANCE_TEAMS);
  const [raisedCash, setRaisedCash] = useState<number>(0);
  const [equityGivenPct, setEquityGivenPct] = useState<number>(0);
  const [reqAmountInput, setReqAmountInput] = useState<string>("");
  const [reqEquityInput, setReqEquityInput] = useState<string>("");
  const [raiseNote, setRaiseNote] = useState<string>("");
  const [raiseBroadcasting, setRaiseBroadcasting] = useState<boolean>(false);
  const [raiseHistory, setRaiseHistory] = useState<RaiseRecord[]>([]);

  const reqAmount = Math.max(0, Number(reqAmountInput) || 0);
  const reqEquityPct = Math.max(0, Number(reqEquityInput) || 0);

  // ── CONSULTING HIRE & LOCK STATE ──
  const [negos, setNegos] = useState<Record<string, ConsultingNegotiation>>(initNegotiations);
  const [active, setActive] = useState(0);
  const [mvpValues, setMvpValues] = useState<string[]>(Array(6).fill(""));
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("primus-product-r1-meta");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.company) {
          setCompanyMeta({
            company: parsed.company,
            ticker: parsed.ticker || "QAAC",
            sector: parsed.sector || "SECTOR 01 · FMCG & CONSUMER",
          });
        }
      }
    } catch {}
  }, []);

  const lockedFirmCode = useMemo(() => {
    for (const f of CONSULTING_TEAMS) {
      if (negos[f.code]?.stage === "LOCKED_1_TO_1") return f.code;
    }
    return null;
  }, [negos]);

  const lockWaitingFirmCode = useMemo(() => {
    for (const f of CONSULTING_TEAMS) {
      if (negos[f.code]?.stage === "LOCK_SENT_WAITING") return f.code;
    }
    return null;
  }, [negos]);

  const isLockedOrLockPending = lockedFirmCode !== null || lockWaitingFirmCode !== null;
  const lockedFirm = useMemo(() => CONSULTING_TEAMS.find(f => f.code === lockedFirmCode) ?? null, [lockedFirmCode]);
  const lockedNego = lockedFirmCode ? negos[lockedFirmCode] : null;

  // Cash available after paying locked consulting team (starts at $0!)
  const availableCash = Math.max(0, raisedCash - (lockedNego ? lockedNego.demandedPrice : 0));
  const equityRetainedPct = Math.max(0, Number((100 - equityGivenPct).toFixed(2)));
  const impliedValuation = reqEquityPct > 0 ? Math.round(reqAmount / (reqEquityPct / 100)) : 0;

  // Broadcast overall raise request to ALL Finance teams (never to a single finance team)
  const handleBroadcastRaise = () => {
    if (raiseBroadcasting || reqAmount <= 0 || reqEquityPct <= 0 || reqEquityPct > equityRetainedPct) return;
    const id = Date.now();
    const amount = reqAmount;
    const eq = reqEquityPct;
    const stamp = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " IST";

    setRaiseBroadcasting(true);
    setRaiseHistory(prev => [
      { id, amount, equityPct: eq, status: "BROADCASTING", timestamp: stamp },
      ...prev,
    ]);
    setFinanceTeams(prev =>
      prev.map(ft => ({
        ...ft,
        lastAction: `Reviewing overall request: ${eq}% equity for $${amount.toLocaleString()}…`,
      }))
    );

    // Finance sector evaluates your Round 1 MVP and a Finance team with sufficient capital funds the request
    window.setTimeout(() => {
      setFinanceTeams(prev => {
        const eligibleIndex = prev.findIndex(ft => ft.availableCapital >= amount);
        const chosen = eligibleIndex >= 0 ? prev[eligibleIndex]! : prev[0]!;
        setRaisedCash(c => c + amount);
        setEquityGivenPct(e => Number((e + eq).toFixed(2)));
        setRaiseHistory(hist =>
          hist.map(item =>
            item.id === id
              ? { ...item, status: "FUNDED", fundedBy: chosen.code, fundedByName: chosen.name }
              : item
          )
        );
        setRaiseBroadcasting(false);
        return prev.map((ft, idx) =>
          idx === (eligibleIndex >= 0 ? eligibleIndex : 0)
            ? {
                ...ft,
                availableCapital: Math.max(0, ft.availableCapital - amount),
                lastAction: `✓ Funded $${amount.toLocaleString()} for ${eq}% equity (MVP approved)`,
              }
            : {
                ...ft,
                lastAction: `Passed / filled by ${chosen.code} · Capital intact`,
              }
        );
      });
    }, 1500);
  };

  // Step 1 (Consulting): Send proposal request to a desired consulting team
  const handleSendProposal = (firmCode: string) => {
    if (isLockedOrLockPending) return;
    const firm = CONSULTING_TEAMS.find(f => f.code === firmCode)!;
    setNegos(prev => ({
      ...prev,
      [firmCode]: {
        stage: "REQUEST_SENT_WAITING",
        offeredPrice: firm.baseValue,
        demandedPrice: firm.baseValue,
        extraOverBase: 0,
        extraOverBasePct: 0,
      },
    }));

    window.setTimeout(() => {
      setNegos(prev => {
        const cur = prev[firmCode];
        if (!cur || cur.stage !== "REQUEST_SENT_WAITING") return prev;
        if (firm.counterMarkupPct > 0) {
          const demanded = Math.round(firm.baseValue * (1 + firm.counterMarkupPct / 100));
          return {
            ...prev,
            [firmCode]: {
              stage: "PRICE_INCREASE_DEMANDED",
              offeredPrice: firm.baseValue,
              demandedPrice: demanded,
              extraOverBase: demanded - firm.baseValue,
              extraOverBasePct: firm.counterMarkupPct,
            },
          };
        }
        return {
          ...prev,
          [firmCode]: {
            stage: "PROPOSAL_ACCEPTED_UNLOCKED",
            offeredPrice: firm.baseValue,
            demandedPrice: firm.baseValue,
            extraOverBase: 0,
            extraOverBasePct: 0,
          },
        };
      });
    }, 1100);
  };

  const handleAcceptPriceIncrease = (firmCode: string) => {
    if (isLockedOrLockPending) return;
    setNegos(prev => {
      const cur = prev[firmCode]!;
      return {
        ...prev,
        [firmCode]: {
          ...cur,
          stage: "PROPOSAL_ACCEPTED_UNLOCKED",
          offeredPrice: cur.demandedPrice,
        },
      };
    });
  };

  const handleDeclineDemand = (firmCode: string) => {
    if (isLockedOrLockPending) return;
    const firm = CONSULTING_TEAMS.find(f => f.code === firmCode)!;
    setNegos(prev => ({
      ...prev,
      [firmCode]: {
        stage: "DECLINED",
        offeredPrice: firm.baseValue,
        demandedPrice: firm.baseValue,
        extraOverBase: 0,
        extraOverBasePct: 0,
      },
    }));
  };

  // Send Lock Request (requires sufficient raised cash from Finance teams!)
  const handleSendLockRequest = (firmCode: string) => {
    if (isLockedOrLockPending) return;
    const n = negos[firmCode]!;
    if (availableCash < n.demandedPrice) return;
    setNegos(prev => ({
      ...prev,
      [firmCode]: {
        ...prev[firmCode]!,
        stage: "LOCK_SENT_WAITING",
      },
    }));

    window.setTimeout(() => {
      const stamp = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " IST";
      setNegos(prev => {
        const cur = prev[firmCode];
        if (!cur || cur.stage !== "LOCK_SENT_WAITING") return prev;
        return {
          ...prev,
          [firmCode]: {
            ...cur,
            stage: "LOCKED_1_TO_1",
            lockedAt: stamp,
          },
        };
      });
    }, 1400);
  };

  const handleCopySolutionIntoMvp = () => {
    if (!lockedFirm || submittedAt) return;
    const s = lockedFirm.solutionSummary;
    setMvpValues([
      s.diagnosis,
      `Adopting Team ${lockedFirm.code}'s crisis turnaround plan: ${s.recommendation}`,
      `Updated MVP Architecture: ${s.recommendation}`,
      s.perPackMaths,
      s.timeline,
      s.risks,
    ]);
  };

  const mvpCount = useMemo(() => mvpValues.reduce((n, v) => n + v.trim().split(/\s+/).filter(Boolean).length, 0), [mvpValues]);

  const handleSubmitUpdatedMvp = () => {
    if (!lockedFirm || submittedAt || mvpCount === 0) return;
    const stamp = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " IST";
    setSubmittedAt(stamp);
  };

  return <>
    <PageTitle
      eyebrow={`ROUND 2 / RAISE FROM FINANCE, HIRE CONSULTANT & UPDATE MVP · ${code}`}
      title="Raise funds from Finance, lock a Consultant, and update your MVP."
      sub="Product teams start with $0 cash. First, broadcast an overall equity-for-cash raise request to ALL Finance teams (based on your Round 1 MVP) so you have the money to pay a Consulting team. Then negotiate, lock 1-to-1 with a Consulting team, and write their crisis solution into your MVP."
    />

    <div className="guide-grid three">
      <Metric
        label="PRODUCT CASH BALANCE"
        value={`$${availableCash.toLocaleString()}`}
        delta={
          raisedCash === 0
            ? "STARTED WITH $0 · RAISE FROM FINANCE BELOW"
            : lockedNego
              ? `RAISED $${raisedCash.toLocaleString()} − PAID $${lockedNego.demandedPrice.toLocaleString()} TO ${lockedFirm!.code}`
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
            ? `${code} ⇄ ${lockedFirm.code} · SOLUTION READY FOR MVP`
            : lockWaitingFirmCode
              ? `AWAITING ${lockWaitingFirmCode} LOCK ACCEPTANCE…`
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
              disabled={raiseBroadcasting}
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
              disabled={raiseBroadcasting}
              className="guide-input font-mono"
              placeholder="e.g. 30000"
              value={reqAmountInput}
              onChange={e => setReqAmountInput(e.target.value)}
            />
          </div>
        </div>

        <label className="guide-label">YOUR OFFER NOTE TO ALL FINANCE TEAMS (OPTIONAL · LINKED TO YOUR R1 MVP)</label>
        <input
          type="text"
          disabled={raiseBroadcasting}
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
          disabled={raiseBroadcasting || reqAmount <= 0 || reqEquityPct <= 0 || reqEquityPct > equityRetainedPct}
          onClick={handleBroadcastRaise}
        >
          {raiseBroadcasting
            ? `BROADCASTING ${reqEquityPct}% FOR $${reqAmount.toLocaleString()} TO ALL FINANCE TEAMS…`
            : reqEquityPct > 0 && reqAmount > 0
              ? `RAISE REQUEST OVERALL TO ALL FINANCE TEAMS (${reqEquityPct}% FOR $${reqAmount.toLocaleString()}) →`
              : "ENTER EQUITY % & AMOUNT TO BROADCAST RAISE →"}
        </button>

        {raiseHistory.length > 0 && (
          <div className="mt-3 space-y-2">
            {raiseHistory.map(r => (
              <div key={r.id} className="guide-alert">
                {r.status === "BROADCASTING" ? (
                  <>
                    <b>● Broadcast Live ({r.timestamp}):</b> Asking all Finance teams for <b>${r.amount.toLocaleString()}</b> in exchange for <b>{r.equityPct}% equity</b>…
                  </>
                ) : (
                  <>
                    <b>✓ Funded by {r.fundedBy} ({r.fundedByName}):</b> Received <b>+${r.amount.toLocaleString()}</b> cash for <b>{r.equityPct}% equity</b> based on your Round 1 MVP.
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="2. All Finance sector teams & available capital" tag={`${financeTeams.length} FINANCE TEAMS · LIVE CAPITAL`}>
        <p className="guide-muted mb-3">
          Every Finance team and how much money they currently hold is listed below. Your raise request is sent overall to the entire Finance sector—any Finance team can choose to fund your MVP.
        </p>
        <div className="space-y-2.5">
          {financeTeams.map(ft => (
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
          ))}
        </div>
      </Panel>
    </div>

    {/* ── STEP 2: YOUR CRISIS & HIRING / LOCKING A CONSULTING TEAM ── */}
    <div className="guide-grid two mt-4">
      <Panel title="3. Your Round 2 crisis brief" tag={`${companyMeta.ticker} · ${companyMeta.sector}`}>
        <span className="guide-chip active">{companyMeta.company} ({companyMeta.ticker}) · TEAM {code}</span>
        <h2 className="mt-3 text-xl font-semibold">GST Tax Hike &amp; Retailer Margin Squeeze</h2>
        <div className="guide-alert guide-warning mt-3">
          <b>CRISIS CARD #7 · IMMEDIATE MARGIN SHOCK (−15% SHARE DROP)</b>
          <br />
          The GST on your product category rises from <b>12% to 18%</b> from next month. Retail distribution chains refuse to absorb the tax hike and demand an <b>extra 3% shelf margin</b> to keep your packs stocked.
        </div>
        <p className="guide-muted mt-3">
          <b>Tradeoff between Finance &amp; Consulting:</b>
          <br />
          1. You start with <b>$0 cash</b>—raise funds from the Finance teams above by offering equity (e.g. <b>3% for $30,000</b> or <b>5% for $45,000</b>).
          <br />
          2. Send a proposal to your chosen Consulting team on the right. If they raise their price, you will see <b>exactly how much more than base</b> they are demanding.
          <br />
          3. Once your raised cash covers their fee and the proposal is accepted, send a <b>Lock Request</b> (strictly 1:1) to unlock their crisis solution and write it into your MVP.
        </p>
      </Panel>

      <Panel title="4. Consulting teams & initial evaluated values" tag={`CASH AVAILABLE: $${availableCash.toLocaleString()}`}>
        <div className="space-y-3">
          {CONSULTING_TEAMS.map(firm => {
            const n = negos[firm.code]!;
            const isThisLocked = lockedFirmCode === firm.code;
            const isThisLockWaiting = lockWaitingFirmCode === firm.code;
            const isClosedByOther = isLockedOrLockPending && !isThisLocked && !isThisLockWaiting;
            const shortfall = Math.max(0, n.demandedPrice - availableCash);

            return (
              <div
                key={firm.code}
                className="border border-[#294832] p-3.5"
                style={{ opacity: isClosedByOther ? 0.42 : 1 }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className={`guide-chip ${isThisLocked ? "active" : ""}`}>
                      {firm.code} · R1 SCORE {firm.r1Score}/100
                    </span>
                    <b className="ml-2 text-sm">Team {firm.code}</b>
                  </div>
                  <span className="guide-status">
                    {isThisLocked
                      ? `🔒 LOCKED 1:1 AT $${n.demandedPrice.toLocaleString()}`
                      : isThisLockWaiting
                        ? "● LOCK REQUEST SENT · AWAITING ACCEPTANCE…"
                        : isClosedByOther
                          ? "CLOSED · 1:1 LOCKED WITH ANOTHER FIRM"
                          : n.stage === "REQUEST_SENT_WAITING"
                            ? `● PROPOSAL SENT TO ${firm.code}…`
                            : n.stage === "PRICE_INCREASE_DEMANDED"
                              ? `▲ DEMANDING +$${n.extraOverBase.toLocaleString()} (+${n.extraOverBasePct}%) MORE THAN BASE`
                              : n.stage === "PROPOSAL_ACCEPTED_UNLOCKED"
                                ? `✓ PROPOSAL ACCEPTED AT $${n.demandedPrice.toLocaleString()} · NOT LOCKED YET`
                                : n.stage === "DECLINED"
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
                    <b className="mt-0.5 block text-[#fff7f0]">${n.demandedPrice.toLocaleString()}</b>
                  </div>
                  <div className="border border-[#294832] p-2">
                    <span className="block text-[#cfa078]">MORE THAN BASE</span>
                    <b className="mt-0.5 block text-[#ff9b45]">
                      {n.extraOverBase > 0
                        ? `+$${n.extraOverBase.toLocaleString()} (+${n.extraOverBasePct}%)`
                        : "$0 (BASE RATE)"}
                    </b>
                  </div>
                </div>

                {n.stage === "PRICE_INCREASE_DEMANDED" && (
                  <div className="guide-alert guide-warning mt-3">
                    <b>Team {firm.code} increased their price!</b> They are demanding <b>${n.demandedPrice.toLocaleString()}</b> — that is{" "}
                    <b>+${n.extraOverBase.toLocaleString()} (+{n.extraOverBasePct}%) more than their ${firm.baseValue.toLocaleString()} base value</b>.
                  </div>
                )}

                {!isClosedByOther && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {(n.stage === "AVAILABLE" || n.stage === "DECLINED") && (
                      <button
                        type="button"
                        className="guide-btn"
                        onClick={() => handleSendProposal(firm.code)}
                      >
                        SEND PROPOSAL REQUEST TO {firm.code} (${firm.baseValue.toLocaleString()}) →
                      </button>
                    )}

                    {n.stage === "PRICE_INCREASE_DEMANDED" && (
                      <>
                        <button
                          type="button"
                          className="guide-btn"
                          onClick={() => handleAcceptPriceIncrease(firm.code)}
                        >
                          ACCEPT +${n.extraOverBase.toLocaleString()} INCREASE (${n.demandedPrice.toLocaleString()}) →
                        </button>
                        <button
                          type="button"
                          className="guide-btn secondary"
                          onClick={() => handleDeclineDemand(firm.code)}
                        >
                          DECLINE DEMAND
                        </button>
                      </>
                    )}

                    {n.stage === "PROPOSAL_ACCEPTED_UNLOCKED" && (
                      <>
                        <button
                          type="button"
                          disabled={shortfall > 0}
                          className="guide-btn"
                          onClick={() => handleSendLockRequest(firm.code)}
                        >
                          {shortfall > 0
                            ? `NEED $${shortfall.toLocaleString()} MORE CASH FROM FINANCE TO LOCK`
                            : `SEND LOCK REQUEST TO ${firm.code} AT $${n.demandedPrice.toLocaleString()} 🔒`}
                        </button>
                        {shortfall > 0 && (
                          <span className="guide-muted">
                            Raise at least <b>${shortfall.toLocaleString()}</b> more from Finance teams in Panel 1 above to pay and lock {firm.code}.
                          </span>
                        )}
                      </>
                    )}

                    {isThisLockWaiting && (
                      <span className="guide-status">
                        ● LOCK REQUEST SENT TO {firm.code} · WAITING FOR {firm.code} TO ACCEPT LOCK…
                      </span>
                    )}

                    {isThisLocked && (
                      <span className="guide-status">
                        🔒 PERMANENTLY LOCKED 1:1 WITH {firm.code} ({n.lockedAt}) · CANNOT BE UPDATED
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

    {/* ── STEP 3: CONSULTING TEAM'S CRISIS SOLUTION + WRITE INTO UPDATED MVP ── */}
    {!lockedFirm ? (
      <div className="mt-4">
        <Panel title="5. Consulting crisis solution & updated MVP" tag="LOCKED UNTIL FUNDED & 1:1 CONSULTING TEAM IS LOCKED">
          <div className="guide-alert guide-warning">
            <b>
              {raisedCash === 0
                ? "Step 1: Broadcast a Raise Request to All Finance Teams Above ($0 Cash Available)"
                : lockWaitingFirmCode
                  ? `Lock Request Sent to Team ${lockWaitingFirmCode} — Waiting for Mutual Lock Confirmation…`
                  : "Step 2: Send a Proposal & Complete a 1:1 Lock Request With a Consulting Team Above"}
            </b>
            <br />
            1. Raise funds by broadcasting an overall equity-for-cash request to all Finance teams (e.g. <b>3% equity for $30,000</b> or <b>5% for $45,000</b>).
            <br />
            2. Choose a consulting team, review any price increase above their base value, and send a <b>Lock Request</b> once you have enough raised cash.
            <br />
            3. Once locked 1-to-1, their crisis solution unlocks here so you can <b>write it into your updated MVP</b>.
          </div>
        </Panel>
      </div>
    ) : (
      <>
        <div className="guide-grid two mt-4">
          <Panel
            title={`5. Crisis solution from locked Consulting Team ${lockedFirm.code}`}
            tag={`LOCKED 1:1 · ${code} ⇄ ${lockedFirm.code}`}
          >
            <div className="space-y-3 text-xs leading-relaxed">
              <div className="border border-[#294832] p-3">
                <span className="guide-status">01 · DIAGNOSIS</span>
                <p className="guide-muted mt-1">{lockedFirm.solutionSummary.diagnosis}</p>
              </div>
              <div className="border border-[#294832] p-3">
                <span className="guide-status">02 · RECOMMENDED SOLUTION</span>
                <p className="guide-muted mt-1">{lockedFirm.solutionSummary.recommendation}</p>
              </div>
              <div className="border border-[#294832] p-3">
                <span className="guide-status">03 · REVISED PER-PACK MATHS</span>
                <p className="guide-muted mt-1">{lockedFirm.solutionSummary.perPackMaths}</p>
              </div>
              <div className="border border-[#294832] p-3">
                <span className="guide-status">04 · TIMELINE &amp; FALLBACK RISK PLAN</span>
                <p className="guide-muted mt-1">
                  {lockedFirm.solutionSummary.timeline} {lockedFirm.solutionSummary.risks}
                </p>
              </div>
            </div>
            {!submittedAt && (
              <button
                type="button"
                className="guide-btn secondary mt-3 w-full"
                onClick={handleCopySolutionIntoMvp}
              >
                PRE-FILL KEY SOLUTION POINTS INTO YOUR MVP EDITOR BELOW ↓
              </button>
            )}
          </Panel>

          <Panel
            title="1:1 Engagement & equity summary"
            tag="FINAL LOCK · CANNOT UPDATE PARTNER"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>FINANCE EQUITY TRADEOFF</small>
                <b>{equityGivenPct}% SOLD</b>
                <span>RAISED ${raisedCash.toLocaleString()} · {equityRetainedPct}% RETAINED</span>
              </div>
              <div className="guide-metric">
                <small>LOCKED CONSULTANT</small>
                <b>Team {lockedFirm.code}</b>
                <span>PAID ${lockedNego!.demandedPrice.toLocaleString()} · LOCKED ✓</span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="guide-metric">
                <small>CONSULTING FEE VS BASE</small>
                <b className="text-lg">
                  {lockedNego!.extraOverBase > 0 ? `+$${lockedNego!.extraOverBase.toLocaleString()}` : "$0 EXTRA"}
                </b>
                <span>
                  {lockedNego!.extraOverBase > 0
                    ? `+${lockedNego!.extraOverBasePct}% ABOVE $${lockedFirm.baseValue.toLocaleString()} BASE`
                    : "PAID AT BASE VALUE"}
                </span>
              </div>
              <div className="guide-metric">
                <small>UPDATED MVP STATUS</small>
                <b className="text-lg">{submittedAt ? "SUBMITTED (LOCKED)" : "WRITE INTO MVP"}</b>
                <span>{submittedAt ? `FINALIZED ${submittedAt}` : "REQUIRED FOR ROUND 2"}</span>
              </div>
            </div>
            <div className="guide-alert mt-4">
              <b>Action Required:</b> Team <b>{lockedFirm.code}</b> has delivered their crisis solution on the left. Now <b>write and integrate their solution into your updated MVP</b> below and click <b>Submit Updated MVP</b>.
            </div>
          </Panel>
        </div>

        <div className="mt-4">
          <Panel
            title={`Write Team ${lockedFirm.code}'s crisis solution into your MVP (${companyMeta.company} · ${companyMeta.ticker})`}
            tag="6 PARTS · 600 WORDS TOTAL · FINAL ON SUBMIT"
          >
            {submittedAt && (
              <div className="guide-alert mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <b>✓ Updated MVP (with Team {lockedFirm.code}&apos;s crisis solution) permanently submitted</b> · Finalized at {submittedAt} ({mvpCount} words). Locked for evaluation.
                </div>
                <span className="guide-chip active">FINAL · LOCKED</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="guide-muted">
                Integrate Team {lockedFirm.code}&apos;s crisis solution directly into your MVP features, unit maths and launch plan. Once submitted, it cannot be updated.
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
                setMvpValues(v => {
                  const next = v.map((x, i) => (i === active ? e.target.value : x));
                  const words = next.reduce((sum, item) => sum + item.trim().split(/\s+/).filter(Boolean).length, 0);
                  return words <= 600 ? next : v;
                });
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
                {submittedAt ? "UPDATED MVP SUBMITTED & LOCKED ✓" : "SUBMIT UPDATED MVP →"}
              </button>
            </div>
          </Panel>
        </div>
      </>
    )}

    <div className="guide-alert mt-4">
      Product Round 2 flow: <b>1. Start with $0 &amp; Broadcast Overall Equity Raise to All Finance Teams</b> → <b>2. Review Consulting Teams &amp; Any Markup Over Base</b> → <b>3. Lock 1:1 Using Raised Cash</b> → <b>4. Write Consulting Solution Into Your Updated MVP</b>.
    </div>
  </>;
}
