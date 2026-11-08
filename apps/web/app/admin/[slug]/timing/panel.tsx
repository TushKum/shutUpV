"use client";

// The Event timing panel: a live readout of the night's clock, the organiser's controls (start, end phase, pause,
// resume, extend, mode, end the night), the phase timeline, the duration editor with its before/after preview, the
// early close of a round and the timing log. Every change goes through the database, which decides; the panel shows
// what it would do first, asks twice for anything that brings a time earlier or closes something, and sends the
// version it showed so a second console never applies a change twice.

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PHASE_LABELS, type PhaseCode } from "@msim/engine";
import { clock } from "@/lib/format";
import { useDeadlineNow, useServerNow } from "@/lib/live/clock";
import type { ActionResult } from "@/lib/rpc";
import type { EventStatus } from "@/lib/event-status";
import {
  FIXED_PHASES,
  TRADING_PHASES,
  draftChanges,
  elapsedMs,
  logSummary,
  span,
  timelineSegments,
  toMinutes,
  type PhaseTiming,
  type RoundTiming,
  type TimingChange,
  type TimingChanges,
  type TimingDraft,
  type TimingLogEntry,
} from "@/lib/admin/timing";
import * as act from "./actions";

type Round = RoundTiming & { id: string };

interface Props {
  eventId: string;
  organiser: boolean;
  rehearsal: boolean;
  status: EventStatus;
  phases: PhaseTiming[];
  rounds: Round[];
  offsets: { twist_offset_seconds: number; freeze_offset_seconds: number };
  log: TimingLogEntry[];
  pendingOrders: number;
}

// ───────────── Building blocks, in the panel's style ─────────────

function Frame({ title, aside, children, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mx-frame ${className}`} aria-label={title}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 px-4 py-2">
        <h2 className="mx-title">{title}</h2>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Readout({ label, value, hint, tone = "on" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "on" | "warn" | "dim" }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-500/80">{label}</div>
      <div className={`mx-digits text-2xl ${tone === "warn" ? "text-amber-300" : tone === "dim" ? "text-emerald-600" : ""}`} suppressHydrationWarning>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-emerald-500/80">{hint}</div> : null}
    </div>
  );
}

/** A button that asks a second time when `confirm` is set; a second click within 400 ms is a double-click, ignored. */
function MButton({
  onRun,
  children,
  confirm,
  tone = "default",
  disabled,
  title,
  busy,
}: {
  onRun: () => void;
  children: ReactNode;
  confirm?: string;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  title?: string;
  busy?: boolean;
}) {
  const [armed, setArmed] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 6000);
    return () => clearTimeout(t);
  }, [armed]);
  // What the button would confirm changed (a refresh): the old arming no longer counts.
  const isArmed = !!armed && armed.text === confirm;
  const click = () => {
    if (confirm && !isArmed) return setArmed({ text: confirm, at: Date.now() });
    if (isArmed && Date.now() - armed!.at < 400) return;
    setArmed(null);
    onRun();
  };
  return (
    <button
      type="button"
      onClick={click}
      disabled={disabled || busy}
      title={title}
      className={`mx-btn ${isArmed ? "mx-btn-danger" : tone === "primary" ? "mx-btn-primary" : tone === "danger" ? "mx-btn-danger" : ""}`}
    >
      {busy ? "Working…" : isArmed ? confirm : children}
    </button>
  );
}

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  const text = result.message ?? (result.ok ? "Done." : (result.code ?? "Refused."));
  return (
    <p role={result.ok ? "status" : "alert"} className={`mt-2 text-sm ${result.ok ? "text-emerald-300" : "text-amber-300"}`}>
      {result.ok ? "› " : `✕ ${result.code && !["ERROR", "NOT_ALLOWED"].includes(result.code) ? `${result.code}: ` : ""}`}
      {text}
    </p>
  );
}

/** The database labels a phase by its code; the panel uses the names everyone sees. */
function changeLabel(c: TimingChange): string {
  const code = c.key.startsWith("phase:") ? (c.key.slice(6) as PhaseCode) : null;
  return code && PHASE_LABELS[code] ? `${phaseLabel(code)} ends` : c.label;
}

function delta(c: TimingChange): string {
  if (!c.from || !c.to) return c.to ? "now timed" : "untimed";
  const s = Math.round((Date.parse(c.to) - Date.parse(c.from)) / 1000);
  return `${s < 0 ? "−" : "+"}${span(Math.abs(s) * 1000)}`;
}

/** The before/after of a change: every time that moves, earlier ones marked. */
function ChangesTable({ changes, empty = "No time moves." }: { changes: TimingChange[]; empty?: string }) {
  if (changes.length === 0) return <p className="text-sm text-emerald-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-widest text-emerald-500/80">
          <tr>
            <th className="py-1 pr-3 font-normal">What</th>
            <th className="py-1 pr-3 font-normal">Now</th>
            <th className="py-1 pr-3 font-normal">After</th>
            <th className="py-1 font-normal">Moves</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.key} className={`border-t border-emerald-500/10 ${c.earlier ? "text-amber-200" : ""}`}>
              <td className="py-1 pr-3">
                {changeLabel(c)}
                {c.kind === "deadline" ? <span className="ml-2 rounded border border-emerald-500/40 px-1 text-[10px] uppercase">teams</span> : null}
              </td>
              <td className="py-1 pr-3 font-mono tabular-nums">{c.from ? clock(c.from, true) : "untimed"}</td>
              <td className="py-1 pr-3 font-mono tabular-nums">{c.to ? clock(c.to, true) : "untimed"}</td>
              <td className="py-1 font-mono tabular-nums">
                {delta(c)}
                {c.earlier ? <span className="ml-2 font-sans text-[10px] font-semibold uppercase tracking-widest text-amber-300">earlier</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface AdvancePreview {
  from: PhaseCode;
  next: PhaseCode | null;
  gate: string | null;
  paused: boolean;
  can_advance: boolean;
  refusal: string | null;
  open_round: number | null;
  pending_orders: number;
  changes: TimingChange[];
}

interface ChangePreview {
  changes: TimingChange[];
  shortens: boolean;
  warnings: string[];
  timing_version: number;
  /** What it previews: a duration edit, or an extension by N minutes. */
  what: { kind: "edit"; changes: TimingChanges } | { kind: "extend"; minutes: number };
}

/** Both trading phases are "Round 3: Invest" to teams; the panel tells them apart. */
function phaseLabel(code: PhaseCode): string {
  if (code === "MARKET_BLIND") return `${PHASE_LABELS[code]} (blind: rounds 1–2)`;
  if (code === "MARKET") return `${PHASE_LABELS[code]} (rounds 3–9)`;
  return PHASE_LABELS[code];
}

// ───────────── The panel ─────────────

export function TimingPanel({ eventId, organiser, rehearsal, status, phases, rounds, offsets, log, pendingOrders }: Props) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [advance, setAdvance] = useState<AdvancePreview | null>(null);
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [draft, setDraft] = useState<TimingDraft>({ phases: {}, rounds: {} });
  const [closeMode, setCloseMode] = useState<"CLEAR" | "CANCEL">("CLEAR");
  const [customMinutes, setCustomMinutes] = useState("");
  const now = useServerNow(500);
  const frozenNow = useDeadlineNow(500);

  const started = status.phase !== "SETUP";
  const ended = !!status.ended_at;
  const running = started && !ended;
  const current = phases.find((p) => p.code === status.phase);
  const version = status.timing_version;
  const openRound = rounds.find((r) => r.status === "OPEN");
  const trading = TRADING_PHASES.includes(status.phase);

  // A preview is about the times as they were: once anything changes (here or on another console) it is not shown.
  const [advanceAt, setAdvanceAt] = useState<number | null>(null);
  const advanceShown = advance && advanceAt === version && advance.from === status.phase ? advance : null;
  const previewShown = preview && preview.timing_version === version ? preview : null;

  const run = (fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) =>
    startBusy(async () => {
      let r: ActionResult;
      try {
        r = await fn();
      } catch {
        r = { ok: false, code: "ERROR", message: "The server did not answer. Nothing may have changed: check the page." };
      }
      setResult(r);
      after?.(r);
      router.refresh();
    });

  const asChanges = (r: ActionResult) => (r.data?.changes as TimingChange[] | undefined) ?? [];

  // ── Ending the phase (or starting the night): preview first, then the confirmed action. ──
  const askAdvance = () =>
    run(
      () => act.previewAdvance(eventId, status.phase),
      (r) => {
        setAdvance(r.ok ? (r.data as unknown as AdvancePreview) : null);
        setAdvanceAt(version);
      },
    );
  const doAdvance = () =>
    run(
      () => (status.phase === "SETUP" ? act.startEvent(eventId, version) : act.endPhase(eventId, status.phase)),
      (r) => r.ok && setAdvance(null),
    );

  // ── Durations: preview, then apply (a second click when anything comes earlier). ──
  const computed = draftChanges(draft, phases, rounds, offsets);
  const askPreview = () => {
    if (Object.keys(computed.errors).length > 0) return setResult({ ok: false, code: "CHECK", message: "Some durations are not valid: see the marked rows." });
    if (computed.count === 0) return setResult({ ok: false, code: "NOTHING", message: "Nothing to change: edit a duration first." });
    const changes = computed.changes;
    run(
      () => act.previewTiming(eventId, changes),
      (r) =>
        setPreview(
          r.ok
            ? {
                changes: asChanges(r),
                shortens: r.data?.shortens === true,
                warnings: (r.data?.warnings as string[] | null) ?? [],
                timing_version: r.data?.timing_version as number,
                what: { kind: "edit", changes },
              }
            : null,
        ),
    );
  };
  const askExtend = (minutes: number) => {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) return setResult({ ok: false, code: "BAD_MINUTES", message: "Extend by 1 to 120 minutes." });
    run(
      () => act.previewTiming(eventId, { extend_seconds: minutes * 60 }),
      (r) =>
        setPreview(
          r.ok
            ? { changes: asChanges(r), shortens: false, warnings: (r.data?.warnings as string[] | null) ?? [], timing_version: r.data?.timing_version as number, what: { kind: "extend", minutes } }
            : null,
        ),
    );
  };
  const apply = () => {
    if (!preview) return;
    const p = preview;
    run(
      () => (p.what.kind === "extend" ? act.extend(eventId, p.what.minutes, p.timing_version) : act.applyTiming(eventId, p.timing_version, p.what.changes, p.shortens)),
      (r) => {
        if (r.ok) {
          setPreview(null);
          if (p.what.kind === "edit") setDraft({ phases: {}, rounds: {} });
        } else if (r.code === "CONFIRM") {
          // Something moved meanwhile and now brings a time earlier: show the new preview and ask again.
          setPreview({ ...p, changes: asChanges(r), shortens: true });
        } else setPreview(null);
      },
    );
  };

  const phaseElapsed = elapsedMs(current, frozenNow);
  const remaining = status.phase_ends_at ? Date.parse(status.phase_ends_at) - frozenNow : null;
  const nightElapsed = status.started_at ? (status.ended_at ? Date.parse(status.ended_at) : now) - Date.parse(status.started_at) : null;
  const segments = timelineSegments(phases, rounds, status.phase, frozenNow);
  const timedTotal = segments.reduce((s, x) => s + (x.seconds ?? 0), 0);
  const untimedWidth = Math.max(timedTotal * 0.06, 60);
  const state = ended ? "ENDED" : !started ? "NOT STARTED" : status.paused ? "PAUSED" : "RUNNING";

  const edit = (key: "phases" | "rounds", id: string, value: string | null) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], [id]: value } }));
  /** Untimed: ticked in the draft, or untimed in the database and not changed. */
  const isUntimed = (p: PhaseTiming) => (p.code in draft.phases ? draft.phases[p.code] === null : p.duration_seconds === null);
  const phaseValue = (p: PhaseTiming) => (isUntimed(p) ? "" : (draft.phases[p.code] ?? toMinutes(p.duration_seconds)));
  const roundValue = (r: Round) => draft.rounds[String(r.number)] ?? toMinutes(r.duration_seconds);

  return (
    <div className="mx-root" data-testid="timing-panel">
      <div className="mx-rain" aria-hidden />
      <div className="relative space-y-5">
        {/* ── The readout ── */}
        <Frame
          title="Event timing"
          aside={
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`mx-chip ${state === "RUNNING" ? "mx-chip-live" : state === "PAUSED" ? "mx-chip-warn" : ""}`}>{state}</span>
              <span className="mx-chip">{status.auto_advance ? "Advance when timer expires" : "Manual advance"}</span>
              {rehearsal ? <span className="mx-chip">Rehearsal</span> : null}
              <span className="mx-chip" title="Every change bumps the version; a console showing an older one is refused.">v{version}</span>
            </div>
          }
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 xl:grid-cols-6">
            <Readout label="Phase" value={<span className="text-lg">{PHASE_LABELS[status.phase]}</span>} hint={status.phase_started_at && started ? `started ${clock(status.phase_started_at)}` : "the night has not started"} />
            <Readout label="Elapsed" value={span(phaseElapsed)} hint={current?.paused_seconds ? `paused ${span(current.paused_seconds * 1000)} so far` : "in this phase"} />
            <Readout
              label="Remaining"
              tone={remaining !== null && remaining <= 60_000 ? "warn" : status.phase_ends_at ? "on" : "dim"}
              value={ended ? "—" : status.phase_ends_at ? (remaining! > 0 ? span(remaining) : "0:00") : status.phase_untimed ? "untimed" : started ? "—" : "—"}
              hint={
                status.paused
                  ? `frozen: paused at ${clock(status.paused_at)}`
                  : status.phase_untimed
                    ? "until you end it"
                    : trading
                      ? "until the last round closes"
                      : remaining !== null && remaining <= 0
                        ? status.auto_advance
                          ? "advancing…"
                          : "time is up: waiting for you"
                        : undefined
              }
            />
            <Readout label="Phase ends" value={status.phase_ends_at ? clock(status.phase_ends_at, true) : "—"} hint={status.next_phase ? `then ${PHASE_LABELS[status.next_phase]}` : undefined} />
            <Readout label="Night" value={span(nightElapsed)} hint={status.started_at ? `started ${clock(status.started_at)}` : "starts when you start it"} />
            <Readout
              label="Projected end"
              value={ended ? clock(status.ended_at) : status.event_ends_at ? clock(status.event_ends_at) : "open"}
              hint={ended ? "the night has ended" : status.event_ends_after ? `unknown after ${PHASE_LABELS[status.event_ends_after]} (untimed)` : undefined}
            />
          </div>
          {status.open_round ? (
            <p className="mt-4 text-sm">
              <span className="mx-pulse" aria-hidden /> Round {status.open_round.number} open · closes {clock(status.open_round.closes_at, true)}
            </p>
          ) : status.next_round ? (
            <p className="mt-4 text-sm text-emerald-400">Round {status.next_round.number} opens {clock(status.next_round.opens_at, true)}</p>
          ) : null}
          {status.gate && started && !ended ? <p className="mt-3 text-sm text-amber-300">Holding: {status.gate}</p> : null}
        </Frame>

        {/* ── The timeline ── */}
        <Frame title="Timeline">
          <div className="flex h-14 w-full overflow-hidden rounded border border-emerald-500/30" role="list" aria-label="Phases">
            {segments.map((s) => (
              <div
                key={s.code}
                role="listitem"
                title={`${s.label}: ${s.seconds === null ? "untimed" : span(s.seconds * 1000)}`}
                className={`mx-seg ${s.state === "current" ? "mx-seg-current" : s.state === "done" ? "mx-seg-done" : ""} ${s.seconds === null ? "mx-seg-untimed" : ""}`}
                style={{ flexGrow: s.seconds ?? untimedWidth, flexBasis: 0 }}
              >
                {s.state === "current" ? <div className="mx-seg-progress" style={{ width: `${Math.round(s.progress * 100)}%` }} /> : null}
                <span className="relative z-10 truncate px-1 text-[10px] leading-tight">{s.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-emerald-500">
            <span><span className="mx-key mx-seg-done" /> done</span>
            <span><span className="mx-key mx-seg-current" /> now</span>
            <span><span className="mx-key" /> ahead</span>
            <span><span className="mx-key mx-seg-untimed" /> untimed: ends when you end it</span>
          </div>
        </Frame>

        {organiser ? (
          <div className="grid gap-5 xl:grid-cols-2">
            {/* ── The controls ── */}
            <Frame title="Controls">
              <div className="flex flex-wrap gap-2">
                {!started ? (
                  <MButton tone="primary" onRun={askAdvance} busy={busy} title="Shows what starts and every time that follows">
                    Start the night…
                  </MButton>
                ) : !ended && status.next_phase ? (
                  <MButton tone="primary" onRun={askAdvance} busy={busy} title="Shows the next phase, what holds it and the times that move">
                    End {PHASE_LABELS[status.phase]}…
                  </MButton>
                ) : null}
                {running ? (
                  status.paused ? (
                    <MButton tone="primary" onRun={() => run(() => act.resume(eventId))} confirm="Click again to resume (tell the room first)" busy={busy}>
                      Resume
                    </MButton>
                  ) : (
                    <MButton onRun={() => run(() => act.pause(eventId))} confirm="Click again: freeze every countdown" busy={busy}>
                      Pause
                    </MButton>
                  )
                ) : null}
                {status.phase === "AWARDS" && !ended ? (
                  <MButton tone="danger" onRun={() => run(() => act.endEvent(eventId, version))} confirm="Click again: end the night for everyone" busy={busy}>
                    End the night
                  </MButton>
                ) : null}
              </div>

              {advanceShown ? (
                <div className="mx-inset mt-4" data-testid="advance-preview">
                  <p className="text-sm">
                    {advanceShown.from === "SETUP" ? "Starting the night" : `Ending ${PHASE_LABELS[advanceShown.from]}`} starts{" "}
                    <strong>{advanceShown.next ? PHASE_LABELS[advanceShown.next] : "nothing"}</strong> now.
                  </p>
                  {advanceShown.gate ? <p className="mt-1 text-sm text-amber-300">Requirement not met: {advanceShown.gate}</p> : null}
                  {advanceShown.paused ? <p className="mt-1 text-sm text-amber-300">Resume the event first.</p> : null}
                  {advanceShown.refusal && !advanceShown.gate ? <p className="mt-1 text-sm text-amber-300">{advanceShown.refusal}</p> : null}
                  {advanceShown.open_round ? (
                    <p className="mt-1 text-sm text-amber-200">
                      Round {advanceShown.open_round} is open: its {advanceShown.pending_orders} pending orders fill at its clearing price, and the rounds still ahead in this phase clear with unchanged prices.
                    </p>
                  ) : null}
                  <div className="mt-3">
                    <ChangesTable changes={advanceShown.changes} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <MButton
                      tone="primary"
                      disabled={!advanceShown.can_advance}
                      busy={busy}
                      onRun={doAdvance}
                      confirm={advanceShown.from === "SETUP" ? "Click again: start the night now" : `Click again: end ${PHASE_LABELS[advanceShown.from]} now`}
                    >
                      {advanceShown.from === "SETUP" ? "Start now" : `End ${PHASE_LABELS[advanceShown.from]} now`}
                    </MButton>
                    <MButton onRun={() => setAdvance(null)}>Cancel</MButton>
                  </div>
                </div>
              ) : null}

              {running ? (
                <div className="mt-5 border-t border-emerald-500/20 pt-4">
                  <h3 className="mx-sub">Extend {openRound ? `round ${openRound.number}` : "this phase"}</h3>
                  <p className="text-xs text-emerald-500">Never earlier: it and everything after it move later. You see the new times first.</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {[1, 5, 10, 15].map((m) => (
                      <MButton key={m} onRun={() => askExtend(m)} busy={busy} disabled={status.phase_untimed || (trading && !openRound)}>
                        +{m} min
                      </MButton>
                    ))}
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        value={customMinutes}
                        onChange={(e) => setCustomMinutes(e.target.value)}
                        inputMode="numeric"
                        placeholder="min"
                        aria-label="Extend by minutes"
                        className="mx-input w-20"
                      />
                    </label>
                    <MButton onRun={() => askExtend(Number(customMinutes))} busy={busy} disabled={!customMinutes}>
                      Preview
                    </MButton>
                  </div>
                  {status.phase_untimed ? <p className="mt-1 text-xs text-emerald-600">This phase is untimed: it stays open until you end it.</p> : null}
                </div>
              ) : null}

              {!ended ? (
                <div className="mt-5 border-t border-emerald-500/20 pt-4">
                  <h3 className="mx-sub">When a phase&apos;s time is up</h3>
                  <div className="mt-2 inline-flex rounded border border-emerald-500/40 p-0.5" role="radiogroup" aria-label="Advance mode">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!status.auto_advance}
                      onClick={() => status.auto_advance && run(() => act.setMode(eventId, false))}
                      className={`mx-seg-btn ${!status.auto_advance ? "mx-seg-btn-on" : ""}`}
                    >
                      Manual advance
                    </button>
                    <ModeAuto on={status.auto_advance} overdue={remaining !== null && remaining <= 0 && !!status.next_phase} run={(advanceNow) => run(() => act.setMode(eventId, true, advanceNow))} />
                  </div>
                  <p className="mt-1 text-xs text-emerald-500">
                    In both, a timer that runs out still closes its form or round. Manual: the next phase waits for you. An untimed phase always waits.
                  </p>
                </div>
              ) : null}
              <Result result={result} />
            </Frame>

            {/* ── The preview of a change ── */}
            <Frame title="Preview" aside={previewShown ? <span className="mx-chip">v{previewShown.timing_version}</span> : null}>
              {previewShown ? (
                <div data-testid="timing-preview">
                  <p className="mb-2 text-sm">
                    {previewShown.what.kind === "extend" ? `Extend by ${previewShown.what.minutes} min:` : "Your changes:"}{" "}
                    {previewShown.shortens ? <span className="text-amber-300">brings {previewShown.changes.filter((c) => c.earlier).length} times earlier.</span> : "nothing comes earlier."}
                  </p>
                  <ChangesTable changes={previewShown.changes} />
                  {previewShown.warnings.map((w) => (
                    <p key={w} className="mt-2 text-sm text-amber-300">
                      {w}
                    </p>
                  ))}
                  <p className="mt-2 text-xs text-emerald-500">Teams are told which of their deadlines moved, from what to what.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <MButton
                      tone="primary"
                      busy={busy}
                      onRun={apply}
                      confirm={previewShown.shortens ? `Click again: bring ${previewShown.changes.filter((c) => c.earlier).length} times earlier` : `Click again to apply`}
                    >
                      Apply
                    </MButton>
                    <MButton onRun={() => setPreview(null)}>Discard</MButton>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-emerald-500">Edit durations below, or choose an extension: the times that would move show here before anything changes.</p>
              )}
            </Frame>
          </div>
        ) : (
          <p className="mx-frame p-4 text-sm">The fairness officer can follow the timing here; only organisers change it.</p>
        )}

        {/* ── Durations ── */}
        <Frame
          title="Phases and rounds"
          aside={
            organiser && computed.count > 0 ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-emerald-400">{computed.count} edited</span>
                <MButton onRun={() => setDraft({ phases: {}, rounds: {} })}>Reset</MButton>
                <MButton tone="primary" onRun={askPreview} busy={busy}>
                  Preview changes
                </MButton>
              </div>
            ) : null
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-widest text-emerald-500/80">
                <tr>
                  <th className="py-1 pr-3 font-normal">Phase</th>
                  <th className="hidden py-1 pr-3 font-normal sm:table-cell">Starts</th>
                  <th className="py-1 pr-3 font-normal">Ends</th>
                  <th className="py-1 pr-3 font-normal">Min</th>
                  <th className="py-1 font-normal">Untimed</th>
                </tr>
              </thead>
              <tbody>
                {phases
                  .filter((p) => p.code !== "SETUP")
                  .map((p) => {
                    const isCurrent = p.code === status.phase && !ended;
                    const done = !!p.ended_at;
                    const editable = organiser && !done && !FIXED_PHASES.includes(p.code) && !ended;
                    const value = phaseValue(p);
                    const untimed = isUntimed(p);
                    const err = computed.errors[`phase:${p.code}`];
                    const rowRounds = rounds.filter((r) => r.phase === p.code);
                    return (
                      <PhaseRows key={p.code}>
                        <tr className={`border-t border-emerald-500/10 ${isCurrent ? "mx-row-current" : done ? "text-emerald-700" : ""}`}>
                          <td className="py-1.5 pr-3">
                            {isCurrent ? "▶ " : done ? "✓ " : ""}
                            {phaseLabel(p.code)}
                          </td>
                          <td className="hidden py-1.5 pr-3 font-mono tabular-nums sm:table-cell">{clock(p.started_at ?? p.starts_at)}</td>
                          <td className="py-1.5 pr-3 font-mono tabular-nums">
                            {clock(p.ended_at ?? p.ends_at)}
                            {!done && (p.paused_seconds > 0 || p.extended_seconds > 0) ? (
                              <span className="ml-1 hidden text-[10px] text-emerald-500 md:inline">
                                {p.paused_seconds > 0 ? `+${span(p.paused_seconds * 1000)} paused` : ""} {p.extended_seconds > 0 ? `+${toMinutes(p.extended_seconds)}m ext` : ""}
                              </span>
                            ) : null}
                          </td>
                          <td className="py-1.5 pr-3">
                            {TRADING_PHASES.includes(p.code) ? (
                              <span className="text-emerald-500">its rounds</span>
                            ) : done ? (
                              <span className="font-mono" title="How long it actually ran">{p.started_at && p.ended_at ? `ran ${span(Date.parse(p.ended_at) - Date.parse(p.started_at))}` : "—"}</span>
                            ) : editable ? (
                              <>
                                <input
                                  value={value}
                                  disabled={untimed}
                                  onChange={(e) => edit("phases", p.code, e.target.value)}
                                  inputMode="decimal"
                                  aria-label={`${PHASE_LABELS[p.code]} duration in minutes`}
                                  aria-invalid={!!err}
                                  className={`mx-input w-16 sm:w-24 ${draft.phases[p.code] !== undefined ? "mx-input-edited" : ""}`}
                                  placeholder={untimed ? "untimed" : undefined}
                                />
                                {err ? <span className="ml-2 text-xs text-amber-300">{err}</span> : null}
                              </>
                            ) : (
                              <span className="font-mono">{p.duration_seconds === null ? "untimed" : toMinutes(p.duration_seconds)}</span>
                            )}
                          </td>
                          <td className="py-1.5">
                            {editable ? (
                              <input
                                type="checkbox"
                                checked={untimed}
                                aria-label={`${PHASE_LABELS[p.code]} untimed`}
                                onChange={(e) => edit("phases", p.code, e.target.checked ? null : toMinutes(p.duration_seconds ?? 1800))}
                                className="accent-emerald-500"
                              />
                            ) : p.code === "AWARDS" && p.duration_seconds === null ? (
                              <span className="text-xs text-emerald-500">ends with the night</span>
                            ) : null}
                          </td>
                        </tr>
                        {rowRounds.map((r) => {
                          const rDone = r.status === "CLEARED" || r.status === "CLOSED";
                          const rEdit = organiser && !rDone && !ended;
                          const rErr = computed.errors[`round:${r.number}`];
                          return (
                            <tr key={`r${r.number}`} className={`text-[13px] ${r.status === "OPEN" ? "mx-row-current" : rDone ? "text-emerald-700" : "text-emerald-300/90"}`}>
                              <td className="py-1 pl-4 pr-3 sm:pl-6">
                                {r.status === "OPEN" ? <span className="mx-pulse" aria-hidden /> : rDone ? "✓ " : "· "}Round {r.number}
                              </td>
                              <td className="hidden py-1 pr-3 font-mono tabular-nums sm:table-cell">{clock(r.opened_at ?? r.opens_at)}</td>
                              <td className="py-1 pr-3 font-mono tabular-nums">{clock(r.closed_at ?? r.closes_at)}</td>
                              <td className="py-1 pr-3">
                                {rEdit ? (
                                  <>
                                    <input
                                      value={roundValue(r)}
                                      onChange={(e) => edit("rounds", String(r.number), e.target.value)}
                                      inputMode="decimal"
                                      aria-label={`Round ${r.number} duration in minutes`}
                                      aria-invalid={!!rErr}
                                      className={`mx-input w-16 sm:w-20 ${draft.rounds[String(r.number)] !== undefined ? "mx-input-edited" : ""}`}
                                    />
                                    {rErr ? <span className="ml-2 text-xs text-amber-300">{rErr}</span> : null}
                                  </>
                                ) : (
                                  <span className="font-mono">{toMinutes(r.duration_seconds)}</span>
                                )}
                              </td>
                              <td className="py-1 text-xs text-emerald-600">{r.status.toLowerCase()}</td>
                            </tr>
                          );
                        })}
                      </PhaseRows>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid gap-3 border-t border-emerald-500/20 pt-4 sm:grid-cols-2">
            <Offset
              label="The twist: minutes after Build starts"
              value={draft.twist ?? toMinutes(offsets.twist_offset_seconds)}
              edited={draft.twist !== undefined}
              error={computed.errors.twist}
              disabled={!organiser || ended || !!phases.find((p) => p.code === "BUILD")?.ended_at}
              onChange={(v) => setDraft((d) => ({ ...d, twist: v }))}
            />
            <Offset
              label="Leaderboard freeze: minutes after Market starts"
              value={draft.freeze ?? toMinutes(offsets.freeze_offset_seconds)}
              edited={draft.freeze !== undefined}
              error={computed.errors.freeze}
              disabled={!organiser || ended || !!status.leaderboard_frozen}
              onChange={(v) => setDraft((d) => ({ ...d, freeze: v }))}
            />
          </div>
        </Frame>

        <div className="grid gap-5 xl:grid-cols-2">
          {/* ── Closing a round early ── */}
          <Frame title="Close a round early">
            {openRound ? (
              <>
                <p className="text-sm">
                  Round {openRound.number} is open until {clock(openRound.closes_at, true)} with <strong>{pendingOrders}</strong> pending{" "}
                  {pendingOrders === 1 ? "order" : "orders"}. Closing it starts the rounds after it from now.
                </p>
                {organiser ? (
                  <>
                    <fieldset className="mt-3 space-y-2 text-sm">
                      <legend className="sr-only">What happens to the pending orders</legend>
                      <label className="flex items-start gap-2">
                        <input type="radio" name="close-mode" checked={closeMode === "CLEAR"} onChange={() => setCloseMode("CLEAR")} className="mt-1 accent-emerald-500" />
                        <span>
                          <strong>Close and clear</strong>: every pending order fills at the round&apos;s clearing price, as at its normal close.
                        </span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input type="radio" name="close-mode" checked={closeMode === "CANCEL"} onChange={() => setCloseMode("CANCEL")} className="mt-1 accent-emerald-500" />
                        <span>
                          <strong>Close and cancel</strong>: every pending order is cancelled; nothing is bought or sold, and the round clears as if none had been placed.
                        </span>
                      </label>
                    </fieldset>
                    <div className="mt-3">
                      <MButton
                        tone="danger"
                        busy={busy}
                        onRun={() => run(() => act.closeRound(eventId, openRound.number, closeMode))}
                        confirm={closeMode === "CLEAR" ? `Click again: clear round ${openRound.number} now (${pendingOrders} fill)` : `Click again: cancel ${pendingOrders} orders, close round ${openRound.number}`}
                      >
                        Close round {openRound.number} now
                      </MButton>
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-emerald-500">No round is open.</p>
            )}
          </Frame>

          {/* ── The log ── */}
          <Frame title="Timing log">
            {log.length === 0 ? (
              <p className="text-sm text-emerald-500">No timing change yet.</p>
            ) : (
              <ol className="max-h-80 space-y-1.5 overflow-y-auto pr-1 text-sm">
                {log.map((e, i) => {
                  const moved = e.after?.changes?.length ?? 0;
                  return (
                    <li key={`${e.at}-${i}`} className="flex gap-3">
                      <span className="shrink-0 font-mono text-xs tabular-nums text-emerald-500">{clock(e.at, true)}</span>
                      <span className="min-w-0">
                        {logSummary(e)}
                        <span className="text-xs text-emerald-600">
                          {" "}
                          · {e.actor_role === "ORGANISER" ? "organiser" : (e.actor_role?.toLowerCase() ?? "system")}
                          {moved ? ` · ${moved} ${moved === 1 ? "time" : "times"} moved` : ""}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Frame>
        </div>
      </div>
    </div>
  );
}

function PhaseRows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function Offset({
  label,
  value,
  edited,
  error,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  edited: boolean;
  error?: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs text-emerald-400">{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className={`mx-input w-24 ${edited ? "mx-input-edited" : ""}`} />
        {error ? <span className="text-xs text-amber-300">{error}</span> : null}
      </span>
    </label>
  );
}

/** "Advance when timer expires": turning it on when the phase's time is already up advances at once, so it asks. */
function ModeAuto({ on, overdue, run }: { on: boolean; overdue: boolean; run: (advanceNow: boolean) => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={() => {
        if (on) return;
        if (overdue && !armed) return setArmed(true);
        setArmed(false);
        run(overdue);
      }}
      className={`mx-seg-btn ${on ? "mx-seg-btn-on" : ""} ${armed ? "mx-btn-danger" : ""}`}
    >
      {armed ? "Click again: time is up, this advances now" : "Advance when timer expires"}
    </button>
  );
}
