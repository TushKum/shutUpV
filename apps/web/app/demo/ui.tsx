"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import type {ReactNode} from "react";

export type DemoTrack="PRODUCT"|"CONSULTING"|"FINANCE";

function applyQueryIdentityOnce(){
  if(typeof window==="undefined")return;
  try{
    const params=new URLSearchParams(window.location.search);
    const asTrack=params.get("asTrack")?.toUpperCase();
    const asCode=params.get("asCode")?.trim().toUpperCase();
    let changed=false;
    if(asTrack==="PRODUCT"||asTrack==="CONSULTING"||asTrack==="FINANCE"){
      sessionStorage.setItem("primus-track-v2",asTrack);
      changed=true;
    }
    if(asCode){
      sessionStorage.setItem("primus-code-v2",asCode);
      changed=true;
    }
    if(changed){
      params.delete("asTrack");
      params.delete("asCode");
      const cleanSearch=params.toString();
      const nextUrl=`${window.location.pathname}${cleanSearch?`?${cleanSearch}`:""}${window.location.hash}`;
      window.history.replaceState(null,"",nextUrl);
    }
  }catch{}
}

export function switchDemoIdentity(nextTrack:DemoTrack,nextCode?:string){
  if(typeof window==="undefined")return;
  const resolvedCode=(nextCode||(nextTrack==="PRODUCT"?"XP01":nextTrack==="FINANCE"?"XF01":"XC01")).trim().toUpperCase();
  sessionStorage.setItem("primus-track-v2",nextTrack);
  sessionStorage.setItem("primus-code-v2",resolvedCode);
  window.dispatchEvent(new Event("primus-track-change"));
}

export function useDemoTrack():[DemoTrack,(t:DemoTrack)=>void]{
  const [track,setTrackState]=useState<DemoTrack>("CONSULTING");
  useEffect(()=>{
    applyQueryIdentityOnce();
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
    applyQueryIdentityOnce();
    const read=()=>{
      const saved=sessionStorage.getItem("primus-code-v2");
      const activeTrack=(sessionStorage.getItem("primus-track-v2") as DemoTrack|null)||track;
      const defaultForTrack=activeTrack==="PRODUCT"?"XP01":activeTrack==="FINANCE"?"XF01":"XC01";
      if(saved && ((activeTrack==="PRODUCT"&&saved.startsWith("XP"))||(activeTrack==="CONSULTING"&&saved.startsWith("XC"))||(activeTrack==="FINANCE"&&saved.startsWith("XF")))){
        setCode(saved);
      }else if(saved && saved!=="XC01" && saved!=="XP01" && saved!=="XF01"){
        setCode(saved);
      }else{
        setCode(defaultForTrack);
      }
    };
    read();
    window.addEventListener("primus-track-change",read);
    return()=>window.removeEventListener("primus-track-change",read);
  },[track]);
  return code;
}

export function Eyebrow({children}:{children:ReactNode}){return <div className="demo-eyebrow">{children}</div>}
export function PageTitle({eyebrow,title,sub}:{eyebrow:string,title:string,sub:string}){return <div className="guide-page-head"><small>{eyebrow}</small><h1>{title}</h1><p>{sub}</p></div>}
export function Panel({title,tag,children}:{title:string,tag?:string,children:ReactNode}){return <section className="guide-panel"><div className="guide-panel-head"><h2>{title}</h2>{tag&&<span>{tag}</span>}</div><div className="guide-panel-body">{children}</div></section>}
export function Metric({label,value,delta}:{label:string,value:string,delta:string}){return <div className="guide-metric"><small>{label}</small><b>{value}</b><span>{delta}</span></div>}
export function Table({headers,rows}:{headers:string[],rows:string[][]}){return <div className="overflow-x-auto"><table className="guide-table"><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{j===0?<strong>{c}</strong>:c}</td>)}</tr>)}</tbody></table></div>}
export function Action({href,children}:{href:string,children:ReactNode}){return <Link href={href} className="guide-btn">{children}<span>↗</span></Link>}
