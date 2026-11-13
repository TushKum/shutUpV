import type { ReactNode } from "react";
import { PHASE_LABELS, type PhaseCode, type Track } from "@msim/engine";
import { Countdown } from "@/components/ui/countdown";
import { STEPS, jobFor, stageInfo, stageOf, type EventFormat, type Stage } from "@/lib/team/focus";
import { crisisHeadline, type CrisisStep } from "@/lib/team/crisis-steps";
import { PhaseEnd } from "./phase-end";
import { BannerFrame } from "./banner-frame";
import { CrisisSteps } from "./crisis-steps";
import { CrisisWhat } from "./crisis-what";
import { CipherText } from "@/components/ui/matrix/cipher-text";
import { ThermalScan } from "@/components/ui/matrix/thermal-scan";
import { Glyph } from "@/components/ui/matrix/glyph";

const ROUND_STAGES: Stage[] = ["ROUND_1", "ROUND_2", "ROUND_3"];

/** A PRIMUS event's crisis under way (Round 2: 1–4; Round 3: 5) and its steps for this track. */
export interface CrisisNow {
  k: number | null;
  steps: CrisisStep[];
}

// The banner at the top of every team screen: which round it is (1, 2 or 3), the step of the night in plain words,
// the time left, the team's own job in one line, and the trading round when one is open. In a PRIMUS event's Rounds 2
// and 3 it also shows the steps of the crisis under way, with the one that is on now. Home shows it big; every other
// page shows one line (and the steps), so the page's own work starts near the top.
export function RoundBanner({
  track,
  phase,
  endsAt,
  gate,
  next,
  openRound,
  format = "CLASSIC",
  crisis = null,
}: {
  track: Track;
  phase: PhaseCode;
  endsAt: string | null;
  gate: string | null;
  next: PhaseCode | null;
  openRound: { number: number; closes_at: string } | null;
  format?: EventFormat;
  crisis?: CrisisNow | null;
}) {
  const stage = stageOf(phase);
  const info = stageInfo(stage, format);
  const primusRound = format === "PRIMUS" && (phase === "PRESSURE" || phase === "SATURATION");
  const step = primusRound ? crisisHeadline(phase, crisis?.k ?? null, null) : STEPS[phase];
  const steps = primusRound ? (crisis?.steps ?? []) : [];
  const at = ROUND_STAGES.indexOf(stage);
  const danger = stage === "ROUND_2";
  const done = (i: number) => i < at || stage === "RESULTS";
  const label = info.round ? `Round ${info.round} of 3 · ${info.title}` : info.title;
  const what: ReactNode = primusRound ? <CrisisWhat phase={phase} k={crisis?.k ?? null} steps={steps} /> : step.what;
  const stepsLabel = primusRound && crisis?.k ? (crisis.k === 5 ? "Steps of Round 3" : `Steps of crisis ${crisis.k}`) : "Steps";
  const trading = openRound ? (
    <p
      className="mx-accent-callout rounded-2xl border px-4 py-2.5 font-mono text-sm font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
      data-testid="open-round"
    >
      <Glyph e="📈" spoken /> Trading round {openRound.number} · <Countdown to={openRound.closes_at} passed="clearing" className="tabular-nums" /> left
    </p>
  ) : null;

  const full = (
    <section aria-label="Where we are" className="relative" data-testid="round-banner">
      <div className="mx-auto max-w-5xl px-3 pt-4 pb-2 sm:px-4 sm:pt-5">
        {/* The scan runs once when the round changes (the key), as the crisis reveal does. */}
        <ThermalScan
          key={stage}
          active={danger}
          className={`mx-team-hero-card px-5 py-5 sm:px-6 ${danger ? "mx-team-hero-card--danger" : ""}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`font-mono text-xs font-semibold uppercase tracking-[0.14em] ${danger ? "text-rose-300" : "mx-accent-bright opacity-90"}`} data-testid="round-label">
              {label}
            </p>
            <ol className="flex items-center gap-1.5 font-mono" aria-label="Rounds">
              {ROUND_STAGES.map((r, i) => (
                <li
                  key={r}
                  aria-current={i === at ? "step" : undefined}
                  className={`grid h-7 min-w-7 place-items-center rounded-full border px-2 text-xs font-bold ${
                    i === at
                      ? "mx-accent-badge-solid"
                      : done(i)
                        ? "mx-accent-chip"
                        : "border-white/12 bg-white/[0.04] text-slate-400"
                  }`}
                >
                  {done(i) ? "✓" : i + 1}
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-3 flex items-start gap-3.5 sm:gap-4">
            <span
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl border text-2xl sm:h-14 sm:w-14 sm:text-3xl ${
                danger
                  ? "border-rose-400/35 bg-rose-500/12 text-rose-300"
                  : "mx-accent-text border-white/15 bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
              }`}
              aria-hidden
            >
              <Glyph e={info.emoji} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className={`text-2xl font-bold leading-tight sm:text-3xl ${danger ? "text-rose-200 [--mx-cipher-color:var(--mx-red)]" : "text-white"}`}>
                <CipherText text={step.name} duration={800} />
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-300 sm:text-base">{what}</p>
              <p className={`mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold ${danger ? "text-rose-300" : "mx-accent-text"}`} data-testid="team-phase">
                <Glyph e="⏱" spoken /> {PHASE_LABELS[phase]}
                <PhaseEnd endsAt={endsAt} phase={phase} gate={gate} next={next} className="ml-1 font-semibold" />
              </p>
            </div>
          </div>
          {steps.length ? (
            <div className="mt-3.5">
              <CrisisSteps steps={steps} label={stepsLabel} danger={danger} />
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2.5">
            <p
              className="flex-1 rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] sm:text-base"
              data-testid="your-job"
            >
              <span className="mx-accent-text mr-1.5" aria-hidden>
                <Glyph e="🎯" />
              </span>
              Your job: {jobFor(track, stage, format)}
            </p>
            {trading}
          </div>
        </ThermalScan>
      </div>
    </section>
  );

  const compact = (
    <section aria-label="Where we are" className={`mx-team-compact-banner ${danger ? "mx-team-compact-banner--danger" : ""}`} data-testid="round-banner">
      <div className="mx-auto max-w-5xl space-y-2 px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className={`font-mono text-xs font-semibold uppercase tracking-[0.12em] ${danger ? "text-rose-300" : "mx-accent-bright opacity-90"}`} data-testid="round-label">
            {label}
          </p>
          <h2 className={`text-base font-bold ${danger ? "text-rose-200" : "text-white"}`}>{step.name}</h2>
          <p className="text-sm font-medium text-slate-300" data-testid="team-phase">
            <Glyph e="⏱" spoken /> {PHASE_LABELS[phase]}
            <PhaseEnd endsAt={endsAt} phase={phase} gate={gate} next={next} className="mx-accent-text ml-1 font-semibold" />
          </p>
          {openRound ? (
            <p className="mx-accent-text ml-auto whitespace-nowrap font-mono text-sm font-semibold" data-testid="open-round">
              <Glyph e="📈" spoken /> Trading round {openRound.number} · <Countdown to={openRound.closes_at} passed="clearing" className="tabular-nums" /> left
            </p>
          ) : null}
        </div>
        {steps.length ? <CrisisSteps steps={steps} label={stepsLabel} danger={danger} /> : null}
      </div>
    </section>
  );

  return <BannerFrame full={full} compact={compact} />;
}
