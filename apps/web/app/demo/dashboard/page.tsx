"use client";
import Link from "next/link";
import {PageTitle,Panel,Metric,useDemoTrack,useTeamCode} from "../ui";
import {useCoordination} from "../coordination-store";
import {
  getConsultingR2Lock,
  getConsultingR3Lock,
  getFinancePortfolio,
  getFinanceTeam,
  getOrMakeConsultant,
  getOrMakeProduct,
  getProductAvailableCash,
  getProductClaimedStatement,
  getProductR2Lock,
  getProductR3Lock,
} from "../coordination-types";

const baseSchedule=[["20:00","Check-in","Sign in on every device"],["20:45","Briefing","Rules and judging explained"],["21:15","Round 1 · Build","Problem cards dealt; PRD opens"],["22:15","The twist","Market change published to every screen"],["23:00","PRD locks","Autosaved final version is judged"],["23:30","PRD reveal","Scores and starting share prices"],["23:45","The crisis","Crisis cards; prices fall 15%; rescue lottery"],["00:15","Round 2 · Rescue","Q&A closes; solution writing starts"],["01:45","Rescue locks","AI judging begins; scores remain secret"],["02:15","Round 3 · Invest","Trading rounds 1–2; scores blind"],["02:45","Score reveal","Trading rounds 3–9"],["03:30","Leaderboard freeze","Live ranking freezes"],["04:30","Closing bell","Market closes; final prices and points"],["05:15","Awards","Results revealed on the big screen"]];
const consultingSchedule=[["20:00","Check-in","Sign in with your consulting team card (e.g. XC01) on every device"],["20:45","Briefing","Rules, crisis evaluation rubrics and judging explained"],["21:15","Round 1 · Crisis","Round 1 crisis case opens; write and submit your 6-part crisis solution"],["23:00","Round 1 closes","Submitted Round 1 crisis solutions are evaluated"],["23:30","R1 Valuation Result","Your Round 1 evaluation sets your Consultancy Team's base valuation"],["23:45","Round 2 · Bidding & Markup","Multiple Product teams offer deals; increase valuation & push deal"],["00:05","1:1 Mutual Lock","Both teams accept Lock Request (strictly 1 Consulting : 1 Product team)"],["00:15","Shared Topic Crisis","Locked Product team's topic crisis is given to both teams to solve"],["01:45","Round 2 closes","Submitted Round 2 collaborative crisis solutions are evaluated"],["02:15","Round 3 · Price or Auction","Ask Round 2 partner for price increase (or stay at base price); if rejected, enter Round 3 open auction"],["02:45","Round 3 Allotted Crisis","Solve and submit the Round 3 crisis of your allotted Product team"],["04:30","Settlement","Final Round 3 consultancy price settled after Round 3"],["05:15","Awards","Results revealed on the big screen"]];

export default function Dashboard(){
  const [track]=useDemoTrack();
  const code=useTeamCode();
  const {state}=useCoordination();

  if(track==="PRODUCT"){
    const product=getOrMakeProduct(state,code);
    const cash=getProductAvailableCash(state,code);
    const equityRetained=Math.max(0,Number((100-product.equityGivenPct).toFixed(2)));
    const r2Lock=getProductR2Lock(state,code);
    const r3Lock=getProductR3Lock(state,code);
    const claimedPs=getProductClaimedStatement(state,code);

    const productSchedule=[["20:00","Check-in","Sign in with your Product team card (e.g. XP01) on every device"],["20:45","Briefing","Sector rules, MVP rubric and crisis hiring explained"],["21:15","Round 1 · Idea & MVP","Assigned 1 of 3 sectors; pitch your idea and submit your MVP"],["23:00","Round 1 closes","Submitted Ideas & MVPs evaluated to set starting company prices"],["23:45","Round 2 · Raise & Hire","Start at $0 cash, broadcast equity raise to Finance teams, and lock 1:1 with a Consulting team"],["00:10","1:1 Lock & Collaboration","Mutually accept Lock Request with your Consulting team"],["00:25","Write Solution into MVP","Receive your Consulting team's live crisis solution and write it into your updated MVP"],["01:45","Round 2 closes","Updated MVPs with crisis solutions are evaluated"],["02:15","Round 3 · Re-Bid & Draft","Keep or re-bid consultant, draft 1 Problem Statement (least-money order), and build a new MVP"],["05:15","Awards","Results revealed on the big screen"]];

    return <>
      <PageTitle eyebrow={`TEAM HOME / PRODUCT TRACK · ${code}`} title={`Good evening, Team ${code}.`} sub={`Live workspace for ${product.company} (${product.ticker}). Every action you take—Round 1 MVP, Finance raises, Round 2 proposals & locks, Round 3 re-bids & Problem Statement picks—coordinates live with Consulting teams.`}/>
      <div className="guide-grid three">
        <Metric label="PRODUCT CASH BALANCE" value={`$${cash.toLocaleString()}`} delta={`EQUITY RETAINED: ${equityRetained}% · STARTED AT $0`}/>
        <Metric label="ROUND 2 CONSULTANT" value={r2Lock?`LOCKED · ${r2Lock.consultingCode}`:"NOT LOCKED"} delta={r2Lock?`FEE $${r2Lock.currentPrice.toLocaleString()} · ${r2Lock.r2SolutionSubmittedAt?"SOLUTION RECEIVED ✓":"AWAITING SOLUTION"}`:"RAISE FUNDS & LOCK 1:1 IN R2"}/>
        <Metric label="ROUND 3 STATUS" value={r3Lock?`LOCKED · ${r3Lock.consultingCode}`:"OPEN"} delta={claimedPs?`DISPATCHED ${claimedPs.id} LIVE ✓`:"DECIDE CONSULTANT & PICK STATEMENT"}/>
      </div>
      <div className="guide-grid two mt-4">
        <Panel title="Do this now" tag="LIVE END-TO-END WORKFLOW">
          <div className="guide-alert guide-warning">
            <b>Live Product ⇄ Consulting Coordination</b><br/>
            1. <b>Round 1:</b> {product.r1SubmittedAt?`✓ Submitted ${product.company} (${product.ticker}) at ${product.r1SubmittedAt}`:"Pitch your startup idea & submit your 7-part MVP."}<br/>
            2. <b>Round 2:</b> {r2Lock?`✓ Locked 1:1 with Consultant ${r2Lock.consultingCode} ($${r2Lock.currentPrice.toLocaleString()})`:"Broadcast an equity raise to Finance ($0 start), negotiate & lock 1:1 with a Consulting team."}<br/>
            3. <b>Round 3:</b> {r3Lock&&claimedPs?`✓ Locked ${r3Lock.consultingCode} & dispatched ${claimedPs.id}`:"Accept or remove consultant for re-bid, pick 1 Problem Statement, and build your New MVP."}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div><b className="text-sm">Product Workspace ({code})</b><p className="guide-muted mt-1">Jump directly to Round 1, Round 2, Round 3 or Live Q&amp;A.</p></div>
            <div className="flex flex-wrap gap-2">
              <Link className="guide-btn" href="/demo/build">ROUND 1: IDEA & MVP →</Link>
              <Link className="guide-btn" href="/demo/rescue">ROUND 2: RAISE & HIRE →</Link>
              <Link className="guide-btn" href="/demo/trade">ROUND 3: DRAFT & NEW MVP →</Link>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[["COMPANY",product.ticker],["CASH",`$${cash.toLocaleString()}`],["EQUITY",`${equityRetained}%`]].map(x=><div className="guide-metric" key={x[0]}><small>{x[0]}</small><b className="text-lg">{x[1]}</b></div>)}
          </div>
        </Panel>
        <Panel title="Live Product ⇄ Consulting coordination feed" tag={`SYNC v${state.version} · REAL-TIME`}>
          <div className="guide-scroll-box compact space-y-2">
            {state.events.map(ev=>(
              <div key={ev.id} className="border border-[#294832] p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="guide-chip">{ev.round} · {ev.actor}</span>
                  <span className="font-mono text-[9px] text-[#cfa078]">{ev.timestamp}</span>
                </div>
                <p className="guide-muted mt-1.5">{ev.summary}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <div className="guide-grid two mt-4">
        <Panel title="The night at a glance" tag="PRODUCT IST TIMETABLE">
          <div className="guide-scroll-box compact space-y-0">
            {productSchedule.map(s=><div className="flex gap-3 border-b border-[#294832] py-2.5 last:border-0" key={s[0]}><span className="w-16 shrink-0 font-mono text-[9px] text-[#ffbd66]">{s[0]}</span><div><b className="text-[11px]">{s[1]}</b><p className="guide-muted mt-1">{s[2]}</p></div></div>)}
          </div>
        </Panel>
        <Panel title="Latest news" tag="EVENT-WIDE">
          <div className="space-y-3">
            <div className="guide-alert guide-warning"><b>ROUND 2 CRISIS · 23:45 IST</b><br/>Product companies are hit by sector crises. Raise funds from Finance teams and lock a 1:1 Consulting team live.</div>
            <div className="guide-alert"><b>ROUND 1 SECTORS · 21:15 IST</b><br/>Product teams have been assigned 1 of the 3 sectors. Pitch your startup idea and submit your MVP before 23:00 IST.</div>
          </div>
          <Link href="/demo/newsroom" className="mt-4 inline-block text-xs text-[#ff9b45]">Open all news →</Link>
        </Panel>
      </div>
    </>;
  }

  if(track!=="CONSULTING"){
    return <><PageTitle eyebrow="TEAM HOME / FINANCE TRACK · TX-8821" title="Good evening, Vanguard." sub="Your team's live workspace for PRIMUS ’26. Start with the next task, keep track of your companies and follow the event timeline."/><div className="mt-4 flex flex-wrap gap-2"><Link className="guide-btn" href="/demo/finance/markets">Open trading desk →</Link><Link className="guide-chip" href="/demo/trade/event">Round 3 event ticket</Link></div><div className="guide-grid three mt-4"><Metric label="EVENT PHASE" value="ROUND 2 · RESCUE" delta="CRISIS SOLUTION WINDOW"/><Metric label="TEAM CASH" value="$100,000.00" delta="STARTING INVESTMENT CAPITAL"/><Metric label="YOUR TICKERS" value="FRPK / QAAC" delta="BUILT / RESCUED COMPANY"/></div><div className="guide-grid two mt-4"><Panel title="Do this now" tag="NEXT TASK · ACTION REQUIRED"><div className="guide-alert guide-warning"><b>Rescue round is underway.</b><br/>You are rescuing QAAC. Review its PRD and crisis card, then prepare your six-part crisis solution (up to 500 words).</div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div><b className="text-sm">Crisis solution for QAAC</b><p className="guide-muted mt-1">Autosaves as you write. No submit button.</p></div><Link className="guide-btn" href="/demo/rescue">CONTINUE SOLUTION →</Link></div><div className="mt-4 grid grid-cols-3 gap-2">{[["LOCK","01:45"],["WORD LIMIT","500"],["PARTS","06"]].map(x=><div className="guide-metric" key={x[0]}><small>{x[0]}</small><b className="text-lg">{x[1]}</b></div>)}</div></Panel><Panel title="Your companies" tag="TEAM PORTFOLIO"><div className="space-y-4"><div><span className="guide-chip">YOU BUILT</span><h3 className="mt-2 text-lg font-semibold">FreshPack Foods <span className="font-mono">FRPK</span></h3><p className="guide-muted">Your Round 1 PRD company · starting share price $11.80</p></div><div className="border-t border-[#292e38] pt-4"><span className="guide-chip">YOU RESCUE</span><h3 className="mt-2 text-lg font-semibold">AquaCare <span className="font-mono">QAAC</span></h3><p className="guide-muted">Rescue assignment · crisis card: tax change</p></div></div></Panel></div><div className="guide-grid two mt-4"><Panel title="The night at a glance" tag="PLANNED IST TIMETABLE"><div className="guide-scroll-box compact space-y-0">{baseSchedule.map(s=><div className="flex gap-3 border-b border-[#294832] py-2.5 last:border-0" key={s[0]}><span className="w-16 shrink-0 font-mono text-[9px] text-[#ffbd66]">{s[0]}</span><div><b className="text-[11px]">{s[1]}</b><p className="guide-muted mt-1">{s[2]}</p></div></div>)}</div></Panel><Panel title="Latest news" tag="EVENT-WIDE"><div className="space-y-3"><div className="guide-alert guide-warning"><b>CRISIS · 23:45 IST</b><br/>Every company is hit. All share prices fall 15%. The rescue lottery assigns each team another company&apos;s crisis to solve.</div><div className="guide-alert"><b>TWIST · 22:15 IST</b><br/>The distributor margin has increased. Your PRD must account for the new per-pack economics.</div></div><Link href="/demo/newsroom" className="mt-4 inline-block text-xs">Open all news →</Link></Panel></div></>;
    const finCode=code.startsWith("XF")?code:"XF01";
    const finTeam=getFinanceTeam(state,finCode);
    const portfolio=getFinancePortfolio(state,finCode);
    const deployed=portfolio.reduce((sum,d)=>sum+d.amountInvested,0);
    const uniqueBacked=new Set(portfolio.map(d=>d.productCode)).size;
    const openRaises=state.raiseRequests.filter(r=>r.status==="OPEN").length;
    return <>
      <PageTitle
        eyebrow={`TEAM HOME / FINANCE TRACK · ${finTeam.code} (${finTeam.name})`}
        title={`Good evening, ${finTeam.name}.`}
        sub="Your Finance team starts Round 1 with allocated investment capital. In Round 2, inspect all Product teams' MVPs, review their equity-for-cash funding requests, and close deals with one or multiple Product teams to build your live portfolio."
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <Link className="guide-btn" href="/demo/rescue">OPEN ROUND 2: PRODUCT MVPs &amp; DEALS →</Link>
        <Link className="guide-btn secondary" href="/demo/finance">OPEN FINANCE DESK →</Link>
        <Link className="guide-chip" href="/demo/finance/markets">Round 3 trading desk</Link>
      </div>
      <div className="guide-grid three mt-4">
        <Metric label="AVAILABLE CAPITAL" value={`$${finTeam.availableCapital.toLocaleString()}`} delta={`STARTED R1 WITH $${finTeam.initialCapital.toLocaleString()} · DEPLOYED $${deployed.toLocaleString()}`}/>
        <Metric label="OPEN PRODUCT ASKS" value={`${openRaises} LIVE`} delta={`${state.productOrder.length} PRODUCT MVPS TO REVIEW IN R2`}/>
        <Metric label="PORTFOLIO DEALS" value={`${portfolio.length} CLOSED`} delta={`${uniqueBacked} PRODUCT COMPAN${uniqueBacked===1?"Y":"IES"} BACKED`}/>
      </div>
      <div className="guide-grid two mt-4">
        <Panel title="Do this now" tag="LIVE FINANCE WORKFLOW">
          <div className="guide-alert guide-warning">
            <b>Finance Three-Round Workflow</b><br/>
            1. <b>Round 1:</b> Allocated <b>${finTeam.initialCapital.toLocaleString()}</b> initial fund capital.<br/>
            2. <b>Round 2:</b> Inspect Product teams&apos; complete MVPs in popups, compare money requested vs. equity offered, and close deals with <b>multiple Product teams</b>.<br/>
            3. <b>Round 3:</b> Trade &amp; manage your live portfolio on the Finance Desk.
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div><b className="text-sm">{finTeam.name} ({finTeam.code})</b><p className="guide-muted mt-1">Jump directly to Round 1 Capital, Round 2 MVP Deals, or Finance Desk.</p></div>
            <div className="flex flex-wrap gap-2">
              <Link className="guide-btn secondary" href="/demo/build">R1: CAPITAL →</Link>
              <Link className="guide-btn" href="/demo/rescue">R2: MVP DEALS →</Link>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[["R1 CAPITAL",`$${finTeam.initialCapital.toLocaleString()}`],["DEPLOYED",`$${deployed.toLocaleString()}`],["DEALS",String(portfolio.length)]].map(x=><div className="guide-metric" key={x[0]}><small>{x[0]}</small><b className="text-lg">{x[1]}</b></div>)}
          </div>
        </Panel>
        <Panel title="Live 3-track coordination feed" tag={`SYNC v${state.version} · REAL-TIME`}>
          <div className="guide-scroll-box compact space-y-2">
            {state.events.map(ev=>(
              <div key={ev.id} className="border border-[#294832] p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="guide-chip">{ev.round} · {ev.actor}</span>
                  <span className="font-mono text-[9px] text-[#9ba2ad]">{ev.timestamp}</span>
                </div>
                <p className="guide-muted mt-1.5">{ev.summary}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <div className="guide-grid two mt-4">
        <Panel title="The night at a glance" tag="PLANNED IST TIMETABLE"><div className="guide-scroll-box compact space-y-0">{baseSchedule.map(s=><div className="flex gap-3 border-b border-[#294832] py-2.5 last:border-0" key={s[0]}><span className="w-16 shrink-0 font-mono text-[9px] text-[#ffbd66]">{s[0]}</span><div><b className="text-[11px]">{s[1]}</b><p className="guide-muted mt-1">{s[2]}</p></div></div>)}</div></Panel>
        <Panel title="Latest news" tag="EVENT-WIDE"><div className="space-y-3"><div className="guide-alert guide-warning"><b>ROUND 2 DEAL ROOM · 23:45 IST</b><br/>Product teams have launched equity-for-cash raises to hire consultants. Open any Product MVP popup in Round 2 to evaluate and close deals.</div><div className="guide-alert"><b>ROUND 1 CAPITAL · 21:15 IST</b><br/>All Finance desks have received initial Round 1 capital allocations.</div></div><Link href="/demo/newsroom" className="mt-4 inline-block text-xs">Open all news →</Link></Panel>
      </div>
    </>;
  }

  const consultant=getOrMakeConsultant(state,code);
  const r2Lock=getConsultingR2Lock(state,code);
  const r3Lock=getConsultingR3Lock(state,code);
  const r3Ps=r3Lock?getProductClaimedStatement(state,r3Lock.productCode):null;

  return <>
    <PageTitle eyebrow={`TEAM HOME / CONSULTING TRACK · ${code}`} title={`Good evening, Team ${code}.`} sub="Live consulting workspace for PRIMUS ’26. Every proposal, markup push, 1:1 Lock Request, and crisis solution syncs end-to-end with Product teams across Rounds 1, 2 and 3."/>
    <div className="guide-grid three">
      <Metric label="CONSULTING BASE VALUE" value={`$${consultant.baseValue.toLocaleString()}`} delta={`TEAM ${code} · R1 SCORE ${consultant.r1Score}/100`}/>
      <Metric label="ROUND 2 1:1 LOCK" value={r2Lock?`LOCKED · ${r2Lock.productCode}`:"NOT LOCKED"} delta={r2Lock?`DEAL $${r2Lock.currentPrice.toLocaleString()} · ${r2Lock.r2SolutionSubmittedAt?"SOLUTION DELIVERED ✓":"WRITE SOLUTION"}`:"NEGOTIATE & LOCK 1:1 IN R2"}/>
      <Metric label="ROUND 3 ALLOTMENT" value={r3Lock?`ALLOTTED · ${r3Lock.productCode}`:"OPEN"} delta={r3Ps?`RECEIVED ${r3Ps.id} LIVE ✓`:r3Lock?`FEE $${r3Lock.finalPrice.toLocaleString()} · AWAITING PS`:"ASK R3 PRICE OR RE-ENTER AUCTION"}/>
    </div>
    <div className="guide-grid two mt-4">
      <Panel title="Do this now" tag="LIVE END-TO-END WORKFLOW">
        <div className="guide-alert guide-warning">
          <b>Live Consulting ⇄ Product Coordination</b><br/>
          1. <b>Round 1:</b> {consultant.r1SubmittedAt?`✓ Submitted Round 1 Crisis Solution at ${consultant.r1SubmittedAt}`:"Solve the opening crisis and submit to set your base valuation."}<br/>
          2. <b>Round 2:</b> {r2Lock?`✓ Locked 1:1 with ${r2Lock.productCode} at $${r2Lock.currentPrice.toLocaleString()}`:"Push demand increases & complete a mutual 1:1 Lock Request with a Product team."}<br/>
          3. <b>Round 3:</b> {r3Lock?`✓ Allotted 1:1 with ${r3Lock.productCode} ($${r3Lock.finalPrice.toLocaleString()})`:"Send your Round 3 price ask (or enter open auction) and solve your client's dispatched Problem Statement."}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div><b className="text-sm">Consulting Workspace ({code})</b><p className="guide-muted mt-1">Jump directly to Round 1, Round 2 or Round 3.</p></div>
          <div className="flex flex-wrap gap-2">
            <Link className="guide-btn" href="/demo/build">ROUND 1 CRISIS →</Link>
            <Link className="guide-btn" href="/demo/rescue">ROUND 2 LOCK & CRISIS →</Link>
            <Link className="guide-btn" href="/demo/trade">ROUND 3 AUCTION & CRISIS →</Link>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[["TEAM",code],["BASE VALUE",`$${consultant.baseValue.toLocaleString()}`],["PAIRING",r3Lock?.productCode??r2Lock?.productCode??"1 : 1"]].map(x=><div className="guide-metric" key={x[0]}><small>{x[0]}</small><b className="text-lg">{x[1]}</b></div>)}
        </div>
      </Panel>
      <Panel title="Live Consulting ⇄ Product coordination feed" tag={`SYNC v${state.version} · REAL-TIME`}>
        <div className="guide-scroll-box compact space-y-2">
          {state.events.map(ev=>(
            <div key={ev.id} className="border border-[#294832] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="guide-chip">{ev.round} · {ev.actor}</span>
                <span className="font-mono text-[9px] text-[#7cc4ff]">{ev.timestamp}</span>
              </div>
              <p className="guide-muted mt-1.5">{ev.summary}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
    <div className="guide-grid two mt-4">
      <Panel title="The night at a glance" tag="PLANNED IST TIMETABLE">
        <div className="guide-scroll-box compact space-y-0">
          {consultingSchedule.map(s=><div className="flex gap-3 border-b border-[#294832] py-2.5 last:border-0" key={s[0]}><span className="w-16 shrink-0 font-mono text-[9px] text-[#7cc4ff]">{s[0]}</span><div><b className="text-[11px]">{s[1]}</b><p className="guide-muted mt-1">{s[2]}</p></div></div>)}
        </div>
      </Panel>
      <Panel title="Latest news" tag="EVENT-WIDE">
        <div className="space-y-3">
          <div className="guide-alert guide-warning"><b>ROUND 2 &amp; 3 MARKETPLACE · 23:45 IST</b><br/>Product teams offer deals to consultancies; push your demand and complete a 1:1 mutual lock to unlock your client&apos;s crisis.</div>
          <div className="guide-alert"><b>ROUND 1 CRISIS · 21:15 IST</b><br/>Consulting teams ({code}) receive the opening crisis case. Submit your 6-part solution before 23:00 IST.</div>
        </div>
        <Link href="/demo/newsroom" className="mt-4 inline-block text-xs text-[#63a8ff]">Open all news →</Link>
      </Panel>
    </div>
  </>;
}
