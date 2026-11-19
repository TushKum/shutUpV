"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { MatrixRain } from "@/components/ui/matrix/matrix-rain";
import { switchDemoIdentity, useDemoTrack, useTeamCode } from "./ui";
import { useCoordination } from "./coordination-store";
import {
  getConsultingR2Lock,
  getConsultingR3Lock,
  getFinancePortfolio,
  getFinanceTeam,
  getOrMakeConsultant,
  getOrMakeProduct,
  getProductAvailableCash,
  getProductEquityRetainedPct,
  getProductR2Lock,
  getProductR3Lock,
} from "./coordination-types";
import "./demo.css";
import "./header-links.css";
import { EventNewsTicker } from "./event-news-ticker";
import { FINANCE_ROUTES } from "./finance/_desk/routes";

const financeItem = ["07", "Finance Desk", FINANCE_ROUTES.overview];
const headerLinks = [
  { href: "/demo/leaderboard", label: "Leaderboard" },
  { href: "/demo/newsroom", label: "News" },
  { href: "/demo/judging", label: "How judging works" },
] as const;
const baseNav = [["01", "Home", "/demo/dashboard"], ["02", "Round 1: Capital", "/demo/build"], ["03", "Round 2: MVP Deals", "/demo/rescue"], ["04", "Q&A", "/demo/qa"], ["05", "Market", "/demo/market"], ["06", "Trade", FINANCE_ROUTES.markets], financeItem];
const productNav = [["01", "Home", "/demo/dashboard"], ["02", "Round 1: Idea & MVP", "/demo/build"], ["03", "Round 2: Crisis & Hire", "/demo/rescue"], ["04", "Q&A", "/demo/qa"], ["05", "Market", "/demo/market"], ["06", "Round 3: Draft & New MVP", "/demo/trade"]];
const consultingNav = [["01", "Home", "/demo/dashboard"], ["02", "Round 1: Crisis", "/demo/build"], ["03", "Round 2: Rescue", "/demo/rescue"], ["04", "Q&A", "/demo/qa"], ["05", "Market", "/demo/market"], ["06", "Round 3: Auction & Crisis", "/demo/trade"]];

const baseTasks: [string, string, string, string][] = [["/demo/build", "Review your Round 1 allocated fund capital & sector focus", "23:00 IST", "/demo/build"], ["/demo/rescue", "Inspect Product team MVPs, evaluate Shares & Equity % offers (auto-calc $), and close deals", "01:45 IST", "/demo/rescue"], ["/demo/qa", "Review due-diligence Q&A before backing companies", "00:15 IST", "/demo/qa"], ["/demo/trade/event", "Place or manage your event orders", "04:30 IST", "/demo/trade/event"], ["/demo/market", "Review company prices and trends", "02:45 IST", "/demo/market"]];
const productTasks: [string, string, string, string][] = [["/demo/build", "Pitch your startup idea and submit your MVP for your assigned sector", "23:00 IST", "/demo/build"], ["/demo/rescue", "Offer Shares & Equity % to Finance teams (auto-calc $), lock a Consultant 1:1 in equity, and update your MVP", "01:45 IST", "/demo/rescue"], ["/demo/qa", "Answer due-diligence questions from consulting teams on the Q&A board", "00:15 IST", "/demo/qa"], ["/demo/trade", "Keep or re-bid consultant equity deal, pick 1 Problem Statement (least-money order), and build a new MVP", "04:30 IST", "/demo/trade"], ["/demo/market", "Review share prices and sector valuations", "02:45 IST", "/demo/market"]];
const consultingTasks: [string, string, string, string][] = [["/demo/build", "Solve the Round 1 crisis case and submit your solution", "23:00 IST", "/demo/build"], ["/demo/rescue", "Negotiate Shares & Equity % (auto-calc $), mutually lock 1-to-1, and solve Round 2 client crisis", "01:45 IST", "/demo/rescue"], ["/demo/qa", "Ask client founders questions on the crisis Q&A board", "00:15 IST", "/demo/qa"], ["/demo/trade", "Ask for extra Round 3 Shares & Equity % (or enter open equity auction) and solve allotted Product crisis", "04:30 IST", "/demo/trade"], ["/demo/market", "Review company prices and crisis impacts", "02:45 IST", "/demo/market"]];

export default function DemoLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [track] = useDemoTrack();
  const code = useTeamCode();
  const { state, reset } = useCoordination();

  const isConsulting = track === "CONSULTING";
  const isProduct = track === "PRODUCT";
  const isFinance = track === "FINANCE";
  const nav = isConsulting ? consultingNav : isProduct ? productNav : baseNav;
  const activePath = isFinance
    ? (pathname === "/demo/trade/event" ? FINANCE_ROUTES.markets
      : pathname !== FINANCE_ROUTES.markets && pathname.startsWith(`${FINANCE_ROUTES.overview}/`) ? FINANCE_ROUTES.overview : pathname)
    : pathname;
  const tasks = isConsulting ? consultingTasks : isProduct ? productTasks : baseTasks;
  const rainTone = isConsulting ? "blue" : isProduct ? "amber" : "green";

  if (pathname === "/demo/login" || pathname === "/demo/welcome" || pathname === "/demo/display") return <>{children}</>;
  if (pathname === "/demo/admin") return <div className="guide-app"><div className="guide-atmosphere" /><MatrixRain opacity={0.28} size={15} className="demo-matrix-rain-fixed" /><div className="guide-main" style={{ width: "100%", margin: 0 }}><header className="guide-top"><div className="guide-top-left"><span className="guide-team-code">PRIMUS ’26</span><b className="guide-phase">ORGANISER CONSOLE</b><span>LOCAL PREVIEW</span></div><div className="guide-top-right"><Link href="/demo/dashboard">PARTICIPANT VIEW ↗</Link><Link href="/demo/display">PROJECTOR ↗</Link><Link href="/demo/login">EXIT ↗</Link></div></header><div className="guide-preview-note">ORGANISER ENVIRONMENT · SAMPLE EVENT DATA · NO SERVER ACTIONS</div><main className="guide-content">{children}</main><footer className="guide-footer"><span>PRIMUS ’26 · ORGANISER OPERATIONS</span><span>LOCAL FRONTEND PREVIEW</span></footer></div></div>;

  const task = tasks.find(t => t[0] === pathname) || (isConsulting || isProduct ? tasks[0] : tasks[1]);
  const phaseLabel = isConsulting
    ? (pathname === "/demo/build" ? "ROUND 1 · CRISIS" : pathname === "/demo/trade" ? "ROUND 3 · AUCTION & CRISIS" : "ROUND 2 · RESCUE")
    : isProduct
      ? (pathname === "/demo/build" ? "ROUND 1 · IDEA & MVP" : pathname === "/demo/rescue" ? "ROUND 2 · CRISIS & HIRE" : "ROUND 3 · DRAFT & NEW MVP")
      : (pathname === "/demo/build" ? "ROUND 1 · CAPITAL" : pathname.startsWith("/demo/finance") ? "ROUND 3 · FINANCE DESK" : "ROUND 2 · MVP DEALS");

  // Live synced header figures & smart cross-track testing launchers
  const finCode = code.startsWith("XF") ? code : "XF01";
  const finTeam = isFinance ? getFinanceTeam(state, finCode) : null;
  const finPortfolio = isFinance ? getFinancePortfolio(state, finCode) : [];
  const finTotalShares = finPortfolio.reduce((sum, d) => sum + d.sharesAcquired, 0);

  const teamLabel = isFinance ? (finTeam?.name ?? "Vanguard Capital") : `Team ${code}`;
  const displayCode = isFinance ? finCode : code;

  const prodState = isProduct ? getOrMakeProduct(state, code) : null;
  const consState = isConsulting ? getOrMakeConsultant(state, code) : null;
  const prodR2Lock = isProduct ? getProductR2Lock(state, code) : null;
  const prodR3Lock = isProduct ? getProductR3Lock(state, code) : null;
  const consR2Lock = isConsulting ? getConsultingR2Lock(state, code) : null;
  const consR3Lock = isConsulting ? getConsultingR3Lock(state, code) : null;

  const prodEquityRetained = isProduct ? getProductEquityRetainedPct(state, code) : 100;
  const consEq = consR3Lock?.finalEquityPct ?? consR2Lock?.currentEquityPct ?? consState?.baseEquityPct ?? 3.5;
  const consCalcPrice = consR3Lock?.finalPrice ?? consR2Lock?.currentPrice ?? consState?.baseValue ?? 41300;

  const liveCashDisplay = isConsulting
    ? `${consEq}% · $${(consCalcPrice / 1000).toFixed(1)}k`
    : isProduct
      ? `$${getProductAvailableCash(state, code).toLocaleString()}`
      : `$${(finTeam?.availableCapital ?? 500000).toLocaleString()}`;

  const livePartnerDisplay = isConsulting
    ? (consR3Lock?.productCode ?? consR2Lock?.productCode ?? "OPEN")
    : isProduct
      ? (prodR3Lock?.consultingCode ?? prodR2Lock?.consultingCode ?? "OPEN")
      : `${finPortfolio.length} DEALS`;

  const syncTargetRoute = pathname.startsWith("/demo/finance") ? "/demo/rescue" : pathname;
  const prodTargetCode = isConsulting ? (consR3Lock?.productCode ?? consR2Lock?.productCode ?? "XP01") : "XP01";
  const consTargetCode = isProduct ? (prodR3Lock?.consultingCode ?? prodR2Lock?.consultingCode ?? "XC01") : "XC01";

  return (
    <div className="guide-app" data-track={track}>
      <div className="guide-atmosphere" />
      {(isConsulting || isProduct) && <MatrixRain opacity={0.28} size={15} tone={rainTone} className="demo-matrix-rain-fixed" />}
      <aside className="guide-sidebar">
        <Link href="/demo/dashboard" className="guide-brand">
          <img src="/primus-logo-light.svg" alt="PRIMUS" />
          <span><b>PRIMUS <i>’26</i></b><small>MATRIX NETWORK</small></span>
        </Link>
        <div className="guide-nav-label">
          {isConsulting ? "CONSULTING WORKSPACE" : isProduct ? "PRODUCT WORKSPACE" : "FINANCE WORKSPACE"} <b>///</b>
        </div>
        <nav>
          {nav.map(([n, label, href]) => (
            <Link key={href} href={href} aria-current={activePath === href ? "page" : undefined} className={activePath === href ? "active" : ""}>
              <small>{n}</small><span>{label}</span><i>↗</i>
            </Link>
          ))}
        </nav>
        <div className="guide-sidebar-bottom">
          <div className="guide-online"><i /> CONNECTION LIVE <span>· SYNC v{state.version}</span></div>
          <div className="guide-team">
            <div className="guide-avatar">{displayCode.slice(0, 2)}</div>
            <div><b>{teamLabel}</b><small>TEAM {displayCode} · {track}</small></div>
          </div>
          <Link href="/demo/admin">↗ Organiser preview</Link>
          <Link href="/demo/display">↗ Projector display</Link>
          <Link href="/demo/login">← Sign out</Link>
        </div>
      </aside>
      <div className="guide-main guide-participant-main">
        <header className="guide-top">
          <div className="guide-top-left">
            <span className="guide-team-code">{displayCode}</span>
            <span>{teamLabel}</span>
            <b className="guide-phase">{phaseLabel}</b>
            <span className="guide-countdown">01:24:36 LEFT</span>
          </div>
          <nav className="guide-header-links" aria-label="Event information">
            {headerLinks.map(({ href, label }) => (
              <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>
            ))}
          </nav>
          <div className="guide-top-right">
            <span className="guide-trading">
              <i /> {isConsulting ? "CONSULTING DESK" : isProduct ? "PRODUCT DESK" : "FINANCE DESK"}
            </span>
            <span className="guide-cash">
              {isConsulting ? "EQUITY" : isProduct ? "CASH" : "CAPITAL"} <b>{liveCashDisplay}</b>
            </span>
            <span className="guide-ticker">
              {isConsulting ? "TEAM" : isProduct ? "EQUITY" : "SHARES"}{" "}
              <b>
                {isConsulting
                  ? code
                  : isProduct
                    ? `${prodState?.ticker ?? "QAAC"} · ${prodEquityRetained}%`
                    : `${finTotalShares.toLocaleString()} sh`}
              </b>
            </span>
            <span className="guide-ticker">
              {isConsulting ? "CLIENT" : isProduct ? "CONSULTANT" : "PORTFOLIO"} <b>{livePartnerDisplay}</b>
            </span>
            <button type="button" onClick={() => window.alert("Sound alerts are simulated in this local preview.")}>◖ SOUND OFF</button>
          </div>
        </header>
        <div className="guide-taskbar">
          <span>DO THIS NOW</span>
          <b>{task[1]}</b>
          <small>DEADLINE {task[2]}</small>
          <Link href={task[3]}>OPEN TASK →</Link>
        </div>
        <div className="guide-preview-note flex flex-wrap items-center justify-between gap-2">
          <span>
            ● LIVE 3-TRACK SHARES &amp; EQUITY COORDINATION (SYNC v{state.version}) · {track} TEAM {displayCode}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {!isProduct && (
              <>
                <a
                  href={`${syncTargetRoute}?asTrack=PRODUCT&asCode=${prodTargetCode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:opacity-100"
                >
                  OPEN PRODUCT ({prodTargetCode}) TAB ↗
                </a>
                <span>·</span>
              </>
            )}
            {!isFinance && (
              <>
                <a
                  href={`${syncTargetRoute}?asTrack=FINANCE&asCode=XF01`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:opacity-100"
                >
                  OPEN FINANCE (XF01) TAB ↗
                </a>
                <span>·</span>
              </>
            )}
            {!isConsulting && (
              <>
                <a
                  href={`${syncTargetRoute}?asTrack=CONSULTING&asCode=${consTargetCode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:opacity-100"
                >
                  OPEN CONSULTING ({consTargetCode}) TAB ↗
                </a>
                <span>·</span>
              </>
            )}
            <button
              type="button"
              className="underline hover:opacity-100"
              onClick={() =>
                switchDemoIdentity(
                  isProduct ? "FINANCE" : isFinance ? "CONSULTING" : "PRODUCT",
                  isProduct ? "XF01" : isFinance ? consTargetCode : prodTargetCode
                )
              }
            >
              ⇄ SWITCH TRACK
            </button>
            <span>·</span>
            <button
              type="button"
              className="underline hover:opacity-100"
              onClick={() => {
                if (window.confirm("Reset all live Product ⇄ Finance ⇄ Consulting share deals, locks, drafts and Q&A?")) {
                  reset();
                }
              }}
            >
              ↺ RESET LIVE SYNC
            </button>
          </span>
        </div>
        <main className="guide-content">{children}</main>
        <div className="guide-footer">
          <span>PRIMUS ’26 · WHERE EVERY DECISION CONNECTS</span>
          <span>FRONTEND ARCHITECTURE PREVIEW · IST</span>
        </div>
        <footer className="guide-desk-footer">
          <EventNewsTicker />
          <nav className="guide-mobile-nav">
            {(isConsulting || isProduct ? nav.slice(0, 5) : [...nav.slice(0, 5), financeItem]).map(([n, label, href]) => (
              <Link key={href} href={href}><small>{n}</small>{label.replace("Round ", "R")}</Link>
            ))}
          </nav>
        </footer>
      </div>
    </div>
  );
}
