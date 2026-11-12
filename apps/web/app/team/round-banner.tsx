import type { ReactNode } from "react";
import { PHASE_LABELS, type PhaseCode, type Track } from "@msim/engine";
import { Countdown } from "@/components/ui/countdown";
import { STEPS, jobFor, stageInfo, stageOf, type EventFormat, type Stage } from "@/lib/team/focus";
import { crisisHeadline, type CrisisStep } from "@/lib/team/crisis-steps";
import { PhaseEnd } from "./phase-end";
import { BannerFrame } from "./banner-frame";
import { CrisisSteps } from "./crisis-steps";
import { CrisisWhat } from "./crisis-what";
import { MatrixRain } from "@/components/ui/matrix/matrix-rain";
import { CipherText } from "@/components/ui/matrix/cipher-text";
import { DitherLayer } from "@/components/ui/matrix/dither-layer";
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
    <p className="rounded-xl border border-phosphor bg-ink px-3 py-2 font-mono text-sm font-bold text-phosphor glow-box" data-testid="open-round">
      <Glyph e="📈" spoken /> Trading round {openRound.number} · <Countdown to={openRound.closes_at} passed="clearing" className="tabular-nums" /> left
    </p>
  ) : null;

  const full = (
    <section aria-label="Where we are" className="relative overflow-hidden border-b border-line bg-ink" data-testid="round-banner">
      {/* Backdrop only: the rain and a dithered fade. Everything to read is in the opaque card above them. */}
      <MatrixRain opacity={0.3} size={14} />
      <DitherLayer from="bottom" tone={danger ? "red" : "green"} opacity={0.35} />
      <div className="relative mx-auto max-w-5xl px-3 py-3 sm:px-4 sm:py-5">
        {/* The scan runs once when the round changes (the key), as the crisis reveal does. */}
        <ThermalScan key={stage} active={danger} className={`mx-panel rounded-xl px-4 py-4 sm:mr-24 ${danger ? "border-danger glow-danger" : "glow-box"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`font-mono text-xs font-bold uppercase tracking-widest ${danger ? "text-danger-soft" : "text-phosphor-mid"}`} data-testid="round-label">
              {label}
            </p>
            <ol className="flex items-center gap-1.5 font-mono" aria-label="Rounds">
              {ROUND_STAGES.map((r, i) => (
                <li
                  key={r}
                  aria-current={i === at ? "step" : undefined}
                  className={`grid h-7 min-w-7 place-items-center rounded-md border px-2 text-xs font-extrabold ${
                    i === at ? "border-phosphor bg-phosphor text-ink glow-box" : done(i) ? "border-phosphor-dim text-phosphor" : "border-line text-muted"
                  }`}
                >
                  {done(i) ? "✓" : i + 1}
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-2 flex items-start gap-3 sm:gap-4">
            <span className={`text-4xl leading-none sm:text-5xl ${danger ? "text-danger" : "text-phosphor"}`} aria-hidden>
              <Glyph e={info.emoji} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className={`text-2xl font-extrabold leading-tight sm:text-3xl ${danger ? "text-danger [--mx-cipher-color:var(--mx-red)]" : "text-phosphor glow"}`}>
                <CipherText text={step.name} duration={800} />
              </h2>
              <p className="mt-0.5 text-base text-paper">{what}</p>
              <p className="mt-1 text-sm font-semibold text-phosphor" data-testid="team-phase">
                <Glyph e="⏱" spoken /> {PHASE_LABELS[phase]}
                <PhaseEnd endsAt={endsAt} phase={phase} gate={gate} next={next} className="ml-1 font-semibold text-phosphor" />
              </p>
            </div>
          </div>
          {steps.length ? (
            <div className="mt-3">
              <CrisisSteps steps={steps} label={stepsLabel} danger={danger} />
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <p className="flex-1 rounded-xl border border-line bg-ink px-3 py-2 text-base font-semibold text-paper" data-testid="your-job">
              <span className="mr-1 text-phosphor" aria-hidden>
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
    <section aria-label="Where we are" className={`border-b bg-ink ${danger ? "border-danger/60" : "border-line"}`} data-testid="round-banner">
      <div className="mx-auto max-w-5xl space-y-2 px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className={`font-mono text-xs font-bold uppercase tracking-widest ${danger ? "text-danger-soft" : "text-phosphor-mid"}`} data-testid="round-label">
            {label}
          </p>
          <h2 className={`text-base font-extrabold ${danger ? "text-danger" : "text-phosphor"}`}>{step.name}</h2>
          <p className="text-sm font-semibold text-paper" data-testid="team-phase">
            <Glyph e="⏱" spoken /> {PHASE_LABELS[phase]}
            <PhaseEnd endsAt={endsAt} phase={phase} gate={gate} next={next} className="ml-1 font-semibold text-phosphor" />
          </p>
          {openRound ? (
            <p className="ml-auto whitespace-nowrap font-mono text-sm font-bold text-phosphor" data-testid="open-round">
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
