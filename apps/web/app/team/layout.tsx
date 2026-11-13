import type { Metadata } from "next";
import Link from "next/link";
import { TRACK_LABELS, type Track } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import { clock, money } from "@/lib/format";
import { ClockProvider } from "@/lib/live/clock";
import { EventChannel } from "@/lib/live/channel";
import { SquadChannel } from "@/lib/live/squad-channel";
import { Heartbeat } from "@/lib/live/heartbeat";
import { FeedbackBar, FeedbackProvider } from "@/lib/live/feedback";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/ui";
import { Countdown, ServerClock } from "@/components/ui/countdown";
import { PORTAL_TITLES, portalAdmits, portalUrl, teamPortal, wrongPortalMessage } from "@/lib/portal/portal";
import { MarketStrip } from "./market-strip";
import { RealtimeDot } from "@/components/ui/realtime-dot";
import { TeamNav } from "./nav";
import { ActionBar } from "./action-bar";
import { Alerts, SoundToggle } from "./alerts";
import { loadPlanFacts } from "@/lib/team/home-data";
import { homePlan } from "@/lib/team/home";
import { crisisSteps } from "@/lib/team/crisis-steps";
import { alertTasks, nextAction } from "@/lib/team/alerts";
import { RoundBanner } from "./round-banner";
import { FocusGate } from "./focus-gate";
import { focusSections } from "@/lib/team/focus";
import { BootSequence } from "@/components/ui/matrix/boot-sequence";
import { Glyph } from "@/components/ui/matrix/glyph";
import { MatrixRain, type MatrixRainTint } from "../login/matrix-rain";
import "./team.css";

const TRACK_EMOJI: Record<Track, string> = { PRODUCT: "🏢", CONSULTING: "🧠", FINANCE: "💼" };
const TRACK_TINT: Record<Track, MatrixRainTint> = { PRODUCT: "green", CONSULTING: "blue", FINANCE: "yellow" };

export const metadata: Metadata = { title: { template: "%s · Team", default: "Team" } };

// Every team screen (laptop or phone): the team and its cash, a big banner with the round (1–3), the step of the night
// in plain words, the time left and the team's job, then only this round's sections (focus mode: pages of other
// rounds show a "not now" card), the "do this now" bar and the latest bulletin. The event's realtime channel refreshes the page on
// every broadcast, the squad's channel announces chat messages, and the heartbeat tells the control panel the screen
// is connected.
export default async function TeamLayout({ children }: LayoutProps<"/team">) {
  const ctx = await loadTeamContext();
  const { team, event, status } = ctx;
  // A track's portal shows only that track's pages: a team of another track (an old session) is sent to its own.
  const portal = await teamPortal();
  const tint = TRACK_TINT[team.track];
  if (portal && !portalAdmits(portal, team.track)) {
    return (
      <main className="term mx-team-shell flex min-h-dvh items-center justify-center px-4" data-track={team.track}>
        <MatrixRain opacity={0.42} tint={tint} />
        <div className="mx-team-atmosphere" aria-hidden="true" />
        <div className="mx-team-vignette" aria-hidden="true" />
        <div className="mx-panel relative z-10 max-w-md space-y-4 p-6" data-testid="wrong-portal">
          <p className="mx-team-brand-pill">PRIMUS</p>
          <p className="text-sm leading-relaxed text-slate-200">{wrongPortalMessage(portal, team.track, portalUrl(team.track))}</p>
          <SignOutButton />
        </div>
      </main>
    );
  }
  // The bar and the alerts are guidance: if the plan cannot be read (say, the database is older than the app), every
  // page still works, without them.
  const facts = await loadPlanFacts(ctx).catch((err: unknown) => {
    console.error("team layout: no plan for the bar and alerts:", err);
    return null;
  });
  const plan = facts ? homePlan(facts) : null;
  const next = plan ? nextAction(plan) : null;
  // A PRIMUS event's Rounds 2 and 3: the crisis under way and its steps, for the banner's "you are here" row.
  const k = facts?.primus?.k ?? null;
  const crisis =
    event.format === "PRIMUS" && facts && (status.phase === "PRESSURE" || status.phase === "SATURATION")
      ? {
          k,
          steps:
            k === null
              ? []
              : crisisSteps(team.track, k, Object.fromEntries(facts.deadlines.map((d) => [d.code, d.at])), k === 5 && (facts.primus?.workOpen === true || facts.primus?.hiringK === 5)),
        }
      : null;
  const sb = await supabaseServer();
  const { data: latest } = await sb
    .from("bulletins")
    .select("id, kind, title, published_at")
    .eq("event_id", event.id)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; kind: string; title: string; published_at: string }>();
  const finance = team.track === "FINANCE";
  const taskHref = next?.href ?? null;
  const sections = focusSections(team.track, status.phase, taskHref);
  return (
    <ClockProvider serverTime={status.server_time} pausedAt={status.paused ? status.paused_at : null}>
      <EventChannel eventId={event.id} teamId={team.id} spreadMs={1200}>
        <SquadChannel squadId={ctx.squad?.id ?? null}>
        <FeedbackProvider>
        <Heartbeat eventId={event.id} area="team" />
        <BootSequence who={team.code} />
        <div className="terminal-theme-scope term mx-team-shell min-h-screen" data-track={team.track}>
          <MatrixRain opacity={0.42} tint={tint} />
          <div className="mx-team-atmosphere" aria-hidden="true" />
          <div className="mx-team-vignette" aria-hidden="true" />
          <div className="mx-team-chrome">
          <header className="mx-team-topbar">
            <div className="border-b border-white/10">
              <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5 sm:px-4">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="mx-team-brand-pill">PRIMUS</span>
                  <span className="mx-accent-text text-lg" aria-hidden>
                    <Glyph e={TRACK_EMOJI[team.track]} />
                  </span>
                  {/* The cursor sits beside the heading, so the heading reads exactly the team code. */}
                  <h1 className="text-lg font-bold tracking-tight text-white">{team.code}</h1>
                  <span className="inline-block h-2 w-2 rounded-full bg-[#46f097] shadow-[0_0_10px_#46f097]" aria-hidden />
                  <Badge tone="slate">{portal ? PORTAL_TITLES[portal] : TRACK_LABELS[team.track]}</Badge>
                  <span className="hidden truncate text-sm font-medium text-slate-400 sm:inline">{team.name}</span>
                  {event.is_rehearsal ? <Badge tone="violet">Rehearsal ×{event.clock_speed}</Badge> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <div className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
                    <RealtimeDot />
                    <SoundToggle />
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs">
                    <ServerClock className="font-mono font-semibold text-amber-300" />
                    <span className="text-[11px] font-medium text-slate-400">IST</span>
                  </div>
                  <SignOutButton />
                </div>
              </div>
            </div>
            {/* Two facts only: the team's cash, and its own thing (a fund: the trading round; the others: their
                company and its share price). The round and the time left are in the banner below. */}
            <dl className="mx-auto grid max-w-5xl grid-cols-2 gap-2.5 px-3 py-2.5 text-sm sm:px-4">
              <div className="mx-team-kpi-well">
                <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">Your cash</dt>
                <dd className="mt-0.5 font-mono text-base font-semibold tabular-nums text-[#46f097] sm:text-lg" data-testid="team-cash">
                  {money(team.cash)}
                  {finance && team.collateral > 0 ? (
                    <span className="ml-1.5 text-xs font-normal text-slate-400">locked {money(team.collateral)}</span>
                  ) : null}
                </dd>
              </div>
              {finance ? (
                <div className="mx-team-kpi-well">
                  <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">Trading</dt>
                  <dd className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm sm:text-base">
                    <Badge tone={status.trading === "OPEN" ? "green" : status.trading === "PAUSED" ? "amber" : "slate"}>{status.trading}</Badge>
                    {status.trading === "OPEN" && status.open_round ? (
                      <span className="text-xs text-slate-300 sm:text-sm">
                        Round {status.open_round.number} · <Countdown to={status.open_round.closes_at} passed="clearing" className="text-amber-300" />
                      </span>
                    ) : status.next_round ? (
                      <span className="text-xs text-slate-300 sm:text-sm">
                        Round {status.next_round.number} at {clock(status.next_round.opens_at)}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ) : (
                <div className="mx-team-kpi-well">
                  <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">{team.track === "PRODUCT" ? "Your company" : "Your squad's company"}</dt>
                  <dd className="mt-0.5 font-mono text-base font-semibold text-sky-300 sm:text-lg" data-testid="team-company">
                    {ctx.company ? `${ctx.company.ticker ?? "—"} · ${money(ctx.company.market_price)}` : "—"}
                  </dd>
                </div>
              )}
            </dl>
            <MarketStrip eventId={event.id} />
          </header>
          <RoundBanner
            track={team.track}
            phase={status.phase}
            endsAt={status.phase_ends_at}
            gate={status.gate}
            next={status.next_phase}
            openRound={status.trading === "OPEN" ? status.open_round : null}
            format={event.format}
            crisis={crisis}
          />
          <div className="mx-team-nav-shell">
            <TeamNav sections={sections} />
          </div>
          <ActionBar task={next && next.href ? { title: next.title, href: next.href, linkLabel: next.linkLabel, due: next.due } : null} />
          <Alerts tasks={plan ? alertTasks(plan) : []} track={team.track} teamId={team.id} />
          {status.paused ? (
            <p className="border-y border-amber-400/30 bg-amber-500/10 px-4 py-2 text-center text-sm font-medium text-amber-200 backdrop-blur-md">
              The event is paused. Deadlines move later by the length of the pause.
            </p>
          ) : null}
          {team.disqualified ? (
            <p className="border-y border-rose-400/35 bg-rose-500/12 px-4 py-2 text-center text-sm font-medium text-rose-200 backdrop-blur-md">
              Your team has been disqualified by the fairness officer{team.disqualified_reason ? `: ${team.disqualified_reason}` : "."}
            </p>
          ) : null}
          {latest ? (
            <Link
              href="/team/bulletins"
              className="mx-auto mt-3 block max-w-5xl px-3 text-sm [overflow-wrap:anywhere] sm:px-4"
              data-testid="latest-bulletin"
            >
              <span className="mx-accent-hover-row flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-2xl border border-white/12 bg-white/[0.045] px-3.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-md transition">
                <span className="mx-tag mx-accent-text">{latest.kind}</span>
                <span className="font-mono text-xs text-slate-400">{clock(latest.published_at)}</span>
                <span className="mx-accent-text font-semibold underline-offset-2 hover:underline">{latest.title}</span>
              </span>
            </Link>
          ) : null}
          <FeedbackBar className="mx-auto max-w-5xl px-3 pt-3 sm:px-4" />
          <main className="mx-auto max-w-5xl px-3 py-5 sm:px-4">
            <FocusGate track={team.track} phase={status.phase} taskHref={taskHref} format={event.format}>
              {children}
            </FocusGate>
          </main>
          </div>
        </div>
      </FeedbackProvider>
        </SquadChannel>
      </EventChannel>
    </ClockProvider>
  );
}
