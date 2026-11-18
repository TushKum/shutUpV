import type { Metadata } from "next";
import { DEADLINE_LABELS, PHASE_LABELS, type DeadlineCode } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { supabaseServer } from "@/lib/supabase/server";
import { clock } from "@/lib/format";
import { Badge, Notice, Panel, Stat, inputClass } from "@/components/ui/ui";
import { ActionButton, ActionForm } from "@/components/ui/action";
import { Countdown } from "@/components/ui/countdown";
import { advancePhase, extendEvent, extendEventForm, pauseEvent, resumeEvent, setAutoAdvance } from "./actions";
import { closeRound } from "./rounds/actions";
import { AutoAdvanceButton } from "./auto-advance";
import { RefreshAt } from "@/lib/live/refresh-at";
import Link from "next/link";
import { organiserTodos } from "@/lib/admin/todo";
import { loadTodoInput } from "@/lib/admin/todo-data";
import { EXPECTED_SCHEMA, schemaState } from "@/lib/schema";
import { readSchemaVersion } from "@/lib/schema-data";

export const metadata: Metadata = { title: "Phase" };


// Phase control: where the night is, what holds the next step, what needs the organiser now, and the buttons. The
// tracks (Product, Consulting, Finance) and the full schedule have pages of their own.
export default async function PhaseControl({ params }: PageProps<"/admin/[slug]">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const [status, todoInput] = await Promise.all([loadEventStatus(event.id), loadTodoInput(event)]);
  const todos = organiserTodos(todoInput);
  const dbVersion = await readSchemaVersion();
  const schema = schemaState(dbVersion);
  const organiser = viewer!.role === "ORGANISER";
  const sb = await supabaseServer();
  const [deadlines, picks, companies] = await Promise.all([
    sb.from("deadlines").select("code, at").eq("event_id", event.id).gt("at", status.server_time).order("at").limit(5),
    sb.from("draft_picks").select("company_id, pick_no, closes_at, statement_id").eq("event_id", event.id).order("pick_no"),
    sb.from("companies").select("id, ticker").eq("event_id", event.id),
  ]);
  // Round 3's draft, while a company is on the clock.
  const draftPicks = (picks.data ?? []) as { company_id: string; pick_no: number; closes_at: string; statement_id: string | null }[];
  const ticker = new Map(((companies.data ?? []) as { id: string; ticker: string | null }[]).map((c) => [c.id, c.ticker ?? "—"]));
  const onClock = draftPicks.find((p) => p.statement_id === null) ?? null;
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
          {onClock ? (
            <p className="mt-3 text-sm text-paper" data-testid="admin-draft-clock">
              Round 3 draft · on the clock: <strong className="font-mono">{ticker.get(onClock.company_id)}</strong> (pick {onClock.pick_no} of {draftPicks.length}) ·{" "}
              <Countdown to={onClock.closes_at} passed="given by default on the next heartbeat" /> ·{" "}
              <Link href={`/admin/${slug}/product`} className="underline">
                the draft
              </Link>
            </p>
          ) : null}
          {blocked ? (
            <div className="mt-4">
              <Notice tone="amber">
                <strong>Waiting:</strong> {blocked}
              </Notice>
            </div>
          ) : null}
        </Panel>

        {schema === "behind" ? (
          <Notice tone="red">
            <strong>The database is missing migrations.</strong> This app needs database version {EXPECTED_SCHEMA}; the database is at{" "}
            {dbVersion}. Run the newer files in supabase/migrations (docs/DEPLOY.md) before the event.
          </Notice>
        ) : null}
        <Panel title="To do now">
          {todos.length === 0 ? (
            <p className="text-sm text-muted" data-testid="todo-empty">
              Nothing is waiting on you. The night runs itself until the next step above.
            </p>
          ) : (
            <ol className="space-y-2" data-testid="todo">
              {todos.map((t) => (
                <li key={t.text}>
                  <Link
                    href={`/admin/${slug}${t.path}`}
                    className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm ring-1 ring-inset hover:underline ${
                      t.tone === "red"
                        ? "bg-danger/10 text-danger-soft ring-danger/60"
                        : t.tone === "amber"
                          ? "bg-warn/10 text-warn ring-warn/60"
                          : "bg-raised text-paper ring-line"
                    }`}
                  >
                    <span>{t.text}</span>
                    <span aria-hidden>→</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
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
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-phosphor">Extend</h3>
              <p className="text-sm text-paper">The current round or phase and everything after it move later.</p>
              <div className="mt-2 flex flex-wrap items-start gap-2">
                {[5, 10, 15].map((m) => (
                  <ActionButton key={m} action={extendEvent.bind(null, event.id, m)} confirm={`Click again: +${m} min`}>
                    +{m} min
                  </ActionButton>
                ))}
                <ActionForm action={extendEventForm.bind(null, event.id)} submit="Extend" confirm="Click again to extend by {minutes} min" className="flex items-end gap-2">
                  <label className="block">
                    <span className="text-xs font-medium text-paper">Minutes (1–120)</span>
                    <input name="minutes" type="number" min={1} max={120} required className={`${inputClass} w-28`} />
                  </label>
                </ActionForm>
              </div>
            </div>
          </Panel>
        ) : (
          <Notice>The fairness officer can follow the night here; only organisers change the phase.</Notice>
        )}

      </div>

      <div className="min-w-0 space-y-6">
        <Panel title="Next deadlines" actions={<Link href={`/admin/${slug}/schedule`} className="text-sm underline">Full schedule</Link>}>
          {(deadlines.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">No deadline left.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {((deadlines.data ?? []) as { code: DeadlineCode; at: string }[]).map((d) => (
                <li key={d.code} className="flex justify-between gap-2">
                  <span>{DEADLINE_LABELS[d.code]}</span>
                  <span className="font-mono tabular-nums text-paper">
                    {clock(d.at)} · <Countdown to={d.at} passed="closed" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Tracks">
          <ul className="space-y-2 text-sm">
            {[
              ["product", "Product", "PRDs, crisis plans, the draft and solutions"],
              ["consulting", "Consulting", "Memos, hires, advice, stars and bonuses"],
              ["finance", "Finance", "Practice market, IPO bids, cash and orders"],
            ].map(([path, label, what]) => (
              <li key={path}>
                <Link href={`/admin/${slug}/${path}`} className="flex items-center justify-between gap-3 rounded-md bg-raised px-3 py-2 ring-1 ring-inset ring-line hover:text-phosphor">
                  <span>
                    <b className="text-paper">{label}</b> <span className="text-muted">· {what}</span>
                  </span>
                  <span aria-hidden>→</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
