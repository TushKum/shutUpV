"use client";
import {useMemo,useState} from "react";
import {PageTitle,Panel,useDemoTrack,useTeamCode} from "../ui";
import {
  EmptyFilterState,
  INITIAL_LIST_FILTER,
  ListFilterBar,
  type ListFilterState,
} from "../list-filter-bar";
import {useCoordination} from "../coordination-store";
import {getConsultingR2Lock,getOrMakeProduct} from "../coordination-types";

export default function QA(){
  const [track]=useDemoTrack();
  const code=useTeamCode();
  const {state,dispatch}=useCoordination();

  const isConsulting=track==="CONSULTING";
  const isProduct=track==="PRODUCT";

  const items=state.qaItems;
  const products=useMemo(
    ()=>state.productOrder.map(c=>state.products[c]!).filter(Boolean),
    [state.productOrder,state.products]
  );

  const lockedR2=useMemo(
    ()=>isConsulting?getConsultingR2Lock(state,code):null,
    [isConsulting,state,code]
  );

  const defaultTarget=useMemo(()=>{
    if(lockedR2){
      const p=getOrMakeProduct(state,lockedR2.productCode);
      return `${p.code} · ${p.company}`;
    }
    const xp01=getOrMakeProduct(state,"XP01");
    return `${xp01.code} · ${xp01.company}`;
  },[lockedR2,state]);

  const [targetCompany,setTargetCompany]=useState<string>("");
  const [question,setQuestion]=useState("");
  const [selectedQuestionId,setSelectedQuestionId]=useState<number|null>(null);
  const [answer,setAnswer]=useState("");
  const [boardFilter,setBoardFilter]=useState<ListFilterState>(INITIAL_LIST_FILTER);

  const resolvedTarget=targetCompany||defaultTarget;

  // Unanswered questions bubble to top for Founders' Inbox
  const inboxQuestions=useMemo(()=>{
    return [...items].sort((a,b)=>{
      const ua=a.a===null?1:0;
      const ub=b.a===null?1:0;
      if(ua!==ub)return ub-ua;
      return b.id-a.id;
    });
  },[items]);

  const activeInboxItem=useMemo(()=>{
    if(selectedQuestionId!==null){
      const found=inboxQuestions.find(q=>q.id===selectedQuestionId);
      if(found)return found;
    }
    return inboxQuestions[0]??null;
  },[inboxQuestions,selectedQuestionId]);

  const unansweredCount=useMemo(()=>items.filter(i=>i.a===null).length,[items]);

  const teamOptions=useMemo(()=>{
    const counts=new Map<string,number>();
    for(const item of items){
      counts.set(item.team,(counts.get(item.team)??0)+1);
    }
    return Array.from(counts.entries())
      .sort((a,b)=>a[0].localeCompare(b[0]))
      .map(([tCode,n])=>({code:tCode,label:`${tCode} (${n} ${n===1?"question":"questions"})`}));
  },[items]);

  const filteredItems=useMemo(()=>{
    const list=items.filter(item=>boardFilter.teamCode==="ALL"||item.team===boardFilter.teamCode);
    if(boardFilter.sortBy==="OLDEST")return [...list].sort((a,b)=>a.id-b.id);
    if(boardFilter.sortBy==="UNANSWERED")return [...list].sort((a,b)=>(a.a===null?0:1)-(b.a===null?0:1));
    if(boardFilter.sortBy==="CODE_ASC")return [...list].sort((a,b)=>a.team.localeCompare(b.team));
    return list;
  },[items,boardFilter]);

  const handlePostQuestion=()=>{
    if(!question.trim())return;
    const posterCode=track==="FINANCE"?(code.startsWith("XF")?code:"XF01"):code;
    dispatch({
      type:"QA_POST_QUESTION",
      team:posterCode,
      targetCompany:resolvedTarget,
      q:question,
    });
    setQuestion("");
  };

  const handlePublishAnswer=()=>{
    if(!activeInboxItem||!answer.trim())return;
    const responderCode=track==="FINANCE"?(code.startsWith("XF")?code:"XF01"):code;
    dispatch({
      type:"QA_ANSWER_QUESTION",
      questionId:activeInboxItem.id,
      answeredBy:responderCode,
      a:answer,
    });
    setAnswer("");
  };

  return <>
    <PageTitle
      eyebrow={isConsulting?"CLIENT DUE DILIGENCE / LIVE CRISIS Q&A BOARD":isProduct?"PRODUCT FOUNDERS / LIVE CRISIS Q&A BOARD":"PUBLIC BOARD / CRISIS WINDOW"}
      title={isConsulting?"Client crisis Q&A board.":"Q&A board."}
      sub={isConsulting?"Ask Product founders live due-diligence questions to back your unit-economics and turnaround recommendation. Questions land immediately in the Product team's Founders' Inbox and answers stream back live here.":"Answer incoming due-diligence questions from Consulting teams in real time or ask questions on the shared public board."}
    />
    <div className="guide-grid two">
      <Panel title={isConsulting?`Question client founders (${resolvedTarget})`:"Post a question to founders"} tag="LIVE SYNC · MAX 300 CHARS">
        <p className="guide-muted">
          {isConsulting
            ?"Select a Product team below and ask specific operational or cost questions. They receive your question live in their Founders' Inbox."
            :"Select a Product company to post a public due-diligence question visible to every team."}
        </p>
        <label htmlFor="qa-target-select" className="guide-label">TARGET PRODUCT COMPANY</label>
        <select
          id="qa-target-select"
          className="guide-select guide-filter-control font-mono"
          value={resolvedTarget}
          onChange={e=>setTargetCompany(e.target.value)}
        >
          {products.map(p=>{
            const label=`${p.code} · ${p.company}`;
            return <option key={p.code} value={label}>{label} ({p.ticker})</option>;
          })}
        </select>
        <textarea
          className="guide-textarea mt-3"
          maxLength={300}
          value={question}
          onChange={e=>setQuestion(e.target.value)}
          placeholder="Ask a question about the company, its product or the crisis…"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="guide-muted">{question.length} / 300 characters</span>
          <button type="button" className="guide-btn" disabled={!question.trim()} onClick={handlePostQuestion}>
            POST QUESTION LIVE →
          </button>
        </div>
      </Panel>

      <Panel
        title={isProduct?`Founders' inbox — Team ${code}`:"Founders' inbox (answer live questions)"}
        tag={unansweredCount>0?`⚡ ${unansweredCount} UNANSWERED LIVE`:"ALL ANSWERED"}
      >
        <p className="guide-muted">
          Pick any incoming question from a Consulting team below and publish an official answer—it updates instantaneously on the public Q&amp;A board for all teams.
        </p>
        <label htmlFor="qa-inbox-select" className="guide-label">SELECT QUESTION TO ANSWER</label>
        <select
          id="qa-inbox-select"
          className="guide-select guide-filter-control font-mono"
          value={activeInboxItem?.id??""}
          onChange={e=>setSelectedQuestionId(Number(e.target.value))}
        >
          {inboxQuestions.map(item=>(
            <option key={item.id} value={item.id}>
              {item.a===null?"⚡ UNANSWERED · ":"✓ "}Q#{item.id} from {item.team} ({item.targetCompany}): {item.q.slice(0,52)}{item.q.length>52?"…":""}
            </option>
          ))}
        </select>
        {activeInboxItem&&(
          <div className="guide-alert mt-3">
            <b>Q#{activeInboxItem.id} from {activeInboxItem.team} → {activeInboxItem.targetCompany}:</b>
            <br/>
            {activeInboxItem.q}
          </div>
        )}
        <textarea
          className="guide-textarea mt-3"
          maxLength={1000}
          value={answer}
          onChange={e=>setAnswer(e.target.value)}
          placeholder={activeInboxItem?`Write your official answer to Q#${activeInboxItem.id} from ${activeInboxItem.team}…`:"Select a question to answer…"}
        />
        <div className="mt-2 flex justify-between">
          <span className="guide-muted">{answer.trim().split(/\s+/).filter(Boolean).length} / 150 words</span>
          <button
            type="button"
            className="guide-btn"
            disabled={!activeInboxItem||!answer.trim()}
            onClick={handlePublishAnswer}
          >
            PUBLISH ANSWER LIVE →
          </button>
        </div>
      </Panel>
    </div>

    <div className="mt-4">
      <Panel title="The public board" tag={`LIVE SYNCED · ${items.length} QUESTIONS`}>
        <ListFilterBar
          value={boardFilter}
          onChange={setBoardFilter}
          teamOptions={teamOptions}
          teamLabel="TEAM CODE"
          allTeamsLabel="All Teams"
          showAmountFilter={false}
          sortOptions={[
            { value: "DEFAULT", label: "Newest Questions First" },
            { value: "UNANSWERED", label: "Unanswered First" },
            { value: "OLDEST", label: "Oldest Questions First" },
            { value: "CODE_ASC", label: "Team Code: A → Z" },
          ]}
          totalCount={items.length}
          filteredCount={filteredItems.length}
          itemNoun="questions"
        />
        {filteredItems.length===0?(
          <EmptyFilterState noun="questions" onReset={()=>setBoardFilter(INITIAL_LIST_FILTER)}/>
        ):(
          <div className="guide-scroll-box">
            {filteredItems.map(x=>(
              <article key={x.id} className="border-b border-[#294832] py-4 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`guide-chip ${x.a===null?"active":""}`}>{x.team}</span>
                    <span className="font-mono text-[10px] text-[#84a5d1]">→ {x.targetCompany}</span>
                  </div>
                  <span className="guide-muted">QUESTION #{x.id} · {x.createdAt}</span>
                </div>
                <p className="mt-3 text-sm">{x.q}</p>
                <div className="mt-3 border-l-2 border-[#39ff88] pl-3">
                  <span className="guide-status">
                    {x.a!==null?`FOUNDERS' ANSWER (${x.answeredBy??"FOUNDER"})`:"● AWAITING FOUNDERS' ANSWER"}
                  </span>
                  <p className="guide-muted mt-1">{x.a??"Waiting for Product founders to reply in Founders' Inbox above…"}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
    <div className="guide-alert mt-4">Live public Q&amp;A board: Consulting teams ask client founders questions and Product founders publish answers in real time across tabs and browsers.</div>
  </>;
}
