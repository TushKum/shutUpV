"use client";
import {useEffect,useMemo,useState} from "react";
import {PageTitle,Panel,useDemoTrack,useTeamCode} from "../ui";

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

  // Product team Round 1 state
  const [sectorIdx,setSectorIdx]=useState(0);
  const [company,setCompany]=useState("AquaCare");
  const [ticker,setTicker]=useState("QAAC");
  const [pitchLine,setPitchLine]=useState("Zero-sugar electrolyte hydration pouch under ₹20 built for Indian school tiffins and hot transit.");
  const [mvpActive,setMvpActive]=useState(0);
  const [mvpValues,setMvpValues]=useState<string[]>(Array(7).fill(""));
  const [mvpSubmittedAt,setMvpSubmittedAt]=useState<string|null>(null);

  // Finance Round 1 state (exact 6a55285 Finance frontend)
  const [finCompany,setFinCompany]=useState("FreshPack Foods");
  const [finTicker,setFinTicker]=useState("FRPK");
  const [finActive,setFinActive]=useState(0);
  const [finValues,setFinValues]=useState<string[]>(Array(9).fill(""));
  const [finLoaded,setFinLoaded]=useState(false);

  // Consulting team Round 1 state
  const [active,setActive]=useState(0);
  const [values,setValues]=useState<string[]>(Array(6).fill(""));
  const [submittedAt,setSubmittedAt]=useState<string|null>(null);

  useEffect(()=>{
    try{
      const raw=localStorage.getItem("primus-prd-draft");
      if(raw){const parsed=JSON.parse(raw);if(Array.isArray(parsed)&&parsed.length===9)setFinValues(parsed)}
      localStorage.removeItem("primus-consulting-r1-draft");
      localStorage.removeItem("primus-consulting-r1-submitted");
      localStorage.removeItem("primus-consulting-r1-draft-v2");
      localStorage.removeItem("primus-consulting-r1-submitted-v2");
    }catch{}
    setFinLoaded(true);
  },[]);
  useEffect(()=>{if(finLoaded)localStorage.setItem("primus-prd-draft",JSON.stringify(finValues))},[finValues,finLoaded]);

  const finCount=useMemo(()=>finValues.reduce((n,v)=>n+v.trim().split(/\s+/).filter(Boolean).length,0),[finValues]);
  const mvpCount=useMemo(()=>mvpValues.reduce((n,v)=>n+v.trim().split(/\s+/).filter(Boolean).length,0),[mvpValues]);
  const count=useMemo(()=>values.reduce((n,v)=>n+v.trim().split(/\s+/).filter(Boolean).length,0),[values]);

  const handleSubmitMvp=()=>{
    if(mvpSubmittedAt||mvpCount===0)return;
    const stamp=new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false})+" IST";
    setMvpSubmittedAt(stamp);
    try{
      sessionStorage.setItem(
        "primus-product-r1-meta",
        JSON.stringify({
          company:company||"AquaCare",
          ticker:ticker||"QAAC",
          sector:PRODUCT_SECTORS[sectorIdx]!.label,
          pitchLine,
        })
      );
    }catch{}
  };

  const handleSubmitConsulting=()=>{
    if(submittedAt||count===0)return;
    const stamp=new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false})+" IST";
    setSubmittedAt(stamp);
  };

  // ── PRODUCT TEAM: ROUND 1 (Assigned 1 of 3 Sectors, Pitch Idea & Build MVP) ──
  if(track==="PRODUCT"){
    const assignedSector=PRODUCT_SECTORS[sectorIdx]!;
    return <>
      <PageTitle
        eyebrow={`ROUND 1 / PRODUCT IDEA & MVP · ${code}`}
        title="Pitch your idea and build your MVP."
        sub="Your Product team is assigned one of the 3 competition sectors. Pitch your startup idea, claim your company identity, and write your complete MVP specification before submitting."
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
              <small>ASSIGNED TEAM</small>
              <b className="text-base">Team {code}</b>
              <span>SECTOR: {assignedSector.id}</span>
            </div>
            <div className="guide-metric">
              <small>MVP STATUS</small>
              <b className="text-base">{mvpSubmittedAt?"SUBMITTED (LOCKED)":"IN PROGRESS"}</b>
              <span>{mvpSubmittedAt?`SENT ${mvpSubmittedAt}`:"AWAITING SUBMISSION"}</span>
            </div>
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title={`Idea & MVP editor — ${company||"Your Product"} (${ticker||"TICK"})`} tag="7 SECTIONS · 800 WORDS TOTAL · FINAL ON SUBMIT">
          {mvpSubmittedAt&&(
            <div className="guide-alert mb-4 flex flex-wrap items-center justify-between gap-2">
              <div><b>✓ Idea &amp; MVP permanently submitted for Team {code} ({company} · {ticker})</b> · Finalized at {mvpSubmittedAt} ({mvpCount} words).</div>
              <span className="guide-chip active">FINAL · LOCKED</span>
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
            <span className="guide-status">{mvpSubmittedAt?`● SUBMITTED & LOCKED AT ${mvpSubmittedAt}`:"● DRAFT IN PROGRESS"}</span>
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
      <div className="guide-alert mt-4">Round 1 closes at 23:00 IST. Your submitted Idea &amp; MVP sets your company&apos;s starting valuation before the Round 2 crisis hits.</div>
    </>;
  }

  // ── FINANCE TRACK: ROUND 1 (exact frontend from previous Final-Frontend 6a55285) ──
  if(track==="FINANCE"){
    const finParts=["Problem","Target user","Must have","Should have","Not in version 1","Per-pack maths","Go to market","Success metrics","Risks"];
    return <><PageTitle eyebrow="ROUND 1 / BUILD" title="Build your company." sub="The lottery deals your team a problem card. Name your company, claim a unique four-letter ticker and write its product requirements document."/><div className="guide-grid two"><Panel title="Your problem card" tag="LOTTERY ASSIGNMENT"><span className="guide-chip">PROBLEM CARD 08 · FMCG</span><h2 className="mt-3 text-xl font-semibold">School tiffin filler</h2><p className="guide-muted mt-2">Parents of 6–12-year-olds want a packed snack for the school tiffin that is not junk, costs under ₹15 and survives a hot bag till lunch.</p></Panel><Panel title="Company identity" tag="CLAIM YOUR TICKER"><label className="guide-label">COMPANY NAME · UP TO 60 CHARACTERS</label><input className="guide-input" maxLength={60} value={finCompany} onChange={e=>setFinCompany(e.target.value)}/><label className="guide-label">FOUR-LETTER TICKER · A–Z</label><input className="guide-input font-mono uppercase" maxLength={4} value={finTicker} onChange={e=>setFinTicker(e.target.value.toUpperCase().replace(/[^A-Z]/g,""))}/><p className="guide-muted mt-2">The first team to save a ticker owns it. This preview does not reserve tickers on the event server.</p></Panel></div><div className="mt-4"><Panel title="Product requirements document" tag="9 PARTS · 800 WORDS TOTAL"><div className="mb-4 flex items-center justify-between"><div><b className="text-sm">Your PRD</b><p className="guide-muted">Each part has its own box. The editor autosaves locally in this preview.</p></div><span className={finCount>800?"text-red-400":"guide-status"}>{finCount} / 800 WORDS</span></div><div className="guide-tabs">{finParts.map((p,i)=><button key={p} type="button" className={finActive===i?"active":""} onClick={()=>setFinActive(i)}>{String(i+1).padStart(2,"0")} · {p}</button>)}</div><label className="guide-label">{finParts[finActive]!.toUpperCase()}</label><textarea className="guide-textarea" value={finValues[finActive]} onChange={e=>setFinValues(v=>{const next=v.map((x,i)=>i===finActive?e.target.value:x);const words=next.reduce((sum,item)=>sum+item.trim().split(/\s+/).filter(Boolean).length,0);return words<=800?next:v})} placeholder={"Write the "+finParts[finActive]!.toLowerCase()+" section of your PRD…"} /><div className="mt-3 flex items-center justify-between"><span className="guide-muted">{finValues[finActive]!.trim().split(/\s+/).filter(Boolean).length} words in this section</span><span className="guide-status">● AUTOSAVED IN THIS BROWSER</span></div><div className="mt-4 flex justify-between"><button type="button" className="guide-btn secondary" disabled={finActive===0} onClick={()=>setFinActive(v=>v-1)}>← PREVIOUS</button><button type="button" className="guide-btn" disabled={finActive===8} onClick={()=>setFinActive(v=>v+1)}>NEXT SECTION →</button></div></Panel></div><div className="guide-alert mt-4">The form locks at 23:00 IST. The last saved version is judged. There is no submit button. AI judges read each PRD three times; the middle score counts.</div></>;
  }

  // ── CONSULTING TEAM: ROUND 1 (Pre-Assigned Code, Solve Crisis, Submit) ──
  return <>
    <PageTitle eyebrow={`ROUND 1 / CONSULTING CRISIS · ${code}`} title="Solve the crisis." sub="Read the Round 1 crisis case below, write your six-part crisis solution across the sections, and submit your solution for evaluation. Once submitted, it cannot be updated."/>
    <div className="guide-grid two">
      <Panel title="The crisis to solve" tag="ROUND 1 · CRISIS CASE">
        <span className="guide-chip">CRISIS CASE 01 · AI VOICE & ENTERPRISE SAAS</span>
        <h2 className="mt-3 text-xl font-semibold">ElevenLabs India: The ₹30 Crore Mandate</h2>
        <p className="guide-muted mt-2">India brings ₹8 Cr a year from 300 business customers. 4 lakh individuals have signed up, but only 1.2% pay (against 4% in other markets): dollar-priced plans feel expensive, and a local rival gives Indian-language voices away free with ads. The 25-person India team has ₹20 Cr to spend this year, and the board wants ₹30 Cr a year of revenue within 12 months or it will scale India back.</p>
        <p className="guide-muted mt-2">Three offers are on the table: <b>(1) Ed-tech exclusivity</b> at ₹6 Cr/yr to dub 10,000 hours into 6 languages if all data stays in India (education is 40% of current revenue); <b>(2) Telecom white-label</b> guarantee at ₹12 Cr/yr for 5 Cr subscribers under the telecom&apos;s brand; <b>(3) Cut Indian prices</b> to ₹199/month. A state election is 4 months away with rising scrutiny on political voice cloning.</p>
      </Panel>
      <Panel title="Assigned team details" tag="PRE-ASSIGNED · CONSULTING">
        <div className="grid grid-cols-2 gap-3">
          <div className="guide-metric"><small>TEAM CODE</small><b>{code}</b><span>CONSULTING TRACK</span></div>
          <div className="guide-metric"><small>TEAM NAME</small><b>Team {code}</b><span>DECIDED AT CHECK-IN</span></div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="guide-metric"><small>ROUND 1 TASK</small><b className="text-base">Crisis Solution</b><span>6 SECTIONS · 500 WORDS</span></div>
          <div className="guide-metric"><small>STATUS</small><b className="text-base">{submittedAt?"SUBMITTED (LOCKED)":"IN PROGRESS"}</b><span>{submittedAt?`SENT ${submittedAt}`:"AWAITING SUBMISSION"}</span></div>
        </div>
        <p className="guide-muted mt-3">Your team code (<b>{code}</b>) and team name (<b>Team {code}</b>) are fixed. Write your solution to the crisis below and click <b>Submit Solution</b> when ready. Once submitted, it is locked for evaluation.</p>
      </Panel>
    </div>
    <div className="mt-4">
      <Panel title="Crisis solution editor" tag="6 PARTS · 500 WORDS TOTAL · FINAL ON SUBMIT">
        {submittedAt&&<div className="guide-alert mb-4 flex flex-wrap items-center justify-between gap-2"><div><b>✓ Crisis solution permanently submitted for Team {code}</b> · Finalized at {submittedAt} ({count} words). Locked for evaluation.</div><span className="guide-chip active">FINAL · LOCKED</span></div>}
        <div className="mb-4 flex items-center justify-between">
          <div><b className="text-sm">Your crisis solution ({code})</b><p className="guide-muted">Each section has its own box. Complete all six parts and click Submit Solution. Once submitted, it cannot be updated.</p></div>
          <span className={count>500?"text-red-400":"guide-status"}>{count} / 500 WORDS</span>
        </div>
        <div className="guide-tabs">{memoParts.map((p,i)=><button key={p} type="button" className={active===i?"active":""} onClick={()=>setActive(i)}>{String(i+1).padStart(2,"0")} · {p}</button>)}</div>
        <label className="guide-label">{memoParts[active]!.toUpperCase()}</label>
        <textarea className="guide-textarea" readOnly={!!submittedAt} value={values[active]} onChange={e=>{if(submittedAt)return;setValues(v=>{const next=v.map((x,i)=>i===active?e.target.value:x);const words=next.reduce((sum,item)=>sum+item.trim().split(/\s+/).filter(Boolean).length,0);return words<=500?next:v})}} placeholder={memoGuides[active]} />
        <div className="mt-3 flex items-center justify-between">
          <span className="guide-muted">{values[active]!.trim().split(/\s+/).filter(Boolean).length} words in this section</span>
          <span className="guide-status">{submittedAt?`● SUBMITTED & LOCKED AT ${submittedAt}`:"● DRAFT IN PROGRESS"}</span>
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
    <div className="guide-alert mt-4">Round 1 closes at 23:00 IST. Make sure to click <b>Submit Solution</b> after completing your six sections—once submitted, your answer is locked for evaluation.</div>
  </>;
}
