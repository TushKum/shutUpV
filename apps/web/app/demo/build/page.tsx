"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {PageTitle,Panel,Metric,useDemoTrack,useTeamCode} from "../ui";
import {useCoordination} from "../coordination-store";
import {
  equityPctToShares,
  getFinancePortfolio,
  getFinanceTeam,
  getOrMakeConsultant,
  getOrMakeProduct,
} from "../coordination-types";
import {FINANCE_ROUTES} from "../finance/_desk/routes";

const PRODUCT_SECTORS = [
  {
    id: "FMCG",
    label: "SECTOR 01 · FMCG & CONSUMER",
    title: "Consumer Packaged Goods & Everyday Retail",
    brief:
      "Design a high-repeat everyday consumer product for urban and Tier-2 Indian households that beats legacy incumbents on nutrition, convenience or unit economics while surviving ambient retail distribution.",
    constraint: "Target retail price under ₹50/unit · Clear per-pack COGS, distributor margin and break-even maths.",
  },
  {
    id: "FINTECH",
    label: "SECTOR 02 · FINTECH & PAYMENTS",
    title: "Campus & SMB Financial Infrastructure",
    brief:
      "Build a compliant digital financial product for students, gig workers or kirana merchants solving credit access, automated working-capital management, or low-cost UPI/invoice reconciliation.",
    constraint: "Zero hidden fees · Must define customer acquisition cost (CAC), take-rate / float economics and RBI compliance.",
  },
  {
    id: "HEALTHTECH",
    label: "SECTOR 03 · HEALTHTECH & CLEANTECH",
    title: "Preventive Care & Sustainable Campus Infrastructure",
    brief:
      "Create an accessible preventive health, diagnostics or clean-energy product tailored for Indian families, hostels or campuses with verifiable cost savings or measurable health outcomes.",
    constraint: "Clear deployment model · Hardware/service unit economics, regulatory certification path and retention metrics.",
  },
];

const productMvpParts = [
  "Idea & Problem Statement",
  "Target User & Market",
  "MVP Core Features",
  "User Flow & Architecture",
  "Business Model & Unit Maths",
  "Go-To-Market & Launch",
  "Risks & Success Metrics",
];

const productMvpGuides = [
  "Pitch your startup idea clearly: what specific problem exists in your assigned sector, who suffers from it, and why current alternatives fail.",
  "Define your exact initial customer segment, frequency of need, and addressable market within this sector.",
  "Detail the core features of your Minimum Viable Product (MVP)—what ships in Version 1 and what you deliberately leave out.",
  "Describe how a customer discovers, onboards onto, and uses your MVP end-to-end.",
  "Lay out your pricing, unit cost (COGS), channel margin, contribution per unit, and monthly break-even volume.",
  "Explain how you will acquire your first 1,000 paying users or retail stores in the first 90 days.",
  "List your top 90-day success metrics (targets) and the main execution risks with mitigations.",
];

const memoParts=["Diagnosis","Options and trade-offs","Recommendation","The numbers","Risks","Next steps"];
const memoGuides=[
  "Diagnose the root problem in the crisis: explain the ₹8 Cr → ₹30 Cr revenue gap, why only 1.2% of 4 lakh individual users pay, and what is at stake.",
  "Evaluate the options on the table and their trade-offs: (1) Ed-tech ₹6 Cr/yr exclusivity for 10,000 hrs dubbing, (2) Telecom ₹12 Cr/yr white-label guarantee for 5 Cr subscribers, (3) ₹199/mo consumer plan, alongside election voice-cloning risk.",
  "Give one clear recommendation that follows from your diagnosis and options, including what you leave out and why.",
  "Work out the numbers: how your recommendation reaches the ₹30 Cr target within the ₹20 Cr budget, with costs, revenue and timing.",
  "List the key operational, competitive and regulatory risks of your recommendation and how to mitigate each.",
  "Specify concrete next steps for this week, with clear owners and completion deadlines."
];

export default function Build(){
  const [track]=useDemoTrack();
  const code=useTeamCode();
  const {state,dispatch,ready}=useCoordination();

  const prodState=useMemo(()=>getOrMakeProduct(state,code),[state,code]);
  const consState=useMemo(()=>getOrMakeConsultant(state,code),[state,code]);

  // Product team Round 1 state (synced with coordination store)
  const [sectorIdx,setSectorIdx]=useState(0);
  const [company,setCompany]=useState(prodState.company);
  const [ticker,setTicker]=useState(prodState.ticker);
  const [pitchLine,setPitchLine]=useState(prodState.pitchLine);
  const [mvpActive,setMvpActive]=useState(0);
  const [mvpValues,setMvpValues]=useState<string[]>(prodState.r1MvpParts);

  // Consulting team Round 1 state (synced with coordination store)
  const [active,setActive]=useState(0);
  const [values,setValues]=useState<string[]>(consState.r1SolutionParts);

  // Sync local inputs when switching team code or resetting live simulation
  useEffect(()=>{
    if(!ready)return;
    const sIdx=PRODUCT_SECTORS.findIndex(s=>s.label===prodState.sector);
    if(sIdx>=0)setSectorIdx(sIdx);
    setCompany(prodState.company);
    setTicker(prodState.ticker);
    setPitchLine(prodState.pitchLine);
    setMvpValues(prodState.r1MvpParts.length===7?prodState.r1MvpParts:Array(7).fill(""));
  },[ready,code,prodState.r1SubmittedAt,state.version===1]);

  useEffect(()=>{
    if(!ready)return;
    setValues(consState.r1SolutionParts.length===6?consState.r1SolutionParts:Array(6).fill(""));
  },[ready,code,consState.r1SubmittedAt,state.version===1]);

  const mvpSubmittedAt=prodState.r1SubmittedAt;
  const submittedAt=consState.r1SubmittedAt;

  const mvpCount=useMemo(()=>mvpValues.reduce((n,v)=>n+v.trim().split(/\s+/).filter(Boolean).length,0),[mvpValues]);
  const count=useMemo(()=>values.reduce((n,v)=>n+v.trim().split(/\s+/).filter(Boolean).length,0),[values]);

  const handleSubmitMvp=()=>{
    if(mvpSubmittedAt||mvpCount===0)return;
    dispatch({
      type:"PRODUCT_R1_SUBMIT",
      productCode:code,
      company:company||"AquaCare",
      ticker:ticker||"QAAC",
      sector:PRODUCT_SECTORS[sectorIdx]!.label,
      pitchLine,
      mvpParts:mvpValues,
    });
  };

  const handleSubmitConsulting=()=>{
    if(submittedAt||count===0)return;
    dispatch({
      type:"CONSULTING_R1_SUBMIT",
      consultingCode:code,
      solutionParts:values,
    });
  };

  // ── PRODUCT TEAM: ROUND 1 (Assigned 1 of 3 Sectors, Pitch Idea & Build MVP) ──
  if(track==="PRODUCT"){
    const assignedSector=PRODUCT_SECTORS[sectorIdx]!;
    const impliedValuation=Math.round(prodState.totalShares*prodState.sharePrice);
    return <>
      <PageTitle
        eyebrow={`ROUND 1 / PRODUCT IDEA & MVP · ${code}`}
        title="Pitch your idea and build your MVP."
        sub={`Your Product team is assigned one of the 3 competition sectors. Pitch your startup idea, claim your company identity, and write your complete MVP specification before submitting. Your Round 1 score sets your share price ($${prodState.sharePrice.toFixed(2)}/sh across ${prodState.totalShares.toLocaleString()} shares) — all Round 2 & 3 Finance and Consulting deals trade in Shares & Equity % with money calculated automatically.`}
      />
      <div className="guide-grid two">
        <Panel title="Your assigned sector (1 of 3)" tag="SECTOR ALLOCATION">
          <div className="guide-tabs">
            {PRODUCT_SECTORS.map((s,i)=>(
              <button
                key={s.id}
                type="button"
                disabled={!!mvpSubmittedAt}
                className={sectorIdx===i?"active":""}
                onClick={()=>setSectorIdx(i)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span className="guide-chip active">ASSIGNED TO TEAM {code} · {assignedSector.id}</span>
          <h2 className="mt-3 text-xl font-semibold">{assignedSector.title}</h2>
          <p className="guide-muted mt-2">{assignedSector.brief}</p>
          <div className="guide-alert mt-3">
            <b>Sector Constraints:</b> {assignedSector.constraint}
          </div>
        </Panel>

        <Panel title="Pitch your idea & company identity" tag={`TEAM ${code} · PRODUCT TRACK`}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="guide-label !mt-0">COMPANY / PRODUCT NAME</label>
              <input
                className="guide-input"
                maxLength={60}
                readOnly={!!mvpSubmittedAt}
                value={company}
                onChange={e=>setCompany(e.target.value)}
              />
            </div>
            <div>
              <label className="guide-label !mt-0">4-LETTER TICKER (A–Z)</label>
              <input
                className="guide-input font-mono uppercase"
                maxLength={4}
                readOnly={!!mvpSubmittedAt}
                value={ticker}
                onChange={e=>setTicker(e.target.value.toUpperCase().replace(/[^A-Z]/g,""))}
              />
            </div>
          </div>
          <label className="guide-label">ONE-LINE IDEA PITCH</label>
          <textarea
            className="guide-textarea !min-h-[76px]"
            maxLength={220}
            readOnly={!!mvpSubmittedAt}
            value={pitchLine}
            onChange={e=>setPitchLine(e.target.value)}
            placeholder="Summarize your startup idea in one crisp sentence…"
          />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="guide-metric">
              <small>SHARE STRUCTURE</small>
              <b className="text-base">${prodState.sharePrice.toFixed(2)}/sh</b>
              <span>{prodState.totalShares.toLocaleString()} SHARES · ${impliedValuation.toLocaleString()} VAL</span>
            </div>
            <div className="guide-metric">
              <small>MVP STATUS</small>
              <b className="text-base">{mvpSubmittedAt?"SUBMITTED (LOCKED)":"IN PROGRESS"}</b>
              <span>{mvpSubmittedAt?`SYNCED ${mvpSubmittedAt}`:"AWAITING SUBMISSION"}</span>
            </div>
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title={`Idea & MVP editor — ${company||"Your Product"} (${ticker||"TICK"})`} tag="7 SECTIONS · 800 WORDS TOTAL · FINAL ON SUBMIT">
          {mvpSubmittedAt&&(
            <div className="guide-alert mb-4 flex flex-wrap items-center justify-between gap-2">
              <div><b>✓ Idea &amp; MVP permanently submitted for Team {code} ({company} · {ticker})</b> · Finalized at {mvpSubmittedAt} ({mvpCount} words) and synced live to Finance &amp; Consulting workspaces.</div>
              <span className="guide-chip active">FINAL · LIVE SYNCED</span>
            </div>
          )}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <b className="text-sm">Write your Idea &amp; Minimum Viable Product (MVP)</b>
              <p className="guide-muted">Complete all seven sections covering your startup pitch, MVP features, architecture and unit economics, then click Submit Idea &amp; MVP.</p>
            </div>
            <span className={mvpCount>800?"text-red-400":"guide-status"}>{mvpCount} / 800 WORDS</span>
          </div>
          <div className="guide-tabs">
            {productMvpParts.map((p,i)=>(
              <button
                key={p}
                type="button"
                className={mvpActive===i?"active":""}
                onClick={()=>setMvpActive(i)}
              >
                {String(i+1).padStart(2,"0")} · {p}
              </button>
            ))}
          </div>
          <label className="guide-label">{productMvpParts[mvpActive]!.toUpperCase()}</label>
          <textarea
            className="guide-textarea"
            readOnly={!!mvpSubmittedAt}
            value={mvpValues[mvpActive]}
            onChange={e=>{
              if(mvpSubmittedAt)return;
              setMvpValues(v=>{
                const next=v.map((x,i)=>i===mvpActive?e.target.value:x);
                const words=next.reduce((sum,item)=>sum+item.trim().split(/\s+/).filter(Boolean).length,0);
                return words<=800?next:v;
              });
            }}
            placeholder={productMvpGuides[mvpActive]}
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="guide-muted">{mvpValues[mvpActive]!.trim().split(/\s+/).filter(Boolean).length} words in this section</span>
            <span className="guide-status">{mvpSubmittedAt?`● SUBMITTED & SYNCED AT ${mvpSubmittedAt}`:"● DRAFT IN PROGRESS"}</span>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#294832] pt-4">
            <div className="flex gap-2">
              <button type="button" className="guide-btn secondary" disabled={mvpActive===0} onClick={()=>setMvpActive(v=>v-1)}>← PREVIOUS</button>
              <button type="button" className="guide-btn secondary" disabled={mvpActive===6} onClick={()=>setMvpActive(v=>v+1)}>NEXT SECTION →</button>
            </div>
            <button type="button" className="guide-btn" disabled={mvpCount===0||!!mvpSubmittedAt} onClick={handleSubmitMvp}>
              {mvpSubmittedAt?"IDEA & MVP SUBMITTED ✓":"SUBMIT IDEA & MVP →"}
            </button>
          </div>
        </Panel>
      </div>
      <div className="guide-alert mt-4">Round 1 closes at 23:00 IST. Your submitted Idea &amp; MVP sets your company&apos;s starting share price (${prodState.sharePrice.toFixed(2)}/sh) and syncs live to Finance &amp; Consulting teams in Round 2.</div>
    </>;
  }

  // ── FINANCE TRACK: ROUND 1 (Initial Capital Allocation & Share/Equity Investment Mandate) ──
  if(track==="FINANCE"){
    const finCode=code.startsWith("XF")?code:"XF01";
    const finTeam=getFinanceTeam(state,finCode);
    const portfolio=getFinancePortfolio(state,finCode);
    const deployed=portfolio.reduce((sum,d)=>sum+d.amountInvested,0);
    const totalSharesHeld=portfolio.reduce((sum,d)=>sum+d.sharesAcquired,0);
    const openRequests=state.raiseRequests.filter(r=>r.status==="OPEN").length;
    return <>
      <PageTitle
        eyebrow={`ROUND 1 / FINANCE CAPITAL ALLOCATION · ${finTeam.code} (${finTeam.name})`}
        title="Your Round 1 fund capital is live."
        sub="In Round 1, every Finance team is allocated starting investment capital. In Round 2, you will inspect every Product team's MVP in popups, evaluate the exact Shares & Equity % they offer (capital cost calculated automatically from shares × share price), and close share deals with one or multiple Product teams."
      />
      <div className="guide-grid three">
        <Metric
          label="ROUND 1 INITIAL CAPITAL"
          value={`$${finTeam.initialCapital.toLocaleString()}`}
          delta={`ALLOCATED TO ${finTeam.code} (${finTeam.name})`}
        />
        <Metric
          label="AVAILABLE CAPITAL NOW"
          value={`$${finTeam.availableCapital.toLocaleString()}`}
          delta={`DEPLOYED $${deployed.toLocaleString()} · ${totalSharesHeld.toLocaleString()} SHARES HELD`}
        />
        <Metric
          label="ROUND 2 DEAL PIPELINE"
          value={`${openRequests} OPEN OFFERS`}
          delta={`${state.productOrder.length} PRODUCT MVPS READY TO INSPECT`}
        />
      </div>

      <div className="guide-grid two mt-4">
        <Panel title="Your Finance fund mandate" tag={`${finTeam.code} · ROUND 1 ALLOCATION`}>
          <span className="guide-chip active">{finTeam.code} · {finTeam.name}</span>
          <h2 className="mt-3 text-xl font-semibold">Starting Capital: ${finTeam.initialCapital.toLocaleString()}</h2>
          <p className="guide-muted mt-2">
            <b>Sector Focus:</b> {finTeam.focus}
          </p>
          <div className="guide-alert mt-3">
            <b>How Finance Rounds Connect (Shares &amp; Equity Model):</b>
            <br />
            1. <b>Round 1 (Capital Allocation):</b> You receive <b>${finTeam.initialCapital.toLocaleString()}</b> starting investment capital.
            <br />
            2. <b>Round 2 (Product MVPs &amp; Share Deals):</b> View all Product teams, open full MVP popups, evaluate the <b>Shares &amp; Equity %</b> offered (with dollar cost calculated automatically from shares × share price), and close deals with <b>one or multiple Product teams</b>—updating your live share portfolio immediately.
            <br />
            3. <b>Round 3 (Finance Desk &amp; Trading):</b> Track your acquired shares and trade live on the Finance Desk.
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link className="guide-btn" href="/demo/rescue">OPEN ROUND 2: PRODUCT MVPs &amp; SHARE DEALS →</Link>
            <Link className="guide-btn secondary" href={FINANCE_ROUTES.overview}>OPEN FINANCE DESK →</Link>
          </div>
        </Panel>

        <Panel title="Finance sector capital pools" tag={`${state.financeTeams.length} FINANCE TEAMS`}>
          <p className="guide-muted mb-3">
            Live capital across all Finance teams (Product teams also see these capital pools when deciding how many shares &amp; equity % to offer in Round 2).
          </p>
          <div className="guide-scroll-box compact space-y-2">
            {state.financeTeams.map(ft=>(
              <div key={ft.code} className="flex flex-wrap items-center justify-between gap-2 border border-[#294832] p-2.5">
                <div>
                  <span className={`guide-chip ${ft.code===finTeam.code?"active":""}`}>{ft.code}</span>
                  <b className="ml-2 text-xs">{ft.name}{ft.code===finTeam.code?" (You)":""}</b>
                  <span className="block text-[10px] text-[#9ba2ad] mt-0.5">{ft.focus}</span>
                </div>
                <div className="text-right font-mono">
                  <b className="text-xs text-[#ffd84d]">${ft.availableCapital.toLocaleString()}</b>
                  <span className="block text-[9px] text-[#9ba2ad]">OF ${ft.initialCapital.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>;
  }

  // ── CONSULTING TEAM: ROUND 1 (Pre-Assigned Code, Solve Crisis, Submit) ──
  const baseSharesBenchmark = equityPctToShares(consState.baseEquityPct);
  return <>
    <PageTitle
      eyebrow={`ROUND 1 / CONSULTING CRISIS · ${code}`}
      title="Solve the crisis."
      sub="Read the Round 1 crisis case below, write your six-part crisis solution across the sections, and submit your solution for evaluation. Your Round 1 score sets your Consultancy Base Equity Rate (% of shares) — in Rounds 2 & 3 you negotiate Shares & Equity % directly with Product teams and dollar value calculates automatically."
    />
    <div className="guide-grid two">
      <Panel title="The crisis to solve" tag="ROUND 1 · CRISIS CASE">
        <span className="guide-chip">CRISIS CASE 01 · AI VOICE &amp; ENTERPRISE SAAS</span>
        <h2 className="mt-3 text-xl font-semibold">ElevenLabs India: The ₹30 Crore Mandate</h2>
        <p className="guide-muted mt-2">India brings ₹8 Cr a year from 300 business customers. 4 lakh individuals have signed up, but only 1.2% pay (against 4% in other markets): dollar-priced plans feel expensive, and a local rival gives Indian-language voices away free with ads. The 25-person India team has ₹20 Cr to spend this year, and the board wants ₹30 Cr a year of revenue within 12 months or it will scale India back.</p>
        <p className="guide-muted mt-2">Three offers are on the table: <b>(1) Ed-tech exclusivity</b> at ₹6 Cr/yr to dub 10,000 hours into 6 languages if all data stays in India (education is 40% of current revenue); <b>(2) Telecom white-label</b> guarantee at ₹12 Cr/yr for 5 Cr subscribers under the telecom&apos;s brand; <b>(3) Cut Indian prices</b> to ₹199/month. A state election is 4 months away with rising scrutiny on political voice cloning.</p>
      </Panel>
      <Panel title="Assigned team details" tag="PRE-ASSIGNED · CONSULTING">
        <div className="grid grid-cols-2 gap-3">
          <div className="guide-metric"><small>TEAM CODE</small><b>{code}</b><span>CONSULTING TRACK</span></div>
          <div className="guide-metric">
            <small>BASE EQUITY RATE</small>
            <b>{consState.baseEquityPct}% · {baseSharesBenchmark.toLocaleString()} sh</b>
            <span>R1 SCORE {consState.r1Score}/100 · ~${consState.baseValue.toLocaleString()} CALC</span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="guide-metric"><small>ROUND 1 TASK</small><b className="text-base">Crisis Solution</b><span>6 SECTIONS · 500 WORDS</span></div>
          <div className="guide-metric"><small>STATUS</small><b className="text-base">{submittedAt?"SUBMITTED (LOCKED)":"IN PROGRESS"}</b><span>{submittedAt?`SYNCED ${submittedAt}`:"AWAITING SUBMISSION"}</span></div>
        </div>
        <p className="guide-muted mt-3">Your team code (<b>{code}</b>) and team name (<b>Team {code}</b>) are fixed. Write your solution to the crisis below and click <b>Submit Solution</b> when ready. Once submitted, your base equity rate (<b>{consState.baseEquityPct}% / {baseSharesBenchmark.toLocaleString()} shares</b>) syncs live to Product teams in Round 2.</p>
      </Panel>
    </div>
    <div className="mt-4">
      <Panel title="Crisis solution editor" tag="6 PARTS · 500 WORDS TOTAL · FINAL ON SUBMIT">
        {submittedAt&&<div className="guide-alert mb-4 flex flex-wrap items-center justify-between gap-2"><div><b>✓ Crisis solution permanently submitted for Team {code}</b> · Finalized at {submittedAt} ({count} words). Base equity rate ({consState.baseEquityPct}% · {baseSharesBenchmark.toLocaleString()} sh · ~${consState.baseValue.toLocaleString()}) synced live to Product teams.</div><span className="guide-chip active">FINAL · LIVE SYNCED</span></div>}
        <div className="mb-4 flex items-center justify-between">
          <div><b className="text-sm">Your crisis solution ({code})</b><p className="guide-muted">Each section has its own box. Complete all six parts and click Submit Solution. Once submitted, it cannot be updated.</p></div>
          <span className={count>500?"text-red-400":"guide-status"}>{count} / 500 WORDS</span>
        </div>
        <div className="guide-tabs">{memoParts.map((p,i)=><button key={p} type="button" className={active===i?"active":""} onClick={()=>setActive(i)}>{String(i+1).padStart(2,"0")} · {p}</button>)}</div>
        <label className="guide-label">{memoParts[active]!.toUpperCase()}</label>
        <textarea className="guide-textarea" readOnly={!!submittedAt} value={values[active]} onChange={e=>{if(submittedAt)return;setValues(v=>{const next=v.map((x,i)=>i===active?e.target.value:x);const words=next.reduce((sum,item)=>sum+item.trim().split(/\s+/).filter(Boolean).length,0);return words<=500?next:v})}} placeholder={memoGuides[active]} />
        <div className="mt-3 flex items-center justify-between">
          <span className="guide-muted">{values[active]!.trim().split(/\s+/).filter(Boolean).length} words in this section</span>
          <span className="guide-status">{submittedAt?`● SUBMITTED & SYNCED AT ${submittedAt}`:"● DRAFT IN PROGRESS"}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#294832] pt-4">
          <div className="flex gap-2">
            <button type="button" className="guide-btn secondary" disabled={active===0} onClick={()=>setActive(v=>v-1)}>← PREVIOUS</button>
            <button type="button" className="guide-btn secondary" disabled={active===5} onClick={()=>setActive(v=>v+1)}>NEXT SECTION →</button>
          </div>
          <button type="button" className="guide-btn" disabled={count===0||!!submittedAt} onClick={handleSubmitConsulting}>
            {submittedAt?"SOLUTION SUBMITTED & LOCKED ✓":"SUBMIT SOLUTION →"}
          </button>
        </div>
      </Panel>
    </div>
    <div className="guide-alert mt-4">Round 1 closes at 23:00 IST. Make sure to click <b>Submit Solution</b> after completing your six sections—once submitted, your answer is locked and your base equity rate ({consState.baseEquityPct}%) syncs live to Product teams in Round 2.</div>
  </>;
}
