import { PHASE_LABELS, type PhaseCode, type Track } from "@msim/engine";
import { Countdown } from "@/components/ui/countdown";
import { JOB, STAGES, STEPS, stageOf, type Stage } from "@/lib/team/focus";
import { PhaseEnd } from "./phase-end";

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
  return (
    <section aria-label="Where we are" className={`bg-gradient-to-br ${info.theme} text-white`} data-testid="round-banner">
      <div className="mx-auto max-w-5xl px-4 py-4 sm:py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-widest text-white/80" data-testid="round-label">
            {info.round ? `Round ${info.round} of 3 · ${info.title}` : info.title}
          </p>
          <ol className="flex items-center gap-1.5" aria-label="Rounds">
            {ROUND_STAGES.map((r, i) => (
              <li
                key={r}
                aria-current={i === at ? "step" : undefined}
                className={`grid h-7 min-w-7 place-items-center rounded-full px-2 text-xs font-extrabold ${
                  i === at ? "bg-white text-slate-900 shadow" : i < at || stage === "RESULTS" ? "bg-white/35 text-white" : "bg-white/15 text-white/70"
                }`}
              >
                {i < at || stage === "RESULTS" ? "✓" : i + 1}
              </li>
            ))}
          </ol>
        </div>
        <div className="mt-2 flex items-start gap-3 sm:gap-4">
          <span className="text-4xl leading-none sm:text-5xl" aria-hidden>
            {info.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-extrabold leading-tight sm:text-3xl">{step.name}</h2>
            <p className="mt-0.5 text-sm text-white/90 sm:text-base">{step.what}</p>
            <p className="mt-1 text-sm font-semibold text-white" data-testid="team-phase">
              ⏱ {PHASE_LABELS[phase]}
              <PhaseEnd endsAt={endsAt} phase={phase} gate={gate} next={next} className="ml-1 font-semibold text-white" />
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <p className="flex-1 rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold sm:text-base" data-testid="your-job">
            <span className="mr-1" aria-hidden>
              🎯
            </span>
            Your job: {JOB[track][stage]}
          </p>
          {openRound ? (
            <p className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-900" data-testid="open-round">
              📈 Trading round {openRound.number} · <Countdown to={openRound.closes_at} passed="clearing" className="tabular-nums" /> left
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
