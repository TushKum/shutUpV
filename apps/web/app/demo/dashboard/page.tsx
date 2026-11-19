"use client";
import Link from "next/link";
import {PageTitle,Panel,Metric,useDemoTrack,useTeamCode} from "../ui";
const baseSchedule=[["20:00","Check-in","Sign in on every device"],["20:45","Briefing","Rules and judging explained"],["21:15","Round 1 · Build","Problem cards dealt; PRD opens"],["22:15","The twist","Market change published to every screen"],["23:00","PRD locks","Autosaved final version is judged"],["23:30","PRD reveal","Scores and starting share prices"],["23:45","The crisis","Crisis cards; prices fall 15%; rescue lottery"],["00:15","Round 2 · Rescue","Q&A closes; solution writing starts"],["01:45","Rescue locks","AI judging begins; scores remain secret"],["02:15","Round 3 · Invest","Trading rounds 1–2; scores blind"],["02:45","Score reveal","Trading rounds 3–9"],["03:30","Leaderboard freeze","Live ranking freezes"],["04:30","Closing bell","Market closes; final prices and points"],["05:15","Awards","Results revealed on the big screen"]];
const consultingSchedule=[["20:00","Check-in","Sign in with your consulting team card (e.g. XC01) on every device"],["20:45","Briefing","Rules, crisis evaluation rubrics and judging explained"],["21:15","Round 1 · Crisis","Round 1 crisis case opens; write and submit your 6-part crisis solution"],["23:00","Round 1 closes","Submitted Round 1 crisis solutions are evaluated"],["23:30","R1 Valuation Result","Your Round 1 evaluation sets your Consultancy Team's base valuation"],["23:45","Round 2 · Bidding & Markup","Multiple Product teams offer deals; increase valuation & push deal"],["00:05","1:1 Mutual Lock","Both teams accept Lock Request (strictly 1 Consulting : 1 Product team)"],["00:15","Shared Topic Crisis","Locked Product team's topic crisis is given to both teams to solve"],["01:45","Round 2 closes","Submitted Round 2 collaborative crisis solutions are evaluated"],["02:15","Round 3 · Price or Auction","Ask Round 2 partner for price increase (or stay at base price); if rejected, enter Round 3 open auction"],["02:45","Round 3 Allotted Crisis","Solve and submit the Round 3 crisis of your allotted Product team"],["04:30","Settlement","Final Round 3 consultancy price settled after Round 3"],["05:15","Awards","Results revealed on the big screen"]];
export default function Dashboard(){
 const [track]=useDemoTrack();
 const code=useTeamCode();
 if(track==="PRODUCT"){
  const productSchedule=[["20:00","Check-in","Sign in with your Product team card (e.g. XP01) on every device"],["20:45","Briefing","Sector rules, MVP rubric and crisis hiring explained"],["21:15","Round 1 · Idea & MVP","Assigned 1 of 3 sectors; pitch your idea and submit your MVP"],["23:00","Round 1 closes","Submitted Ideas & MVPs evaluated to set starting company prices"],["23:45","Round 2 · Crisis & Hire","Your company is hit by a crisis; browse Consulting teams & base values, send proposal & review any price increase"],["00:10","1:1 Lock & Collaboration","Send Lock Request once proposal is accepted; locked 1:1 with your Consulting team"],["00:25","Write Solution into MVP","Receive your Consulting team's crisis solution and write it into your updated MVP"],["01:45","Round 2 closes","Updated MVPs with crisis solutions are evaluated"],["02:15","Round 3 · Trade & Saturation","Market rounds and final valuation"],["05:15","Awards","Results revealed on the big screen"]];
  return <>
   <PageTitle eyebrow={`TEAM HOME / PRODUCT TRACK · ${code}`} title={`Good evening, Team ${code}.`} sub="Your Product team's live workspace for PRIMUS ’26. Pitch your idea and build your MVP in Round 1 for your assigned sector, then hire & lock a Consulting team in Round 2 to solve your crisis and update your MVP."/>
   <div className="guide-grid three">
    <Metric label="PRODUCT TEAM" value={`Team ${code}`} delta={`ASSIGNED CODE · ${code}`}/>
    <Metric label="ASSIGNED SECTOR" value="FMCG (1 OF 3)" delta="PITCH IDEA & BUILD MVP"/>
    <Metric label="ROUND 2 HIRING" value="STRICT 1 : 1" delta="HIRE & LOCK 1 CONSULTING TEAM"/>
   </div>
   <div className="guide-grid two mt-4">
    <Panel title="Do this now" tag="NEXT TASK · ACTION REQUIRED">
     <div className="guide-alert guide-warning"><b>Product Team Workflow</b><br/>1. <b>Round 1:</b> Receive 1 of the 3 sectors, pitch your startup idea, and submit your 7-part MVP.<br/>2. <b>Round 2:</b> Start with <b>$0 cash</b>—broadcast an overall equity-for-cash raise request (e.g. 3% for $30,000) to all Finance teams, then hire &amp; lock 1-to-1 with a Consulting team and write their crisis solution into your MVP.</div>
     <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div><b className="text-sm">Product Workspace ({code})</b><p className="guide-muted mt-1">Jump directly to Round 1, Round 2 or Round 3.</p></div>
      <div className="flex flex-wrap gap-2">
       <Link className="guide-btn" href="/demo/build">ROUND 1: IDEA & MVP →</Link>
       <Link className="guide-btn" href="/demo/rescue">ROUND 2: RAISE & HIRE →</Link>
       <Link className="guide-btn" href="/demo/trade">ROUND 3: DRAFT & NEW MVP →</Link>
      </div>
     </div>
     <div className="mt-4 grid grid-cols-3 gap-2">{[["TEAM",code],["START CASH","$0"],["EQUITY","100%"]].map(x=><div className="guide-metric" key={x[0]}><small>{x[0]}</small><b className="text-lg">{x[1]}</b></div>)}</div>
    </Panel>
    <Panel title="Your Product rounds" tag={`TEAM ${code}`}>
     <div className="space-y-3">
      <div><span className="guide-chip">ROUND 1 · SECTOR, IDEA PITCH & MVP</span><h3 className="mt-1.5 text-base font-semibold">Pitch Your Idea &amp; Make Your MVP <span className="font-mono text-[#ff9b45]">R1</span></h3><p className="guide-muted">Assigned 1 of 3 sectors (FMCG, FinTech, HealthTech). Pitch your startup idea, define your MVP features and unit maths, and submit.</p></div>
      <div className="border-t border-[#294832] pt-3"><span className="guide-chip">ROUND 2 · CRISIS, HIRE CONSULTANT & UPDATE MVP</span><h3 className="mt-1.5 text-base font-semibold">Hire 1:1 Consulting Team &amp; Integrate Solution <span className="font-mono text-[#ff9b45]">R2</span></h3><p className="guide-muted">See all Consulting teams &amp; their base values, review any price markup above base, send a Lock Request once accepted, and write their crisis solution into your updated MVP.</p></div>
     </div>
    </Panel>
   </div>
   <div className="guide-grid two mt-4">
    <Panel title="The night at a glance" tag="PRODUCT IST TIMETABLE"><div className="max-h-[440px] space-y-0 overflow-auto">{productSchedule.map(s=><div className="flex gap-3 border-b border-[#294832] py-2.5 last:border-0" key={s[0]}><span className="w-16 shrink-0 font-mono text-[9px] text-[#ffbd66]">{s[0]}</span><div><b className="text-[11px]">{s[1]}</b><p className="guide-muted mt-1">{s[2]}</p></div></div>)}</div></Panel>
    <Panel title="Latest news" tag="EVENT-WIDE"><div className="space-y-3"><div className="guide-alert guide-warning"><b>ROUND 2 CRISIS · 23:45 IST</b><br/>Product companies are hit by sector crises. Review Consulting teams&apos; Round 1 valuations and send your proposal to hire a 1:1 consultant.</div><div className="guide-alert"><b>ROUND 1 SECTORS · 21:15 IST</b><br/>Product teams have been assigned 1 of the 3 sectors. Pitch your startup idea and submit your MVP before 23:00 IST.</div></div><Link href="/demo/newsroom" className="mt-4 inline-block text-xs text-[#ff9b45]">Open all news →</Link></Panel>
   </div>
  </>;
 }
 if(track!=="CONSULTING"){
  return <><PageTitle eyebrow="TEAM HOME / FINANCE TRACK · TX-8821" title="Good evening, Vanguard." sub="Your team's live workspace for PRIMUS ’26. Start with the next task, keep track of your companies and follow the event timeline."/><div className="guide-grid three"><Metric label="EVENT PHASE" value="ROUND 2 · RESCUE" delta="CRISIS SOLUTION WINDOW"/><Metric label="TEAM CASH" value="$100,000.00" delta="STARTING INVESTMENT CAPITAL"/><Metric label="YOUR TICKERS" value="FRPK / QAAC" delta="BUILT / RESCUED COMPANY"/></div><div className="guide-grid two mt-4"><Panel title="Do this now" tag="NEXT TASK · ACTION REQUIRED"><div className="guide-alert guide-warning"><b>Rescue round is underway.</b><br/>You are rescuing QAAC. Review its PRD and crisis card, then prepare your six-part crisis solution (up to 500 words).</div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div><b className="text-sm">Crisis solution for QAAC</b><p className="guide-muted mt-1">Autosaves as you write. No submit button.</p></div><Link className="guide-btn" href="/demo/rescue">CONTINUE SOLUTION →</Link></div><div className="mt-4 grid grid-cols-3 gap-2">{[["LOCK","01:45"],["WORD LIMIT","500"],["PARTS","06"]].map(x=><div className="guide-metric" key={x[0]}><small>{x[0]}</small><b className="text-lg">{x[1]}</b></div>)}</div></Panel><Panel title="Your companies" tag="TEAM PORTFOLIO"><div className="space-y-4"><div><span className="guide-chip">YOU BUILT</span><h3 className="mt-2 text-lg font-semibold">FreshPack Foods <span className="font-mono">FRPK</span></h3><p className="guide-muted">Your Round 1 PRD company · starting share price $11.80</p></div><div className="border-t border-[#292e38] pt-4"><span className="guide-chip">YOU RESCUE</span><h3 className="mt-2 text-lg font-semibold">AquaCare <span className="font-mono">QAAC</span></h3><p className="guide-muted">Rescue assignment · crisis card: tax change</p></div></div></Panel></div><div className="guide-grid two mt-4"><Panel title="The night at a glance" tag="PLANNED IST TIMETABLE"><div className="max-h-[440px] space-y-0 overflow-auto">{baseSchedule.map(s=><div className="flex gap-3 border-b border-[#294832] py-2.5 last:border-0" key={s[0]}><span className="w-16 shrink-0 font-mono text-[9px] text-[#ffbd66]">{s[0]}</span><div><b className="text-[11px]">{s[1]}</b><p className="guide-muted mt-1">{s[2]}</p></div></div>)}</div></Panel><Panel title="Latest news" tag="EVENT-WIDE"><div className="space-y-3"><div className="guide-alert guide-warning"><b>CRISIS · 23:45 IST</b><br/>Every company is hit. All share prices fall 15%. The rescue lottery assigns each team another company&apos;s crisis to solve.</div><div className="guide-alert"><b>TWIST · 22:15 IST</b><br/>The distributor margin has increased. Your PRD must account for the new per-pack economics.</div></div><Link href="/demo/newsroom" className="mt-4 inline-block text-xs">Open all news →</Link></Panel></div></>;
 }
 return <>
  <PageTitle eyebrow={`TEAM HOME / CONSULTING TRACK · ${code}`} title={`Good evening, Team ${code}.`} sub="Your consulting team's live workspace for PRIMUS ’26. Solve the Round 1 crisis to establish your valuation, negotiate & mutually lock 1-to-1 with a Product team in Round 2, and either renew at a Round 3 price or re-enter the Round 3 auction."/>
  <div className="guide-grid three">
   <Metric label="CONSULTING TEAM" value={`Team ${code}`} delta={`PRE-ASSIGNED CODE · ${code}`}/>
   <Metric label="R1 BASE VALUATION" value="$40,000" delta="BASE PRICE across R2 & R3"/>
   <Metric label="PAIRING RULE" value="STRICT 1 : 1" delta="MUTUAL LOCK & DUAL ACCEPTANCE"/>
  </div>
  <div className="guide-grid two mt-4">
   <Panel title="Do this now" tag="NEXT TASK · ACTION REQUIRED">
    <div className="guide-alert guide-warning"><b>Consulting Three-Round Workflow</b><br/>1. <b>Round 1:</b> Solve the opening crisis and click <b>Submit Solution</b> to earn your base valuation.<br/>2. <b>Round 2:</b> Push your demand increase on offered Product deals, then complete a <b>1:1 Lock Request</b> accepted by both teams to solve their topic&apos;s crisis.<br/>3. <b>Round 3:</b> Stay at base price or ask your Round 2 Product team for a price increase (if rejected, unlock into the Round 3 auction) and solve your allotted Product team&apos;s crisis.</div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
     <div><b className="text-sm">Consulting Workspace ({code})</b><p className="guide-muted mt-1">Jump directly to Round 1, Round 2 or Round 3.</p></div>
     <div className="flex flex-wrap gap-2">
      <Link className="guide-btn" href="/demo/build">ROUND 1 CRISIS →</Link>
      <Link className="guide-btn" href="/demo/rescue">ROUND 2 LOCK & CRISIS →</Link>
      <Link className="guide-btn" href="/demo/trade">ROUND 3 AUCTION & CRISIS →</Link>
     </div>
    </div>
    <div className="mt-4 grid grid-cols-3 gap-2">{[["TEAM",code],["BASE VALUE","$40,000"],["PAIRING","1 : 1 LOCK"]].map(x=><div className="guide-metric" key={x[0]}><small>{x[0]}</small><b className="text-lg">{x[1]}</b></div>)}</div>
   </Panel>
   <Panel title="Your three consulting rounds" tag={`TEAM ${code}`}>
    <div className="space-y-3">
     <div><span className="guide-chip">ROUND 1 · SOLVE OPENING CRISIS</span><h3 className="mt-1.5 text-base font-semibold">ElevenLabs India Crisis <span className="font-mono text-[#63a8ff]">R1</span></h3><p className="guide-muted">Pre-decided team code (<b>{code}</b>). Solve the crisis and submit your answers to set your base valuation.</p></div>
     <div className="border-t border-[#294832] pt-3"><span className="guide-chip">ROUND 2 · DEAL PUSH, 1:1 LOCK & SHARED CRISIS</span><h3 className="mt-1.5 text-base font-semibold">Push Deal, Mutual Lock & Solve Topic Crisis <span className="font-mono text-[#63a8ff]">R2</span></h3><p className="guide-muted">Push increased demand on Product team offered deals (not locked until both teams accept a Lock Request), then solve that Product team&apos;s topic crisis.</p></div>
     <div className="border-t border-[#294832] pt-3"><span className="guide-chip">ROUND 3 · PRICE INCREASE OR AUCTION & CRISIS</span><h3 className="mt-1.5 text-base font-semibold">Renew Price or Re-Enter Auction <span className="font-mono text-[#63a8ff]">R3</span></h3><p className="guide-muted">Keep base price or ask your R2 Product team for a price increase (paid after R3 if accepted; unlocked into the R3 auction if not accepted), then solve your allotted Product team&apos;s crisis.</p></div>
    </div>
   </Panel>
  </div>
  <div className="guide-grid two mt-4">
   <Panel title="The night at a glance" tag="PLANNED IST TIMETABLE"><div className="max-h-[440px] space-y-0 overflow-auto">{consultingSchedule.map(s=><div className="flex gap-3 border-b border-[#294832] py-2.5 last:border-0" key={s[0]}><span className="w-16 shrink-0 font-mono text-[9px] text-[#7cc4ff]">{s[0]}</span><div><b className="text-[11px]">{s[1]}</b><p className="guide-muted mt-1">{s[2]}</p></div></div>)}</div></Panel>
   <Panel title="Latest news" tag="EVENT-WIDE"><div className="space-y-3"><div className="guide-alert guide-warning"><b>ROUND 2 & 3 MARKETPLACE · 23:45 IST</b><br/>Round 1 evaluation values are out. Product teams offer deals to consultancies; push your demand and complete a 1:1 mutual lock to unlock your client&apos;s crisis.</div><div className="guide-alert"><b>ROUND 1 CRISIS · 21:15 IST</b><br/>Consulting teams ({code}) receive the opening crisis case. Submit your 6-part solution before 23:00 IST.</div></div><Link href="/demo/newsroom" className="mt-4 inline-block text-xs text-[#63a8ff]">Open all news →</Link></Panel>
  </div>
 </>;
}
