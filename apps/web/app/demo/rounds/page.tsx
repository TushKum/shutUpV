"use client";
import Link from "next/link";
import {PageTitle,Panel,useDemoTrack} from "../ui";
const baseRounds=[["01","Build","21:15–23:00","Problem card, company name, four-letter ticker and PRD up to 800 words.","/demo/build"],["02","Rescue","00:15–01:45","Rescue another team's company. Public Q&A, crisis solution up to 500 words.","/demo/rescue"],["03","Invest","02:15–04:30","Nine 15-minute trading rounds. $100,000 starting cash; buy and sell shares.","/demo/trade/event"]];
const productRounds=[
 ["01","Idea & MVP","21:15–23:00","Assigned 1 of 3 sectors (FMCG, FinTech, HealthTech). Pitch your startup idea and submit your complete MVP.","/demo/build"],
 ["02","Raise, Crisis & Update MVP","23:45–01:45","Start with $0 cash. Broadcast an overall equity raise to all Finance teams, lock a 1:1 Consulting team, and write their crisis solution into your MVP.","/demo/rescue"],
 ["03","Re-Bid, Least-Money Draft & New MVP","02:15–04:30","Accept your consultant's increase or remove for re-bid (can return if needed). Pick 1 locked Problem Statement in least-money-first order, send it to your consultant, and build another MVP.","/demo/trade"]
];
const consultingRounds=[
 ["01","Crisis & Valuation","21:15–23:00","Your team code (e.g. XC01) is pre-assigned. Solve the Round 1 crisis and submit your solution; your evaluation sets your consultancy's base valuation.","/demo/build"],
 ["02","1:1 Lock & Shared Crisis","23:45–01:45","Multiple Product teams offer deals. Increase your demand, push the deal, and once both teams accept a Lock Request (strictly 1:1), solve that Product team's topic crisis together.","/demo/rescue"],
 ["03","Price Increase, Auction & Crisis","02:15–04:30","Stay on base price or ask your Round 2 Product team for a price increase (settled after Round 3 if accepted). If not accepted, you are unlocked back into the open auction—once allotted 1:1, solve that Product team's Round 3 crisis.","/demo/trade"]
];
export default function Rounds(){
 const [track]=useDemoTrack();
 const isConsulting=track==="CONSULTING";
 const isProduct=track==="PRODUCT";
 const rounds=isConsulting?consultingRounds:isProduct?productRounds:baseRounds;
 return <>
  <PageTitle eyebrow={`COMPETITION STRUCTURE / ${track} TRACK`} title="The night in three rounds." sub={isConsulting?"Solve the opening crisis in Round 1 to earn your consultancy valuation, negotiate and mutually lock 1-to-1 with a Product team in Round 2 to solve their topic's crisis, then renew or re-enter the auction in Round 3.":"Build a company, rescue another team's company, then invest across the market. Each round contributes up to 100 points to the 300-point total."}/>
  <div className="guide-grid three">{rounds.map(r=><Panel key={r[0]} title={"ROUND "+r[0]+" · "+r[1]} tag={r[2]}><p className="guide-muted">{r[3]}</p><Link href={r[4]} className="mt-4 inline-block text-xs text-[#39ff88]">Open round →</Link></Panel>)}</div>
  <div className="guide-alert mt-4">{isConsulting?"Each sector (Product, Consulting, Finance) plays three rounds tailored to its role. For Consulting: Round 1 establishes your valuation, Round 2 locks 1-to-1 with a Product team, and Round 3 renews or auctions your 1-to-1 allotment.":"Total score = Round 1 + Round 2 + Round 3 points (out of 300). Ties go to the higher Round 2 score, then Round 1 score, then exact Round 3 return."}</div>
 </>
}
