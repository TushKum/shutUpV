"use client";
import Image from "next/image";
import Link from "next/link";
import {useEffect,useState} from "react";
import {MatrixRain} from "@/components/ui/matrix/matrix-rain";
export default function Welcome(){
 const [code,setCode]=useState("XC01");
 const [role,setRole]=useState("TEAM");
 const [track,setTrack]=useState("CONSULTING");
 useEffect(()=>{
  setCode(sessionStorage.getItem("primus-code-v2")||"XC01");
  setRole(sessionStorage.getItem("primus-preview-role")||"TEAM");
  setTrack(sessionStorage.getItem("primus-track-v2")||"CONSULTING");
 },[]);
 const href=role==="ORGANISER"?"/demo/admin":track==="FINANCE"?"/demo/dashboard":"/demo/build";
 return <main className="demo-login demo-entry" data-track={track}><MatrixRain opacity={0.44} size={15} tone={track==="CONSULTING"?"blue":track==="PRODUCT"?"amber":"green"} className="demo-matrix-rain"/><div className="demo-login-grid"/><div className="demo-login-glow"/><div className="demo-login-content text-center"><div className="demo-glitch-content mx-auto"><div className="demo-glitch-logo"><Image src="/primus-logo-light.svg" alt="PRIMUS" width={430} height={160} priority/><Image src="/primus-logo-light.svg" alt="" width={430} height={160}/><Image src="/primus-logo-light.svg" alt="" width={430} height={160}/></div><div className="demo-glitch-rule"/></div><div className="mt-9 font-mono text-[9px] tracking-[.25em] text-[#96b3d9]">ACCESS GRANTED <span className="text-[#39ff88]">///</span> {track==="FINANCE"?code:`TEAM ${code} · ${track}`}</div><h1 className="mt-4 text-3xl font-semibold tracking-tight text-[#eef6ff] md:text-5xl">The night is yours.</h1><p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[#96b2d6]">{role==="ORGANISER"?"Your organiser access node is connected. The event is yours to run.":track==="PRODUCT"?`Signed in as Product Team ${code}. Enter Round 1 to receive your sector, pitch your idea and build your MVP.`:track==="CONSULTING"?`Signed in as Consulting Team ${code}. Enter Round 1 to read the crisis and submit your solution.`:"Your team is connected to the PRIMUS network. Make every decision count."}</p><Link href={href} className="demo-login-primary mx-auto mt-8 w-fit min-w-[240px]"><span><small>{role==="ORGANISER"?"ORGANISER CONSOLE":track==="FINANCE"?"TEAM WORKSPACE":`TEAM ${code} · ${track}`}</small><b>{role==="ORGANISER"?"ENTER CONTROL ROOM":track==="PRODUCT"?"ENTER ROUND 1: IDEA & MVP":track==="CONSULTING"?"ENTER ROUND 1 CRISIS":"ENTER THE NIGHT"}</b></span><i>→</i></Link></div></main>
}
