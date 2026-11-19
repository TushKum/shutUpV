"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import type {ReactNode} from "react";
export type DemoTrack="PRODUCT"|"CONSULTING"|"FINANCE";
export function useDemoTrack():[DemoTrack,(t:DemoTrack)=>void]{
  const [track,setTrackState]=useState<DemoTrack>("CONSULTING");
  useEffect(()=>{
    const read=()=>{
      const saved=sessionStorage.getItem("primus-track-v2");
      if(saved==="PRODUCT"||saved==="CONSULTING"||saved==="FINANCE")setTrackState(saved);
      else setTrackState("CONSULTING");
    };
    read();
    window.addEventListener("primus-track-change",read);
    return()=>window.removeEventListener("primus-track-change",read);
  },[]);
  const setTrack=(t:DemoTrack)=>{
    sessionStorage.setItem("primus-track-v2",t);
    setTrackState(t);
    window.dispatchEvent(new Event("primus-track-change"));
  };
  return [track,setTrack];
}
export function useTeamCode():string{
  const [track]=useDemoTrack();
  const [code,setCode]=useState("XC01");
  useEffect(()=>{
    const saved=sessionStorage.getItem("primus-code-v2");
    const defaultForTrack=track==="PRODUCT"?"XP01":track==="FINANCE"?"XF01":"XC01";
    if(saved && saved!=="XC01" && saved!=="XP01" && saved!=="XF01"){
      setCode(saved);
    }else if(saved && ((track==="PRODUCT"&&saved.startsWith("XP"))||(track==="CONSULTING"&&saved.startsWith("XC"))||(track==="FINANCE"&&saved.startsWith("XF")))){
      setCode(saved);
    }else{
      setCode(defaultForTrack);
    }
  },[track]);
  return code;
}
export function Eyebrow({children}:{children:ReactNode}){return <div className="demo-eyebrow">{children}</div>}
export function PageTitle({eyebrow,title,sub}:{eyebrow:string,title:string,sub:string}){return <div className="guide-page-head"><small>{eyebrow}</small><h1>{title}</h1><p>{sub}</p></div>}
export function Panel({title,tag,children}:{title:string,tag?:string,children:ReactNode}){return <section className="guide-panel"><div className="guide-panel-head"><h2>{title}</h2>{tag&&<span>{tag}</span>}</div><div className="guide-panel-body">{children}</div></section>}
export function Metric({label,value,delta}:{label:string,value:string,delta:string}){return <div className="guide-metric"><small>{label}</small><b>{value}</b><span>{delta}</span></div>}
export function Table({headers,rows}:{headers:string[],rows:string[][]}){return <div className="overflow-x-auto"><table className="guide-table"><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{j===0?<strong>{c}</strong>:c}</td>)}</tr>)}</tbody></table></div>}
export function Action({href,children}:{href:string,children:ReactNode}){return <Link href={href} className="guide-btn">{children}<span>↗</span></Link>}
