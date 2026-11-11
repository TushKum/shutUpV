import { PHASE_LABELS, type PhaseCode, type Track } from "@msim/engine";
import { Countdown } from "@/components/ui/countdown";
import { JOB, STAGES, STEPS, stageOf, type Stage } from "@/lib/team/focus";
import { PhaseEnd } from "./phase-end";
import { MatrixRain } from "@/components/ui/matrix/matrix-rain";
import { CipherText } from "@/components/ui/matrix/cipher-text";
import { DitherLayer } from "@/components/ui/matrix/dither-layer";
import { ThermalScan } from "@/components/ui/matrix/thermal-scan";
import { Glyph } from "@/components/ui/matrix/glyph";

const ROUND_STAGES: Stage[] = ["ROUND_1", "ROUND_2", "ROUND_3"];

// The big banner at the top of every team screen: which round it is (1, 2 or 3), the step of the night in plain
// words, the time left, the team's own job in one line, and the trading round when one is open.
export function RoundBanner({
  track,
  phase,
  endsAt,
  gate,
  next,
  openRound,
}: {
  track: Track;
  phase: PhaseCode;
  endsAt: string | null;
  gate: string | null;
  next: PhaseCode | null;
  openRound: { number: number; closes_at: string } | null;
}) {
  const stage = stageOf(phase);
  const info = STAGES[stage];
  const step = STEPS[phase];
  const at = ROUND_STAGES.indexOf(stage);
  const crisis = stage === "ROUND_2";
  const done = (i: number) => i < at || stage === "RESULTS";
  return (
    <section aria-label="Where we are" className="relative overflow-hidden border-b border-line bg-ink" data-testid="round-banner">
      {/* Backdrop only: the rain and a dithered fade. Everything to read is in the opaque card above them. */}
      <MatrixRain opacity={0.3} size={14} />
      <DitherLayer from="bottom" tone={crisis ? "red" : "green"} opacity={0.35} />
      <div className="relative mx-auto max-w-5xl px-3 py-3 sm:px-4 sm:py-5">
        {/* The scan runs once when the round changes (the key), as the crisis reveal does. */}
        <ThermalScan key={stage} active={crisis} className={`mx-panel rounded-xl px-4 py-4 sm:mr-24 ${crisis ? "border-danger glow-danger" : "glow-box"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`font-mono text-xs font-bold uppercase tracking-widest ${crisis ? "text-danger-soft" : "text-phosphor-mid"}`} data-testid="round-label">
              {info.round ? `Round ${info.round} of 3 · ${info.title}` : info.title}
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
            <span className={`text-4xl leading-none sm:text-5xl ${crisis ? "text-danger" : "text-phosphor"}`} aria-hidden>
              <Glyph e={info.emoji} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className={`text-2xl font-extrabold leading-tight sm:text-3xl ${crisis ? "text-danger [--mx-cipher-color:var(--mx-red)]" : "text-phosphor glow"}`}>
                <CipherText text={step.name} duration={800} />
              </h2>
              <p className="mt-0.5 text-base text-paper">{step.what}</p>
              <p className="mt-1 text-sm font-semibold text-phosphor" data-testid="team-phase">
                <Glyph e="⏱" spoken /> {PHASE_LABELS[phase]}
                <PhaseEnd endsAt={endsAt} phase={phase} gate={gate} next={next} className="ml-1 font-semibold text-phosphor" />
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <p className="flex-1 rounded-xl border border-line bg-ink px-3 py-2 text-base font-semibold text-paper" data-testid="your-job">
              <span className="mr-1 text-phosphor" aria-hidden>
                <Glyph e="🎯" />
              </span>
              Your job: {JOB[track][stage]}
            </p>
            {openRound ? (
              <p className="rounded-xl border border-phosphor bg-ink px-3 py-2 font-mono text-sm font-bold text-phosphor glow-box" data-testid="open-round">
                <Glyph e="📈" spoken /> Trading round {openRound.number} · <Countdown to={openRound.closes_at} passed="clearing" className="tabular-nums" /> left
              </p>
            ) : null}
          </div>
        </ThermalScan>
      </div>
    </section>
  );
}
