import type { Metadata } from "next";
import Link from "next/link";
import { PHASE_LABELS, TRACK_LABELS, type Track } from "@msim/engine";
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
import { alertTasks, nextAction } from "@/lib/team/alerts";
import { RoundBanner } from "./round-banner";
import { FocusGate } from "./focus-gate";
import { focusSections } from "@/lib/team/focus";
import { BootSequence } from "@/components/ui/matrix/boot-sequence";
import { Glyph } from "@/components/ui/matrix/glyph";

const TRACK_EMOJI: Record<Track, string> = { PRODUCT: "🏢", CONSULTING: "🧠", FINANCE: "💼" };

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
  if (portal && !portalAdmits(portal, team.track)) {
    return (
      <main className="term flex min-h-dvh items-center justify-center px-4">
        <div className="max-w-md space-y-4 border border-line bg-panel p-6" data-testid="wrong-portal">
          <p className="bg-[var(--term-amber)] px-1.5 text-xs font-black tracking-widest text-black">PRIMUS</p>
          <p className="text-paper">{wrongPortalMessage(portal, team.track, portalUrl(team.track))}</p>
          <SignOutButton />
        </div>
      </main>
    );
  }
  // The bar and the alerts are guidance: if the plan cannot be read (say, the database is older than the app), every
  // page still works, without them.
  const plan = await loadPlanFacts(ctx).then(homePlan, (err: unknown) => {
    console.error("team layout: no plan for the bar and alerts:", err);
    return null;
  });
  const next = plan ? nextAction(plan) : null;
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
      <EventChannel eventId={event.id}>
        <SquadChannel squadId={ctx.squad?.id ?? null}>
        <FeedbackProvider>
        <Heartbeat eventId={event.id} area="team" />
        <BootSequence who={team.code} />
        <div className="terminal-theme-scope term min-h-screen">
          <header className="border-b border-line bg-ink">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[var(--term-amber-dim)] px-4 py-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="bg-[var(--term-amber)] px-1.5 text-xs font-black tracking-widest text-black">PRIMUS</span>
                <span className="text-lg text-[var(--term-amber)]" aria-hidden>
                  <Glyph e={TRACK_EMOJI[team.track]} />
                </span>
                {/* The cursor sits beside the heading, so the heading reads exactly the team code. */}
                <h1 className="text-lg font-bold text-[var(--term-amber)]">{team.code}</h1>
                <span className="term-cursor -ml-1.5 text-lg text-[var(--term-amber)]" aria-hidden>
                  ▮
                </span>
                <Badge tone="slate">{portal ? PORTAL_TITLES[portal] : TRACK_LABELS[team.track]}</Badge>
                <span className="hidden truncate text-sm uppercase text-muted sm:inline">{team.name}</span>
                {event.is_rehearsal ? <Badge tone="violet">Rehearsal ×{event.clock_speed}</Badge> : null}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <RealtimeDot />
                <SoundToggle />
                <ServerClock className="font-semibold text-[var(--term-amber)]" />
                <span className="text-xs text-muted">IST</span>
                <SignOutButton />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-px bg-line text-sm sm:grid-cols-4">
              <div className="bg-ink px-4 py-1.5">
                <dt className="text-[11px] uppercase tracking-wider text-[var(--term-amber-dim)]">Phase</dt>
                <dd className="font-semibold text-paper" data-testid="header-phase">
                  {PHASE_LABELS[status.phase]}
                  {status.phase_ends_at ? (
                    <span className="ml-1 text-muted">
                      · <Countdown to={status.phase_ends_at} passed="ending" className="text-[var(--term-amber)]" />
                    </span>
                  ) : null}
                </dd>
              </div>
              <div className="bg-ink px-4 py-1.5">
                <dt className="text-[11px] uppercase tracking-wider text-[var(--term-amber-dim)]">Trading</dt>
                <dd>
                  <Badge tone={status.trading === "OPEN" ? "green" : status.trading === "PAUSED" ? "amber" : "slate"}>{status.trading}</Badge>
                  {status.trading === "OPEN" && status.open_round ? (
                    <span className="ml-1 text-muted">
                      R{status.open_round.number} · <Countdown to={status.open_round.closes_at} passed="clearing" className="text-[var(--term-amber)]" />
                    </span>
                  ) : status.next_round ? (
                    <span className="ml-1 text-muted">
                      R{status.next_round.number} at {clock(status.next_round.opens_at)}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div className="bg-ink px-4 py-1.5">
                <dt className="text-[11px] uppercase tracking-wider text-[var(--term-amber-dim)]">Cash</dt>
                <dd className="font-mono font-semibold tabular-nums text-[var(--term-green)]" data-testid="team-cash">
                  {money(team.cash)}
                  {finance && team.collateral > 0 ? (
                    <span className="ml-1 text-xs font-normal text-muted">locked {money(team.collateral)}</span>
                  ) : null}
                </dd>
              </div>
              <div className="bg-ink px-4 py-1.5">
                <dt className="text-[11px] uppercase tracking-wider text-[var(--term-amber-dim)]">{finance ? "Desk" : "Company"}</dt>
                <dd className="font-mono text-[var(--term-cyan)]" data-testid="team-company">
                  {finance ? TRACK_LABELS[team.track] : ctx.company ? `${ctx.company.ticker ?? "—"} · ${money(ctx.company.market_price)}` : "—"}
                </dd>
              </div>
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
          />
          <div className="sticky top-0 z-40 border-b border-line bg-ink">
            <TeamNav sections={sections} />
          </div>
          <ActionBar task={next && next.href ? { title: next.title, href: next.href, linkLabel: next.linkLabel, due: next.due } : null} />
          <Alerts tasks={plan ? alertTasks(plan) : []} track={team.track} teamId={team.id} />
          {status.paused ? (
            <p className="border-y border-warn/60 bg-ink px-4 py-2 text-center text-sm font-medium text-warn">
              The event is paused. Deadlines move later by the length of the pause.
            </p>
          ) : null}
          {team.disqualified ? (
            <p className="border-y border-danger/70 bg-ink px-4 py-2 text-center text-sm font-medium text-danger-soft">
              Your team has been disqualified by the fairness officer{team.disqualified_reason ? `: ${team.disqualified_reason}` : "."}
            </p>
          ) : null}
          {latest ? (
            <Link
              href="/team/bulletins"
              className="mx-auto block max-w-5xl px-4 pt-3 text-sm [overflow-wrap:anywhere]"
              data-testid="latest-bulletin"
            >
              <span className="mx-tag text-xs text-phosphor">{latest.kind}</span>{" "}
              <span className="font-mono text-xs text-muted">{clock(latest.published_at)}</span>{" "}
              <span className="font-semibold text-phosphor underline-offset-2 hover:underline">{latest.title}</span>
            </Link>
          ) : null}
          <FeedbackBar className="mx-auto max-w-5xl px-4 pt-3" />
          <main className="mx-auto max-w-5xl px-4 py-4">
            <FocusGate track={team.track} phase={status.phase} taskHref={taskHref}>
              {children}
            </FocusGate>
          </main>
        </div>
      </FeedbackProvider>
        </SquadChannel>
      </EventChannel>
    </ClockProvider>
  );
}
