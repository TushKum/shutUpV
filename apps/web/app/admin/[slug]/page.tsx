import type { Metadata } from "next";
import { DEADLINE_LABELS, PHASE_LABELS, type DeadlineCode, type PhaseCode } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { supabaseServer } from "@/lib/supabase/server";
import { clock } from "@/lib/format";
import { Badge, Notice, Panel, Stat, Table, Td, inputClass } from "@/components/ui/ui";
import { ActionButton, ActionForm } from "@/components/ui/action";
import { Countdown } from "@/components/ui/countdown";
import { advancePhase, extendEvent, extendEventForm, pauseEvent, resumeEvent, setAutoAdvance } from "./actions";
import { closeRound } from "./rounds/actions";
import { AutoAdvanceButton } from "./auto-advance";
import { RefreshAt } from "@/lib/live/refresh-at";

export const metadata: Metadata = { title: "Phase" };

interface PhaseRow {
  code: PhaseCode;
  seq: number;
  starts_at: string;
  ends_at: string;
  started_at: string | null;
  ended_at: string | null;
}

// Phase control: where the night is, what holds the next step, and the organiser's buttons.
export default async function PhaseControl({ params }: PageProps<"/admin/[slug]">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const status = await loadEventStatus(event.id);
  const organiser = viewer!.role === "ORGANISER";
  const sb = await supabaseServer();
  const [phases, deadlines, rounds] = await Promise.all([
    sb.from("phases").select("code, seq, starts_at, ends_at, started_at, ended_at").eq("event_id", event.id).order("seq"),
    sb.from("deadlines").select("code, at").eq("event_id", event.id).order("at"),
    sb.from("rounds").select("number, phase, status, opens_at, closes_at, cleared_at").eq("event_id", event.id).order("number"),
  ]);
  const next = status.next_phase;
  const blocked = status.gate ?? (status.paused ? "Resume the event before advancing." : null);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* At the planned end the gate and the controls change: re-read then, not only on the next broadcast. */}
      <RefreshAt at={status.phase_ends_at} />
      <div className="min-w-0 space-y-6 lg:col-span-2">
        <Panel title="Now">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Phase" value={PHASE_LABELS[status.phase]} hint={status.phase_started_at ? `since ${clock(status.phase_started_at)}` : undefined} />
            <Stat
              label="Planned end"
              value={<Countdown to={status.phase_ends_at} passed="due" />}
              hint={status.phase_ends_at ? clock(status.phase_ends_at) : undefined}
            />
            <Stat
              label="Trading"
              value={
                <Badge tone={status.trading === "OPEN" ? "green" : status.trading === "PAUSED" ? "amber" : "slate"}>{status.trading}</Badge>
              }
              hint={
                status.open_round ? (
                  <>
                    Round {status.open_round.number} closes in <Countdown to={status.open_round.closes_at} />
                  </>
                ) : status.next_round ? (
                  <>
                    Round {status.next_round.number} opens {clock(status.next_round.opens_at)}
                  </>
                ) : undefined
              }
            />
            <Stat label="Auto-advance" value={status.auto_advance ? "On" : "Off"} hint={status.paused ? `Paused since ${clock(status.paused_at)}` : undefined} />
          </div>
          {blocked ? (
            <div className="mt-4">
              <Notice tone="amber">
                <strong>Waiting:</strong> {blocked}
              </Notice>
            </div>
          ) : null}
        </Panel>

        {organiser ? (
          <Panel title="Controls">
            <div className="flex flex-wrap items-start gap-3">
              {next ? (
                <ActionButton
                  action={advancePhase.bind(null, event.id, status.phase)}
                  confirm={`Click again to start ${PHASE_LABELS[next]}`}
                  variant="primary"
                  disabled={!!blocked}
                  title={blocked ?? undefined}
                >
                  Advance to {PHASE_LABELS[next]}
                </ActionButton>
              ) : null}
              {status.paused ? (
                <ActionButton action={resumeEvent.bind(null, event.id)} confirm="Click again to resume the event" variant="primary">
                  Resume
                </ActionButton>
              ) : (
                <ActionButton action={pauseEvent.bind(null, event.id)} confirm="Click again to pause the event">
                  Pause
                </ActionButton>
              )}
              {/* Always mounted (disabled when no round is open), so its result stays visible after the round clears. */}
              <ActionButton
                action={closeRound.bind(null, event.id, status.open_round?.number ?? 0)}
                confirm={status.open_round ? `Click again to close round ${status.open_round.number} now` : undefined}
                disabled={!status.open_round}
                title={status.open_round ? "Clears the round at once with the orders in the book" : "No round is open"}
              >
                {status.open_round ? `Close round ${status.open_round.number} now` : "Close round now"}
              </ActionButton>
              <AutoAdvanceButton
                on={status.auto_advance}
                endsAt={status.phase_ends_at}
                nextLabel={next ? PHASE_LABELS[next] : null}
                turnOn={setAutoAdvance.bind(null, event.id, true, false)}
                confirmOn={setAutoAdvance.bind(null, event.id, true, true)}
                turnOff={setAutoAdvance.bind(null, event.id, false, false)}
              />
            </div>
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h3 className="text-sm font-semibold text-slate-900">Extend</h3>
              <p className="text-sm text-slate-600">The current round or phase and everything after it move later.</p>
              <div className="mt-2 flex flex-wrap items-start gap-2">
                {[5, 10, 15].map((m) => (
                  <ActionButton key={m} action={extendEvent.bind(null, event.id, m)} confirm={`Click again: +${m} min`}>
                    +{m} min
                  </ActionButton>
                ))}
                <ActionForm action={extendEventForm.bind(null, event.id)} submit="Extend" confirm="Click again to extend by {minutes} min" className="flex items-end gap-2">
                  <label className="block">
                    <span className="text-xs font-medium text-slate-600">Minutes (1–120)</span>
                    <input name="minutes" type="number" min={1} max={120} required className={`${inputClass} w-28`} />
                  </label>
                </ActionForm>
              </div>
            </div>
          </Panel>
        ) : (
          <Notice>The fairness officer can follow the night here; only organisers change the phase.</Notice>
        )}

        <Panel title="Rounds">
          <Table head={["Round", "Phase", "Opens", "Closes", "Status"]} empty="No rounds.">
            {(rounds.data ?? []).map((r) => (
              <tr key={r.number} className={r.status === "OPEN" ? "bg-emerald-50" : ""}>
                <Td mono>{r.number}</Td>
                <Td>{PHASE_LABELS[r.phase as PhaseCode]}</Td>
                <Td mono>{clock(r.opens_at)}</Td>
                <Td mono>{clock(r.closes_at)}</Td>
                <Td>
                  <Badge tone={r.status === "OPEN" ? "green" : r.status === "CLEARED" ? "slate" : "blue"}>{r.status}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>

      <div className="min-w-0 space-y-6">
        <Panel title="Schedule">
          <ol className="space-y-1 text-sm">
            {((phases.data ?? []) as PhaseRow[]).map((p) => {
              const current = p.code === status.phase;
              const done = !!p.ended_at;
              return (
                <li key={p.code} className={`flex justify-between gap-2 rounded px-2 py-1 ${current ? "bg-slate-900 text-white" : done ? "text-slate-500" : ""}`}>
                  <span>{PHASE_LABELS[p.code]}</span>
                  <span className="font-mono tabular-nums">
                    {clock(p.started_at ?? p.starts_at)}–{clock(p.ended_at ?? p.ends_at)}
                  </span>
                </li>
              );
            })}
          </ol>
        </Panel>
        <Panel title="Deadlines">
          <ul className="space-y-1 text-sm">
            {(deadlines.data ?? []).map((d) => (
              <li key={d.code} className="flex justify-between gap-2">
                <span>{DEADLINE_LABELS[d.code as DeadlineCode]}</span>
                <span className="font-mono tabular-nums text-slate-700">
                  {clock(d.at)} · <Countdown to={d.at} passed="closed" />
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
