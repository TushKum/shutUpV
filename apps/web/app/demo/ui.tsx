import Link from "next/link";
import type { ReactNode } from "react";
export function Eyebrow({children}:{children:ReactNode}){return <div className="demo-eyebrow">{children}</div>}
export function PageTitle({eyebrow,title,sub}:{eyebrow:string,title:string,sub:string}){return <div className="demo-page-title"><Eyebrow>{eyebrow}</Eyebrow><h1>{title}</h1><p>{sub}</p></div>}
export function Panel({title,tag,children}:{title:string,tag?:string,children:ReactNode}){return <section className="demo-panel"><div className="demo-panel-head"><h2>{title}</h2>{tag&&<span>{tag}</span>}</div><div className="demo-panel-body">{children}</div></section>}
export function Metric({label,value,delta}:{label:string,value:string,delta:string}){return <div className="demo-metric"><div className="demo-metric-label">{label}</div><div className="demo-metric-value">{value}</div><div className="demo-metric-delta"><i/> {delta}</div></div>}
export function Table({headers,rows}:{headers:string[],rows:string[][]}){return <div className="demo-table-wrap"><table className="demo-table"><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{j===0?<strong>{c}</strong>:c}</td>)}</tr>)}</tbody></table></div>}
export function Action({href,children}:{href:string,children:ReactNode}){return <Link href={href} className="demo-action">{children}<span>↗</span></Link>}
