"use client";

import { useMemo, useState } from "react";
import { Activity, ArrowUpRight, Bell, BriefcaseBusiness, ChartNoAxesCombined, Clock3, Radio, Rocket, ShieldAlert, Sparkles, TrendingUp } from "lucide-react";

type Track = "PRODUCT" | "CONSULTING" | "FINANCE";
type Update = { id: string; time: string; type: "MILESTONE" | "SUBMISSION" | "MARKET" | "BULLETIN" | "ALERT"; title: string; detail: string; team: string; ticker?: string };

const TRACKS: { id: Track; label: string; sub: string; Icon: typeof Rocket; tone: string; updates: Update[] }[] = [
  { id: "PRODUCT", label: "PRODUCT", sub: "Build · Launch · Scale", Icon: Rocket, tone: "green", updates: [
    { id:"p1",time:"22:14:08",type:"MILESTONE",title:"Pitch submitted",detail:"A new venture pitch has entered the review queue.",team:"TEAM P-07",ticker:"NOVA"},
    { id:"p2",time:"22:11:42",type:"SUBMISSION",title:"Rescue plan uploaded",detail:"The team has submitted its response to the latest crisis.",team:"TEAM P-12",ticker:"VRTX"},
    { id:"p3",time:"22:08:19",type:"ALERT",title:"Crisis response window open",detail:"Product teams can now review the new scenario and prepare their response.",team:"SYSTEM"},
    { id:"p4",time:"22:02:51",type:"MILESTONE",title:"Company profile updated",detail:"A team has completed its company profile and ticker details.",team:"TEAM P-03",ticker:"HELI"},
    { id:"p5",time:"21:58:04",type:"SUBMISSION",title:"Business plan submitted",detail:"A business plan is ready for evaluation.",team:"TEAM P-09",ticker:"MINT"}
  ]},
  { id: "CONSULTING", label: "CONSULTING", sub: "Advise · Execute · Deliver", Icon: BriefcaseBusiness, tone: "cyan", updates: [
    { id:"c1",time:"22:13:26",type:"MILESTONE",title:"Client engagement opened",detail:"A consulting team has started a new company engagement.",team:"TEAM C-04"},
    { id:"c2",time:"22:09:13",type:"SUBMISSION",title:"Strategy memo submitted",detail:"The team's recommendation has been sent for review.",team:"TEAM C-11"},
    { id:"c3",time:"22:05:47",type:"ALERT",title:"New crisis brief released",detail:"Updated client information is available to consulting teams.",team:"SYSTEM"},
    { id:"c4",time:"22:01:02",type:"MILESTONE",title:"Deal confirmed",detail:"A company has accepted a consulting engagement.",team:"TEAM C-02"},
    { id:"c5",time:"21:54:39",type:"SUBMISSION",title:"Analysis delivered",detail:"A new analysis has been added to the evaluation queue.",team:"TEAM C-08"}
  ]},
  { id: "FINANCE", label: "FINANCE", sub: "Analyse · Invest · Trade", Icon: ChartNoAxesCombined, tone: "violet", updates: [
    { id:"f1",time:"22:14:51",type:"MARKET",title:"Market movement detected",detail:"Trading activity has moved a listed company's price.",team:"EXCHANGE",ticker:"NOVA"},
    { id:"f2",time:"22:10:32",type:"MILESTONE",title:"Trade executed",detail:"A fund order has been matched and recorded.",team:"TEAM F-06"},
    { id:"f3",time:"22:06:18",type:"MARKET",title:"Trading round cleared",detail:"The latest market prices have been calculated.",team:"EXCHANGE"},
    { id:"f4",time:"22:00:43",type:"ALERT",title:"Trading window is live",detail:"Funds can now submit orders for the current round.",team:"SYSTEM"},
    { id:"f5",time:"21:56:10",type:"MILESTONE",title:"Portfolio updated",detail:"A fund has changed its holdings.",team:"TEAM F-03"}
  ]}
];

const TYPE: Record<Update["type"], { label: string; Icon: typeof Activity }> = {
  MILESTONE: { label:"MILESTONE", Icon:Sparkles },
  SUBMISSION: { label:"SUBMISSION", Icon:ArrowUpRight },
  MARKET: { label:"MARKET", Icon:TrendingUp },
  BULLETIN: { label:"BULLETIN", Icon:Bell },
  ALERT: { label:"SYSTEM ALERT", Icon:ShieldAlert }
};

export function NewsroomView() {
  const [filter, setFilter] = useState<"ALL" | Update["type"]>("ALL");
  const all = useMemo(() => TRACKS.reduce((n,t) => n + t.updates.length, 0), []);
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <div className="flex flex-col gap-4 border-b border-[#1b2922] pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-bold tracking-[.24em] text-[#75ff9e]"><Radio className="size-3.5 animate-pulse"/> PRIMUS BROADCAST NETWORK <span className="text-[#53635a]">/ PUBLIC FEED</span></div>
          <h1 className="font-mono text-3xl font-bold tracking-tight text-[#f2f5f3] md:text-4xl">THE NEWSROOM<span className="text-[#00e676]">.</span></h1>
          <p className="mt-2 max-w-2xl text-sm text-[#87948d]">Live competition intelligence from all three tracks. Follow every milestone as the night unfolds.</p>
        </div>
        <div className="flex items-center gap-4 self-start md:self-auto">
          <div className="border border-[#285d46] bg-[#0c1510] px-3 py-2"><div className="flex items-center gap-2 text-[10px] font-mono tracking-widest text-[#75ff9e]"><i className="size-1.5 rounded-full bg-[#00e676] shadow-[0_0_8px_#00e676]"/> LIVE FEED</div><div className="mt-1 font-mono text-xl font-bold text-white">{String(all).padStart(2,"0")} <span className="text-[10px] font-normal text-[#87948d]">UPDATES</span></div></div>
          <div className="hidden border border-[#1b2922] bg-[#0c1110] px-3 py-2 sm:block"><div className="text-[10px] font-mono tracking-widest text-[#87948d]">EVENT STATUS</div><div className="mt-1 font-mono text-sm text-[#f2f5f3]">IN PROGRESS</div></div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" aria-label="Filter updates">
          {(["ALL","MILESTONE","SUBMISSION","MARKET","ALERT"] as const).map(x => <button key={x} onClick={()=>setFilter(x)} className={`border px-3 py-1.5 font-mono text-[10px] tracking-wider transition-colors ${filter===x?"border-[#00e676] bg-[#00e676]/10 text-[#75ff9e]":"border-[#1b2922] text-[#87948d] hover:border-[#285d46] hover:text-white"}`}>{x==="ALL"?"ALL UPDATES":x}</button>)}
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono tracking-wider text-[#68766e]"><Clock3 className="size-3.5"/> TIMESTAMPS · EVENT TIME</div>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        {TRACKS.map(({id,label,sub,Icon,tone,updates}) => {
          const visible = updates.filter(u => filter==="ALL" || u.type===filter);
          return <section key={id} className="min-w-0 overflow-hidden border border-[#1b2922] bg-[#090e0c]" aria-label={label+" live updates"}>
            <header className="flex items-center justify-between border-b border-[#1b2922] bg-[#0e1511] px-4 py-4">
              <div className="flex items-center gap-3"><div className={`grid size-9 place-items-center border ${tone==="green"?"border-[#285d46] bg-[#00e676]/10 text-[#75ff9e]":tone==="cyan"?"border-cyan-900 bg-cyan-400/10 text-cyan-300":"border-violet-900 bg-violet-400/10 text-violet-300"}`}><Icon className="size-4"/></div><div><h2 className="font-mono text-sm font-bold tracking-widest text-white">{label}</h2><p className="mt-0.5 text-[10px] text-[#87948d]">{sub}</p></div></div>
              <span className="font-mono text-xs text-[#87948d]">{String(visible.length).padStart(2,"0")} <span className="text-[9px]">ITEMS</span></span>
            </header>
            <div className="min-h-[460px]">
              {visible.length===0 ? <p className="p-5 text-xs text-[#68766e]">No updates in this category.</p> : visible.map((u,i) => {const meta=TYPE[u.type];const ItemIcon=meta.Icon;return <article key={u.id} className="relative border-b border-[#17231c] px-4 py-4 last:border-0 hover:bg-[#0d1510]"><div className="mb-2 flex items-center justify-between gap-2"><span className={`inline-flex items-center gap-1.5 font-mono text-[9px] tracking-widest ${u.type==="ALERT"?"text-amber-300":u.type==="MARKET"?"text-violet-300":"text-[#75ff9e]"}`}><ItemIcon className="size-3"/>{meta.label}</span><time className="font-mono text-[10px] tabular-nums text-[#68766e]">{u.time}</time></div><h3 className="text-sm font-semibold leading-snug text-[#e7eee9]">{u.title}</h3><p className="mt-1.5 text-xs leading-relaxed text-[#87948d]">{u.detail}</p><div className="mt-3 flex items-center justify-between gap-2"><span className="font-mono text-[10px] tracking-wider text-[#a4b2a9]">{u.team}</span>{u.ticker?<span className="border border-[#285d46] bg-[#0c1510] px-2 py-0.5 font-mono text-[10px] text-[#75ff9e]">{u.ticker}</span>:<span className="text-[9px] text-[#526057]">#{String(i+1).padStart(2,"0")}</span>}</div></article>})}
            </div>
            <footer className="border-t border-[#1b2922] bg-[#0b110e] px-4 py-2 text-[9px] font-mono tracking-widest text-[#627168]">END OF {label} TRANSMISSION</footer>
          </section>;
        })}
      </div>
      <p className="text-center font-mono text-[9px] tracking-[.18em] text-[#526057]">DEMO PREVIEW · SAMPLE ACTIVITY ONLY · LIVE EVENT DATA WILL APPEAR WHEN CONNECTED</p>
    </div>
  );
}
