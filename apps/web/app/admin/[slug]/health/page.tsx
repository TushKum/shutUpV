import { TRACK_LABELS, TRACKS } from "@msim/engine";
import { loadAdminEvent } from "@/lib/admin/event";
import { ERROR_ROWS, loadHealthData } from "@/lib/admin/health-data";
import { cronState, seenAgo, teamScreens } from "@/lib/admin/health";
import { clock, count } from "@/lib/format";
import { Badge, Notice, Panel, Stat, Table, Td } from "@/components/ui/ui";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { ConsoleStatus } from "./console-status";

const AREA_LABELS: Record<string, string> = { team: "Team portal", admin: "Control panel", display: "Big screen" };
const ROLE_LABELS: Record<string, string> = { TEAM: "Team", ORGANISER: "Organiser", FAIRNESS: "Fairness officer", DISPLAY: "Display" };

// Health: the database heartbeat, connected screens and their realtime status, team screens (and teams with none),
// the event's error log, and this console's own connection.
export default async function HealthPage({ params }: PageProps<"/admin/[slug]/health">) {
  const { slug } = await params;
  const event = await loadAdminEvent(slug);
  const { health, teams, pings, errors } = await loadHealthData(event.id);
  const serverMs = new Date(health.serverTime).getTime();
  const cron = cronState(health.cron, serverMs);
  const { connected, silent } = teamScreens(teams, pings, serverMs);
  const teamsOnline = new Set(connected.map((c) => c.code)).size;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <AutoRefresh everyMs={10_000} />
      <div className="min-w-0 space-y-6 lg:col-span-2">
        <Panel title="Heartbeat">
          <Notice tone={cron.tone}>
            <strong>pg_cron:</strong> {cron.label}
          </Notice>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Stat label="Last run" value={health.cron ? seenAgo(health.cron.lastStart, serverMs) : "—"} hint={health.cron?.lastStart ? clock(health.cron.lastStart, true) : undefined} />
            <Stat label="Runs, last 10 min" value={health.cron ? count(health.cron.runsLast10Min) : "—"} />
            <Stat label="Failed, last 10 min" value={health.cron ? count(health.cron.failedLast10Min) : "—"} />
            <Stat label="Tick errors, last hour" value={count(health.tickErrorsLastHour)} hint="this event" />
          </div>
          {health.cron?.lastError ? (
            <p className="mt-3 text-sm text-slate-700">
              Last failure: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{health.cron.lastError}</code>
            </p>
          ) : null}
        </Panel>

        <Panel title="Connected screens">
          <p className="mb-2 text-sm text-slate-600">Browser tabs whose heartbeat was seen in the last 60 seconds, and how many have their realtime channel working.</p>
          <Table head={["Area", "Role", "Connected", "Realtime working"]} empty="No screen is connected.">
            {health.screens.map((s) => (
              <tr key={`${s.area}/${s.role}`}>
                <Td>{AREA_LABELS[s.area] ?? s.area}</Td>
                <Td>{ROLE_LABELS[s.role] ?? s.role}</Td>
                <Td mono>{count(s.connected)}</Td>
                <Td mono className={s.realtimeOk < s.connected ? "text-amber-700" : ""}>
                  {count(s.realtimeOk)} of {count(s.connected)}
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>

        <Panel title="Team screens" actions={<Badge tone={teamsOnline === teams.length ? "green" : "slate"}>{`${teamsOnline} of ${teams.length} teams connected`}</Badge>}>
          <Table head={["Team", "Track", "Last seen", "Realtime", "Open since"]} empty="No team screen in the last 60 seconds.">
            {connected.map((c) => (
              <tr key={c.clientId}>
                <Td mono className="font-semibold">{c.code}</Td>
                <Td>{TRACK_LABELS[c.track]}</Td>
                <Td mono>{seenAgo(c.lastSeen, serverMs)}</Td>
                <Td>
                  <Badge tone={c.realtime === "SUBSCRIBED" ? "green" : c.realtime === "CONNECTING" ? "amber" : "red"}>{c.realtime}</Badge>
                </Td>
                <Td mono>{clock(c.firstSeen, true)}</Td>
              </tr>
            ))}
          </Table>
        </Panel>

        <Panel title={`No screen in the last 60 seconds (${silent.length})`}>
          {silent.length === 0 ? (
            <p className="text-sm text-slate-500">Every team has a screen connected.</p>
          ) : (
            <div className="space-y-3">
              {TRACKS.map((track) => {
                const list = silent.filter((t) => t.track === track);
                if (list.length === 0) return null;
                return (
                  <div key={track}>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {TRACK_LABELS[track]} · {list.length}
                    </h3>
                    <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`${TRACK_LABELS[track]} teams with no screen`}>
                      {list.map((t) => (
                        <li key={t.code} className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                          {t.code} · {t.lastSeen ? `seen ${seenAgo(t.lastSeen, serverMs)}` : "never seen"}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Error log">
          <p className="mb-2 text-sm text-slate-600">The latest {ERROR_ROWS} errors recorded for this event, newest first (a failed heartbeat records one here).</p>
          <Table head={["Time", "Source", "Message", "Context"]} empty="No errors recorded.">
            {errors.map((e) => (
              <tr key={e.id} className="align-top">
                <Td mono>{clock(e.at, true)}</Td>
                <Td>{e.source}</Td>
                <Td className="whitespace-normal break-words">{e.message}</Td>
                <Td className="whitespace-normal">
                  {e.context && Object.keys(e.context).length > 0 ? (
                    <code className="break-all text-xs text-slate-600">{truncate(JSON.stringify(e.context), 300)}</code>
                  ) : null}
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>

      <div className="min-w-0 space-y-6">
        <Panel title="This console">
          <ConsoleStatus />
        </Panel>
      </div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
