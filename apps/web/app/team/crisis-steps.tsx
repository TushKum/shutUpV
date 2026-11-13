"use client";

// The steps of the crisis under way as a row of pills: done (✓), on now (with the time left) and later. The step on
// now follows the server clock on the screen itself, so the row is right on every page without a re-read.

import { Countdown } from "@/components/ui/countdown";
import { useDeadlineNow } from "@/lib/live/clock";
import { stepStates, type CrisisStep } from "@/lib/team/crisis-steps";

export function CrisisSteps({ steps, label, danger = false }: { steps: readonly CrisisStep[]; label: string; danger?: boolean }) {
  const now = useDeadlineNow();
  const states = stepStates(steps, now);
  const on = danger
    ? "border-rose-400/75 bg-rose-500 text-white shadow-[0_0_16px_rgba(255,92,92,0.35)]"
    : "mx-accent-badge-solid";
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-sm" aria-label={label} data-testid="crisis-steps" suppressHydrationWarning>
      {steps.map((s, i) => {
        const st = states[i]!;
        return (
          <li key={s.key} className="flex items-center gap-1.5" aria-current={st === "now" ? "step" : undefined} data-step={s.key} data-state={st} suppressHydrationWarning>
            {i > 0 ? (
              <span aria-hidden className="text-slate-500">
                →
              </span>
            ) : null}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-semibold ${
                st === "now"
                  ? on
                  : st === "done"
                    ? "mx-accent-chip"
                    : "border-white/12 bg-white/[0.04] text-slate-400"
              }`}
              suppressHydrationWarning
            >
              <span aria-hidden suppressHydrationWarning>
                {st === "done" ? "✓" : i + 1}
              </span>
              {s.label}
              {st === "now" && s.endsAt ? (
                <span className="whitespace-nowrap font-mono tabular-nums">
                  · <Countdown to={s.endsAt} passed="now" /> left
                </span>
              ) : null}
              <span className="sr-only">{st === "done" ? " (done)" : st === "now" ? " (now)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
