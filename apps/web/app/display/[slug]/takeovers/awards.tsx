// 05:15 the awards (the last phase; stays up), revealed one by one by the server clock: the special awards first,
// then third, runner-up and the winner. The newest award fills the top of the screen; those already revealed are
// listed below. The only screen with team names: they come from the final results, which the database gives only at
// AWARDS. Ties share an award; the best company is shared by the team that built it and the team that rescued it.

import { AWARD_LABELS } from "@msim/engine";
import { TAKEOVER_TITLES } from "@/lib/display/takeover";
import { awardsRevealed, ceremony, nextAwardAt } from "@/lib/display/takeovers";
import { loadEventStatus } from "@/lib/event-status";
import { RefreshAt } from "@/lib/live/refresh-at";
import type { TakeoverProps } from "./index";
import { TakeoverFrame } from "./frame";
import { loadCeremony } from "./data";
import { Neutral } from "./parts";

export async function AwardsTakeover({ event, takeover }: TakeoverProps) {
  const [ceremonyData, status] = await Promise.all([loadCeremony(event.id), loadEventStatus(event.id)]);
  const lines = ceremony(ceremonyData?.awards ?? []);
  const nowMs = Date.parse(status.server_time);
  const shown = awardsRevealed(takeover.at, nowMs, lines.length, event.clock_speed);
  const next = nextAwardAt(takeover.at, nowMs, lines.length, event.clock_speed);
  const current = shown > 0 ? lines[shown - 1]! : null;
  const earlier = lines.slice(0, Math.max(0, shown - 1)).reverse();
  return (
    <TakeoverFrame title={TAKEOVER_TITLES.AWARDS} at={takeover.at} until={takeover.until} tone="bg-amber-300 text-black">
      <RefreshAt at={next} afterMs={250} />
      {!current ? (
        <Neutral>The awards will appear here.</Neutral>
      ) : (
        <div className="flex h-full flex-col gap-8">
          <section className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-3xl bg-white/[0.06] px-12 text-center" data-testid={`award-${current.code}`}>
            <p className="text-[48px] font-black tracking-wide text-amber-300 uppercase">{AWARD_LABELS[current.code]}</p>
            <div className="mt-6 space-y-2">
              {current.names.map((name, i) => (
                <p key={i} className="text-[88px] leading-[1.05] font-black break-words">
                  {name} <span className="font-mono text-[56px] text-slate-300">{current.winners[i]}</span>
                </p>
              ))}
            </div>
            {current.metric ? <p className="mt-6 text-[44px] text-slate-200">{current.metric}</p> : null}
          </section>
          {earlier.length > 0 ? (
            <ul className="grid shrink-0 grid-cols-3 gap-4" aria-label="Awards already revealed" data-testid="awards-earlier">
              {earlier.map((a) => (
                <li key={a.code} className="min-w-0 rounded-xl bg-white/[0.06] px-5 py-3">
                  <p className="text-[26px] font-bold tracking-wide text-amber-300 uppercase">{AWARD_LABELS[a.code]}</p>
                  <p className="truncate text-[34px] leading-tight font-black">{a.names.join(" · ")}</p>
                  <p className="truncate font-mono text-[26px] text-slate-300">{a.winners.join(" · ")}</p>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="shrink-0 text-right text-[26px] text-slate-400 tabular-nums" data-testid="awards-progress">
            {shown} of {lines.length} awards
          </p>
        </div>
      )}
    </TakeoverFrame>
  );
}
