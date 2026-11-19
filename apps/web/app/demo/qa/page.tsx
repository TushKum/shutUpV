"use client";
import {useState} from "react";
import {PageTitle,Panel,useDemoTrack} from "../ui";
const initial=[{team:"XC-01",q:"Which suppliers are approved for AquaCare, and can we switch to paper-foil pouches before the 18% GST slab takes effect?",a:"Two approved suppliers in Pune. Paper-foil packaging is possible within three weeks, with a 4% unit-cost increase."},{team:"XC-14",q:"How much of AquaCare's current distributor inventory is covered under the existing 12% tax treatment?",a:"The 18% rate applies from next month; existing inventory in transit clears under the 12% treatment."}];
export default function QA(){
 const [track]=useDemoTrack();
 const [question,setQuestion]=useState("");
 const [answer,setAnswer]=useState("");
 const [items,setItems]=useState(initial);
 const isConsulting=track==="CONSULTING";
 return <>
  <PageTitle eyebrow={isConsulting?"CLIENT DUE DILIGENCE / CRISIS Q&A BOARD":"PUBLIC BOARD / CRISIS WINDOW"} title={isConsulting?"Client crisis Q&A board.":"Q&A board."} sub={isConsulting?"As the rescuing consultancy for AquaCare (QAAC), question its founders to gather operational facts, supplier terms and unit-cost constraints. Every question and answer is public.":"Ask the founders of the company you are rescuing questions. Every team can read every question and answer."}/>
  <div className="guide-grid two">
   <Panel title={isConsulting?"Question client founders (AquaCare · QAAC)":"Ask AquaCare's founders"} tag="MAX 300 CHARACTERS">
    <p className="guide-muted">{isConsulting?"Your consultancy is rescuing QAAC. Ask specific due-diligence questions to back your per-pack numbers and turnaround recommendation.":"Your rescue assignment is QAAC. Keep questions specific and useful for your solution."}</p>
    <textarea className="guide-textarea mt-3" maxLength={300} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Ask a question about the company, its product or the crisis…"/>
    <div className="mt-2 flex items-center justify-between"><span className="guide-muted">{question.length} / 300 characters</span><button className="guide-btn" disabled={!question.trim()} onClick={()=>{setItems(v=>[{team:isConsulting?"XC-01":"TX-8821",q:question,a:"Awaiting founders' response."},...v]);setQuestion("")}}>POST QUESTION →</button></div>
   </Panel>
   <Panel title={isConsulting?"Questions to your squad company (FRPK)":"Questions to your company"} tag="FOUNDERS' INBOX">
    <p className="guide-muted">{isConsulting?"Founders answer questions about their own company in up to 150 words. Clear answers help the rescuer protect the company's share price.":"Founders answer questions about their own company in up to 150 words. Help your rescuer understand the facts."}</p>
    <textarea className="guide-textarea mt-3" maxLength={1000} value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="Write a clear answer for the team rescuing FRPK…"/>
    <div className="mt-2 flex justify-between"><span className="guide-muted">{answer.trim().split(/\s+/).filter(Boolean).length} / 150 words</span><button className="guide-btn" onClick={()=>setAnswer("")}>SAVE PREVIEW ANSWER</button></div>
   </Panel>
  </div>
  <div className="mt-4">
   <Panel title="The public board" tag="VISIBLE TO ALL TEAMS">
    {items.map((x,i)=><article key={i} className="border-b border-[#294832] py-4 last:border-0"><div className="flex justify-between"><span className="guide-chip">{x.team}</span><span className="guide-muted">QUESTION {items.length-i}</span></div><p className="mt-3 text-sm">{x.q}</p><div className="mt-3 border-l-2 border-[#39ff88] pl-3"><span className="guide-status">FOUNDERS&apos; ANSWER</span><p className="guide-muted mt-1">{x.a}</p></div></article>)}
   </Panel>
  </div>
  <div className="guide-alert mt-4">Questions close when Round 2: Rescue starts (00:15 IST). Founders can keep answering until crisis solutions lock at 01:45 IST. Everything on the board is public.</div>
 </>
}
