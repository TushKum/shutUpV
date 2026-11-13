// The crisis, for the squad's three teams: before 00:30 what will happen and what the rescue then asks of the squad;
// from the crisis, the company's crisis card and how its prices moved (the post-crisis price the deal is priced from).

import { DEADLINE_LABELS, RULES, dealPriceBand } from "@msim/engine";
import { clock, money } from "@/lib/format";
import { rescueTimeline, type CrisisMove, type Deadlines, type PauseState } from "@/lib/team/rescue";
import type { CrisisCardRow } from "@/lib/team/rescue-data";
import type { SquadCompany } from "@/lib/team/context";
import { ThermalBeam } from "@/components/ui/matrix/thermal-scan";
import { CipherText } from "@/components/ui/matrix/cipher-text";
import { Panel, Stat } from "@/components/ui/ui";
import { Due } from "./parts";

export function CrisisPanel({
  applied,
  startsAt,
  card,
  move,
  company,
  deadlines,
  pause,
}: {
  applied: boolean;
  startsAt: string | null;
  card: CrisisCardRow | null;
  move: CrisisMove | null;
  company: SquadCompany | null;
  deadlines: Deadlines;
  pause: PauseState;
}) {
  if (!applied) {
    return (
      <Panel title={`The crisis${startsAt ? ` at ${clock(startsAt)}` : ""}`}>
        <div className="space-y-3 text-sm text-paper" data-testid="crisis-before">
          <p>
            At {startsAt ? clock(startsAt) : "00:30"} trading halts and every company is dealt a crisis card, drawn by the same verifiable lottery as the
            squads, from 10 crisis categories. Both the market price and the AI price of every company are multiplied by 0.85 (−15%), rounded to the
            cent: the result is your company&apos;s <span className="font-semibold">post-crisis price</span>, which the rescue deal is priced from.
          </p>
          <p>Then your squad rescues the company:</p>
          <ol className="space-y-2">
            {rescueTimeline(deadlines).map((t) => (
              <li key={t.code} className="rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                <span className="block font-semibold text-white">
                  {DEADLINE_LABELS[t.code]} · <span className="mx-accent-text"><Due at={t.at} pause={pause} /></span>
                </span>
                <span className="text-slate-200">{t.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </Panel>
    );
  }
  const post = company?.post_crisis_price ?? move?.market_after ?? null;
  const band = post ? dealPriceBand(post) : null;
  return (
    <Panel title="The crisis">
      <div className="grid gap-4 md:grid-cols-2">
        {card ? (
          <div className="mx-thermal rounded-2xl border border-rose-400/30 border-l-4 border-l-rose-400 bg-rose-500/[0.09] px-4 py-3 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" data-testid="crisis-card">
            <ThermalBeam />
            <p className="font-mono text-xs font-semibold uppercase tracking-wider text-rose-300">Crisis · {card.category}</p>
            <h3 className="mt-1 font-semibold text-rose-200 [--mx-cipher-color:#fda4af]">
              <CipherText text={card.title} />
            </h3>
            {card.body ? <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-200">{card.body}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-slate-200">Your company&apos;s crisis card is not available.</p>
        )}
        <div className="grid grid-cols-2 gap-2 self-start" data-testid="crisis-prices">
          <Stat
            label="Post-crisis price"
            value={money(post)}
            hint={move?.market_before ? `Market price ${money(move.market_before)} × ${RULES.CRISIS_PCT}%` : undefined}
          />
          <Stat label="AI price" value={money(move?.ai_after ?? null)} hint={move?.ai_before ? `From ${money(move.ai_before)} × ${RULES.CRISIS_PCT}%` : undefined} />
          {band ? <Stat label="Deal price band" value={`${money(band.min)}–${money(band.max)}`} hint="50%–100% of the post-crisis price" /> : null}
        </div>
      </div>
    </Panel>
  );
}
