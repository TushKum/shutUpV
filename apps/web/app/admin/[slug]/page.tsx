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
import Link from "next/link";
import { organiserTodos } from "@/lib/admin/todo";
import { loadTodoInput } from "@/lib/admin/todo-data";
import { EXPECTED_SCHEMA, schemaState } from "@/lib/schema";
import { readSchemaVersion } from "@/lib/schema-data";

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
  const [status, todoInput] = await Promise.all([loadEventStatus(event.id), loadTodoInput(event)]);
  const todos = organiserTodos(todoInput);
  const dbVersion = await readSchemaVersion();
  const schema = schemaState(dbVersion);
  const organiser = viewer!.role === "ORGANISER";
  const sb = await supabaseServer();
  const [phases, deadlines, rounds, subrounds, engagements, picks, statements, companies, squadCards] = await Promise.all([
    sb.from("phases").select("code, seq, starts_at, ends_at, started_at, ended_at").eq("event_id", event.id).order("seq"),
    sb.from("deadlines").select("code, at").eq("event_id", event.id).order("at"),
    sb.from("rounds").select("number, phase, status, opens_at, closes_at, cleared_at").eq("event_id", event.id).order("number"),
    sb.from("subrounds").select("k, revealed_at, hiring_closed_at, due_closed_at, rated_at").eq("event_id", event.id).order("k"),
    sb.from("engagements").select("k, escrow, rating").eq("event_id", event.id),
    sb.from("draft_picks").select("company_id, pick_no, closes_at, statement_id, by_default").eq("event_id", event.id).order("pick_no"),
    sb.from("problem_statements").select("id, number, title, cap, sector").eq("event_id", event.id).order("number"),
    sb.from("companies").select("id, ticker, squad_id").eq("event_id", event.id),
    sb.from("squads").select("id, problem_cards!squads_chosen_card_id_fkey(sector)").eq("event_id", event.id),
  ]);
  // Round 3's draft, for the panel below.
  const draftPicks = (picks.data ?? []) as { company_id: string; pick_no: number; closes_at: string; statement_id: string | null; by_default: boolean }[];
  const stRows = (statements.data ?? []) as { id: string; number: number; title: string; cap: number; sector: string | null }[];
  const coRows = (companies.data ?? []) as { id: string; ticker: string | null; squad_id: string | null }[];
  const ticker = new Map(coRows.map((c) => [c.id, c.ticker ?? "—"]));
  const playing = coRows.filter((c) => c.squad_id !== null).length;
  const room = stRows.reduce((s, x) => s + x.cap, 0);
  const onClock = draftPicks.find((p) => p.statement_id === null) ?? null;
  // An event split across sectors: each sector's statements need room for that sector's companies.
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const sectorOfSquad = new Map(
    ((squadCards.data ?? []) as unknown as { id: string; problem_cards: { sector: string | null } | { sector: string | null }[] | null }[]).map((s) => [
      s.id,
      (Array.isArray(s.problem_cards) ? s.problem_cards[0]?.sector : s.problem_cards?.sector) ?? null,
    ]),
  );
  const sectorShort = stRows.some((s) => s.sector)
    ? [...new Set(coRows.map((c) => (c.squad_id ? sectorOfSquad.get(c.squad_id) : null)).filter((s): s is string => !!s))]
        .map((sec) => ({
          sec,
          n: coRows.filter((c) => c.squad_id && norm(sectorOfSquad.get(c.squad_id)) === norm(sec)).length,
          room: stRows.filter((s) => norm(s.sector) === norm(sec)).reduce((t, s) => t + s.cap, 0),
        }))
        .filter((x) => x.room < x.n)
    : [];
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

        {event.format === "PRIMUS" ? (
          <Panel title="PRIMUS sub-rounds">
            <Table head={["Sub-round", "Revealed", "Hiring closed", "Escrow settled", "Ratings closed", "Firms hired", "Rated"]} empty="No sub-round has started.">
              {((subrounds.data ?? []) as { k: number; revealed_at: string | null; hiring_closed_at: string | null; due_closed_at: string | null; rated_at: string | null }[]).map((s) => {
                const hires = ((engagements.data ?? []) as { k: number; escrow: string; rating: number | null }[]).filter((e) => e.k === s.k);
                return (
                  <tr key={s.k} data-testid={`subround-${s.k}`}>
                    <Td>{s.k === 5 ? "Round 3" : `Crisis ${s.k}`}</Td>
                    <Td mono>{clock(s.revealed_at)}</Td>
                    <Td mono>{clock(s.hiring_closed_at)}</Td>
                    <Td mono>{clock(s.due_closed_at)}</Td>
                    <Td mono>{clock(s.rated_at)}</Td>
                    <Td mono>{hires.length}</Td>
                    <Td mono>{hires.filter((e) => e.rating !== null).length}</Td>
                  </tr>
                );
              })}
            </Table>
            <p className="mt-2 text-xs text-muted">
              The heartbeat reveals each crisis at its time, closes hiring, settles escrow at the due time and fills missing ratings with 3. Judge and
              release each crisis plan, advice memo and the solution under Judge.
            </p>
          </Panel>
        ) : null}

        {event.format === "PRIMUS" ? (
          <Panel title="Round 3 · the draft" actions={<a href={`/admin/${slug}/content`} className="text-sm underline">Statements</a>}>
            {stRows.length === 0 ? (
              <Notice tone={status.phase === "SATURATION" ? "red" : "amber"}>
                {status.phase === "SATURATION"
                  ? "Round 3 has started but there are no problem statements: the draft is waiting. Upload them under Content now; the draft starts at once."
                  : "No problem statements yet. Upload them under Content before Round 3: the draft starts with Round 3 only if they are there."}
              </Notice>
            ) : sectorShort.length ? (
              <Notice tone="red">
                Not enough room in {sectorShort.map((x) => `${x.sec} (room for ${x.room}, ${x.n} companies)`).join(", ")}. Each sector&apos;s statements must
                fit its companies: raise the caps or add statements under Content.
              </Notice>
            ) : room < playing ? (
              <Notice tone="red">
                The statements have room for {room} companies, but {playing} companies play. Raise the caps or add statements under Content.
              </Notice>
            ) : draftPicks.length === 0 ? (
              <p className="text-sm text-paper">
                {stRows.length} statements, room for {room} companies ({playing} play). The draft starts with Round 3: lowest score so far first, 20 seconds each.
              </p>
            ) : onClock ? (
              <p className="text-sm text-paper" data-testid="admin-draft-clock">
                On the clock: <strong className="font-mono">{ticker.get(onClock.company_id)}</strong> (pick {onClock.pick_no} of {draftPicks.length}) ·{" "}
                <Countdown to={onClock.closes_at} passed="given by default on the next heartbeat" /> · {draftPicks.filter((p) => p.statement_id).length} picked.
              </p>
            ) : (
              <p className="text-sm font-semibold text-phosphor">
                The draft is over: every company has its statement ({draftPicks.filter((p) => p.by_default).length} given by default). Hiring for Round 3 is open.
              </p>
            )}
            {draftPicks.length ? (
              <Table head={["#", "Sector", "Statement", "Companies"]} className="mt-3">
                {stRows.map((s) => {
                  const on = draftPicks.filter((p) => p.statement_id === s.id);
                  return (
                    <tr key={s.id}>
                      <Td mono>{s.number}</Td>
                      <Td>{s.sector ?? "—"}</Td>
                      <Td>{s.title}</Td>
                      <Td mono>
                        {on.length}/{s.cap} {on.map((p) => `${ticker.get(p.company_id)}${p.by_default ? "*" : ""}`).join(" ")}
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            ) : null}
            <p className="mt-2 text-xs text-muted">* given by default (no pick in time). The big screen shows the draft live while it runs.</p>
          </Panel>
        ) : null}

        <Panel title="Rounds">
          <Table head={["Round", "Phase", "Opens", "Closes", "Status"]} empty="No rounds.">
            {(rounds.data ?? []).map((r) => (
              <tr key={r.number} className={r.status === "OPEN" ? "bg-phosphor/10" : ""}>
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
                <li key={p.code} className={`flex justify-between gap-2 rounded px-2 py-1 ${current ? "bg-phosphor-deep text-phosphor" : done ? "text-muted" : ""}`}>
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
                <span className="font-mono tabular-nums text-paper">
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
