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
import { ServerClock } from "@/components/ui/countdown";
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
        <div className="min-h-screen bg-slate-50">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-2xl" aria-hidden>
                  {TRACK_EMOJI[team.track]}
                </span>
                <h1 className="font-mono text-lg font-extrabold">{team.code}</h1>
                <Badge tone="slate">{TRACK_LABELS[team.track]}</Badge>
                <span className="hidden truncate text-sm text-slate-600 sm:inline">{team.name}</span>
                {event.is_rehearsal ? <Badge tone="violet">Rehearsal ×{event.clock_speed}</Badge> : null}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="rounded-xl bg-emerald-50 px-3 py-1 ring-1 ring-emerald-200">
                  <span className="mr-1" aria-hidden>
                    💵
                  </span>
                  <span className="sr-only">Cash </span>
                  <span className="font-mono font-extrabold tabular-nums text-emerald-800" data-testid="team-cash">
                    {money(team.cash)}
                  </span>
                </span>
                {finance && team.collateral > 0 ? (
                  <span className="text-xs text-slate-500">
                    Locked: <span className="font-mono tabular-nums">{money(team.collateral)}</span>
                  </span>
                ) : null}
                <RealtimeDot />
                <SoundToggle />
                <ServerClock className="hidden font-semibold sm:inline" />
                <SignOutButton />
              </div>
            </div>
          </header>
          <RoundBanner
            track={team.track}
            phase={status.phase}
            endsAt={status.phase_ends_at}
            gate={status.gate}
            next={status.next_phase}
            openRound={status.trading === "OPEN" ? status.open_round : null}
          />
          <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
            <TeamNav sections={sections} />
          </div>
          <ActionBar task={next && next.href ? { title: next.title, href: next.href, linkLabel: next.linkLabel, due: next.due } : null} />
          <Alerts tasks={plan ? alertTasks(plan) : []} track={team.track} teamId={team.id} />
          {status.paused ? (
            <p className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">
              The event is paused. Deadlines move later by the length of the pause.
            </p>
          ) : null}
          {team.disqualified ? (
            <p className="bg-red-100 px-4 py-2 text-center text-sm font-medium text-red-900">
              Your team has been disqualified by the fairness officer{team.disqualified_reason ? `: ${team.disqualified_reason}` : "."}
            </p>
          ) : null}
          {latest ? (
            <Link
              href="/team/bulletins"
              className="mx-auto block max-w-5xl px-4 pt-3 text-sm [overflow-wrap:anywhere]"
              data-testid="latest-bulletin"
            >
              <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">{latest.kind}</span>{" "}
              <span className="font-mono text-xs text-slate-500">{clock(latest.published_at)}</span>{" "}
              <span className="font-semibold text-slate-900 underline-offset-2 hover:underline">{latest.title}</span>
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
