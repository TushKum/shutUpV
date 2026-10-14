// The 21:00 squad draw: how many squads were formed and when, the published commitment (in four groups of 16 so the
// hall can read it), the dice, and the seed check. run_lottery refuses a seed whose SHA-256 is not the commitment, so
// a stored draw is a verified one. The seed itself stays secret until the crisis draw and is never shown here.

import { TAKEOVER_TITLES } from "@/lib/display/takeover";
import { hexGroups } from "@/lib/display/takeovers";
import { clock, count } from "@/lib/format";
import type { TakeoverProps } from "./index";
import { TakeoverFrame } from "./frame";
import { loadDrawSummary, loadPhaseStart, lotteryRecordAddress } from "./data";
import { Neutral } from "./parts";

export async function DrawTakeover({ event, takeover }: TakeoverProps) {
  const [summary, crisisAt, record] = await Promise.all([loadDrawSummary(event.id), loadPhaseStart(event.id, "CRISIS"), lotteryRecordAddress(event.slug)]);
  const commitment = summary?.commitment ?? event.seed_commitment;
  return (
    <TakeoverFrame title={TAKEOVER_TITLES.DRAW} at={takeover.at} until={takeover.until} tone="bg-white text-black">
      {!summary ? (
        <Neutral>The squad draw will appear here.</Neutral>
      ) : (
        <div className="flex h-full flex-col justify-between">
          <div className="flex items-start justify-between gap-12">
            <div className="min-w-0">
              <p className="text-[80px] leading-none font-black">The squads are drawn</p>
              <p className="mt-5 text-[48px] text-slate-200">
                <b className="font-black text-white" data-testid="draw-squads">
                  {count(summary.squads)} {summary.squads === 1 ? "squad" : "squads"}
                </b>{" "}
                formed at <span className="font-mono tabular-nums">{clock(summary.drawn_at)}</span>
              </p>
            </div>
            <div className="shrink-0 rounded-2xl border-4 border-white/30 px-12 py-4 text-center" data-testid="draw-dice">
              <p className="text-[32px] font-semibold tracking-widest text-slate-400 uppercase">Dice</p>
              <p className="font-mono text-[100px] leading-none font-black tabular-nums">{summary.dice ?? "—"}</p>
            </div>
          </div>

          <section aria-label="Published commitment">
            <p className="text-[32px] font-semibold tracking-wide text-slate-400 uppercase">Published commitment · SHA-256 of the secret seed</p>
            <div className="mt-4 grid grid-cols-2 gap-x-10 gap-y-4" data-testid="draw-commitment">
              {hexGroups(commitment).map((g, i) => (
                <span key={i} className="rounded-xl bg-white/10 px-6 py-2 text-center font-mono text-[72px] font-bold tracking-wider" data-testid="draw-commitment-group">
                  {g}
                </span>
              ))}
            </div>
          </section>

          <p className="text-[48px] leading-tight font-black text-emerald-400" data-testid="draw-check">
            ✓ SHA-256 of the secret seed matches the published commitment
          </p>

          <div className="space-y-2 text-[32px] leading-snug text-slate-300">
            <p>
              The server accepts only the seed that matches, so this draw is verified. The seed itself is revealed at the crisis draw
              {crisisAt ? <span className="font-mono tabular-nums"> ({clock(crisisAt)})</span> : null}; then anyone can re-run the whole draw with{" "}
              <span className="font-mono text-white">pnpm verify-lottery</span> from:
            </p>
            <p className="font-mono break-all text-white" data-testid="draw-record">
              {record}
            </p>
          </div>
        </div>
      )}
    </TakeoverFrame>
  );
}
