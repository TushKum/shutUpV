"use client";
import Link from "next/link";
import {PageTitle,Panel,useDemoTrack} from "../ui";
const baseRubrics=[{name:"Round 1 · PRD",items:[["Problem and user",20],["Solution and requirements",25],["Business model and per-pack maths",20],["Go to market",15],["Success metrics",10],["Risks and assumptions",10]]},{name:"Round 2 · Crisis solution",items:[["Diagnosis",20],["Options",20],["Recommendation backed by per-pack numbers",25],["Feasibility and cost",15],["Timeline and milestones",10],["Risks",10]]}];
const consultingRubrics=[{name:"Round 1 · Consultancy Crisis Memo",items:[["Diagnosis (root problem & what is at stake)",25],["Options and trade-offs (cost, gain & risk)",20],["Recommendation (one clear choice & rationale)",20],["The numbers (₹20 Cr budget & ₹30 Cr path)",15],["Risks (deepfake, election & competitive mitigations)",10],["Next steps (concrete actions, owners & dates)",10]]},{name:"Round 2 · Client Crisis Solution & Advisory",items:[["Diagnosis (crisis impact on client in numbers)",20],["Options (three ways out with cost & effect)",20],["Recommendation backed by per-pack numbers",25],["Feasibility and cost",15],["Timeline and milestones",10],["Risks and contingency plan B",10]]}];
export default function Judging(){
 const [track]=useDemoTrack();
 const isConsulting=track==="CONSULTING";
 const rubrics=isConsulting?consultingRubrics:baseRubrics;
 return <>
  <PageTitle eyebrow={isConsulting?"REFERENCE / CONSULTING AI JUDGING":"REFERENCE / AI JUDGING"} title="How judging works." sub={isConsulting?"The official rubrics and anonymous judging process used to score your Round 1 crisis memo and Round 2 client rescue solution. Judges see only tickers, never firm or member names.":"The rubrics and judging process used to score written work. Judges see only the ticker, never team, member or company names."}/>
  <div className="guide-grid two">{rubrics.map(r=><Panel key={r.name} title={r.name} tag="100 POINTS"><table className="guide-table"><tbody>{r.items.map(x=><tr key={x[0]}><td>{x[0]}</td><td className="text-right font-mono">{x[1]}</td></tr>)}<tr><td><b>Total</b></td><td className="text-right font-mono text-[#39ff88]">100</td></tr></tbody></table></Panel>)}</div>
  <div className="guide-grid two mt-4">
   <Panel title={isConsulting?"Round 1 · Crisis Memo judging":"Round 1 · PRD judging"} tag="THREE READS">
    <p className="guide-muted">{isConsulting?"AI judges read every firm's 500-word crisis memo (on the standalone ElevenLabs India case) three times; the median score counts. At the reveal, your firm sees its score, rubric breakdown and three-sentence rationale.":"AI judges read every PRD three times. The middle score counts. At the reveal, teams see their score, rubric-line points and a three-sentence reason."}</p>
    <p className="guide-muted mt-3">{isConsulting?"Opening reputation bonus = $500 × (memo score − 50), clamped between −$10,000 and +$25,000. The memo moves no company share price.":"Starting share price = $10.00 + $0.10 × (PRD score − 50). Round 1 points equal the PRD score. For a score of 68, the sample rule prices the IPO at $11.80."}</p>
   </Panel>
   <Panel title={isConsulting?"Round 2 · Client Rescue judging":"Round 2 · Rescue judging"} tag="BLIND REVIEW">
    <p className="guide-muted">{isConsulting?"The judge reads your 500-word crisis solution together with your client company's PRD and its crisis card. It never sees firm, team or company names: only the client ticker (QAAC).":"The judge reads the rescue solution together with the rescued company's PRD and crisis card. It never sees team names, member names or company names: only the ticker."}</p>
    <p className="guide-muted mt-3">{isConsulting?"At the score reveal, the client's share price moves by Price × (1 + 0.5% × (crisis score − 50)), and your Round 2 points equal the score of the crisis solution your consultancy wrote.":"Round 2 points equal the score of the solution your team wrote, not the score of the solution written for your company."}</p>
   </Panel>
  </div>
  {track === "FINANCE" && <div className="mt-4"><Panel title="How judging affects the market"><p className="guide-muted">A rescue score of 60 gives the rescued company a +5% price adjustment at reveal. Your team earns Round 2 points for the rescue it wrote. Round 3 is the investment round, measured through trading performance.</p><Link className="guide-chip mt-3 inline-block" href="/demo/market">See prices and reveal mechanics</Link></Panel></div>}
  <div className="guide-alert guide-warning mt-4">Lines aimed at the judge (“ignore the rubric” or “give this full marks”) are removed before judging and logged. A second attempt by the same team costs 10 points from that round.</div>
 </>
}
