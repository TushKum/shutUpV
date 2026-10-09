import type { Metadata } from "next";
import Link from "next/link";
import { PHASE_LABELS, TRACK_LABELS } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import { clock, money } from "@/lib/format";
import { ClockProvider } from "@/lib/live/clock";
import { EventChannel } from "@/lib/live/channel";
import { Heartbeat } from "@/lib/live/heartbeat";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/ui";
import { Countdown, ServerClock } from "@/components/ui/countdown";
import { RealtimeDot } from "@/components/ui/realtime-dot";
import { TeamNav } from "./nav";

export const metadata: Metadata = { title: { template: "%s · Team", default: "Team" } };

// Every team screen (laptop or phone): the team, where the night is (phase and countdown, trading, the open round),
// its cash, the latest bulletin and the sections of its track. The event's realtime channel refreshes the page on
// every broadcast, and the heartbeat tells the control panel the screen is connected.
export default async function TeamLayout({ children }: LayoutProps<"/team">) {
  const { team, event, status } = await loadTeamContext();
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
  return (
    <ClockProvider serverTime={status.server_time}>
      <EventChannel eventId={event.id}>
        <Heartbeat eventId={event.id} area="team" />
        <div className="min-h-screen bg-slate-50">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pt-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="font-mono text-lg font-bold">{team.code}</h1>
                <Badge tone="slate">{TRACK_LABELS[team.track]}</Badge>
                <span className="hidden truncate text-sm text-slate-600 sm:inline">{team.name}</span>
                {event.is_rehearsal ? <Badge tone="violet">Rehearsal ×{event.clock_speed}</Badge> : null}
              </div>
              <div className="flex items-center gap-3 text-sm">
                <RealtimeDot />
                <ServerClock className="font-semibold" />
                <SignOutButton />
              </div>
            </div>
            <dl className="mx-auto grid max-w-5xl grid-cols-2 gap-x-4 gap-y-1 px-4 py-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">Phase</dt>
                <dd className="font-semibold" data-testid="team-phase">
                  {PHASE_LABELS[status.phase]}
                  {status.phase_ends_at ? (
                    <span className="ml-1 font-normal text-slate-600">
                      · ends in <Countdown to={status.phase_ends_at} passed="now" />
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Trading</dt>
                <dd>
                  <Badge tone={status.trading === "OPEN" ? "green" : status.trading === "PAUSED" ? "amber" : "slate"}>{status.trading}</Badge>
                  {status.open_round ? (
                    <span className="ml-1 text-slate-600">
                      round {status.open_round.number} · <Countdown to={status.open_round.closes_at} passed="clearing" />
                    </span>
                  ) : status.next_round ? (
                    <span className="ml-1 text-slate-600">
                      round {status.next_round.number} at {clock(status.next_round.opens_at)}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Cash</dt>
                <dd className="font-mono font-semibold tabular-nums" data-testid="team-cash">
                  {money(team.cash)}
                </dd>
              </div>
              {finance ? (
                <div>
                  <dt className="text-xs text-slate-500">Collateral locked</dt>
                  <dd className="font-mono tabular-nums">{money(team.collateral)}</dd>
                </div>
              ) : null}
            </dl>
            <TeamNav track={team.track} />
          </header>
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
          <main className="mx-auto max-w-5xl px-4 py-4">{children}</main>
        </div>
      </EventChannel>
    </ClockProvider>
  );
}
