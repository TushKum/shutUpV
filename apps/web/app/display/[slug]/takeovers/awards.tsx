// The awards (the last phase; stays up): the top 3 of each track with team name, code, final value and return, and
// the three special awards with what won them. The only screen with team names: they come from public.rankings,
// which returns nothing before AWARDS. Ties share a place (1, 2, 2), so a place may show two teams. Disqualified
// teams are already left out by the database.

import { TAKEOVER_TITLES } from "@/lib/display/takeover";
import { awardMetric, capPodium, podiumDensity, podiumNumbers, podiums, specialAwards, type AwardRow, type Podium } from "@/lib/display/takeovers";
import type { TakeoverProps } from "./index";
import { TakeoverFrame } from "./frame";
import { loadAwards } from "./data";
import { Neutral } from "./parts";

const MEDAL: Record<number, string> = {
  1: "bg-amber-300 text-black",
  2: "bg-slate-300 text-black",
  3: "bg-orange-400 text-black",
};

/** Type sizes by how many teams share a podium (ties): the column always fits its teams. */
const DENSITY = {
  large: {
    medal: "h-[72px] w-[72px] text-[44px]",
    name: "line-clamp-2 text-[40px] leading-[1.12]",
    longName: "line-clamp-3 text-[34px] leading-[1.12]",
    list: "gap-5",
    place: "space-y-3",
  },
  compact: {
    medal: "h-14 w-14 text-[34px]",
    name: "truncate text-[32px] leading-tight",
    longName: "line-clamp-2 text-[28px] leading-tight",
    list: "gap-3",
    place: "space-y-1.5",
  },
  dense: { medal: "h-12 w-12 text-[30px]", name: "truncate text-[30px] leading-tight", longName: "truncate text-[26px] leading-tight", list: "gap-2", place: "space-y-1" },
};
type Density = (typeof DENSITY)[keyof typeof DENSITY];
/** Team names longer than this get the smaller type of their density (names may be up to 80 characters). */
const LONG_NAME = 40;

export async function AwardsTakeover({ event, takeover }: TakeoverProps) {
  const awards = await loadAwards(event.id);
  return (
    <TakeoverFrame title={TAKEOVER_TITLES.AWARDS} at={takeover.at} until={takeover.until} tone="bg-amber-300 text-black">
      {!awards || awards.length === 0 ? (
        <Neutral>The awards will appear here.</Neutral>
      ) : (
        <div className="flex h-full flex-col gap-6">
          <div className="grid min-h-0 flex-1 grid-cols-3 gap-8">
            {podiums(awards).map((p) => (
              <TrackPodium key={p.track} podium={p} />
            ))}
          </div>
          <div className="grid h-[280px] shrink-0 grid-cols-3 gap-8">
            {specialAwards(awards).map((s) => (
              <section
                key={s.code}
                aria-label={s.label}
                className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border-2 border-white/25 bg-white/[0.06] px-6 py-4"
                data-testid={`awards-${s.code}`}
              >
                <h2 className="text-[36px] leading-tight font-black text-amber-300">{s.label}</h2>
                {s.winners.length === 0 ? (
                  <p className="mt-2 text-[30px] text-slate-300">Not awarded.</p>
                ) : s.winners.length === 1 ? (
                  <SpecialWinner award={s.winners[0]!} />
                ) : (
                  // A tie: one line each (the metric is the same for tied winners).
                  <>
                    {s.winners.slice(0, 3).map((w, i) => (
                      <p key={i} className="mt-1 truncate text-[30px] leading-tight font-bold">
                        {w.teams?.name ?? w.companies?.name ?? "—"} <span className="font-mono text-[28px] font-normal text-slate-300">{who(w)}</span>
                      </p>
                    ))}
                    <p className="mt-1 line-clamp-2 text-[28px] leading-snug text-white">
                      {s.winners.length > 3 ? `and ${s.winners.length - 3} more tied · ` : "Tied · "}
                      {awardMetric(s.winners[0]!)}
                    </p>
                  </>
                )}
              </section>
            ))}
          </div>
        </div>
      )}
    </TakeoverFrame>
  );
}

function TrackPodium({ podium }: { podium: Podium }) {
  // Six teams fit a column; with more (a many-way tie) five are shown and a line says how many more are tied.
  const six = capPodium(podium.places, 6);
  const { places, more } = six.more > 0 ? capPodium(podium.places, 5) : six;
  const d = DENSITY[podiumDensity(places.reduce((n, p) => n + p.winners.length, 0))];
  return (
    <section
      aria-label={podium.label}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border-2 border-amber-300/40 bg-amber-300/[0.06] px-6 py-5"
      data-testid={`awards-${podium.track}`}
    >
      <h2 className="text-[44px] leading-tight font-black text-amber-300">{podium.label}</h2>
      {places.length === 0 ? (
        <p className="mt-4 text-[30px] text-slate-300">No eligible teams.</p>
      ) : (
        <ol className={`mt-4 flex min-h-0 flex-col ${d.list}`}>
          {places.map((pl) => (
            <li key={pl.place} className="flex items-start gap-5" data-testid={`awards-${podium.track}-${pl.place}`}>
              <span className={`flex shrink-0 items-center justify-center rounded-full font-black ${d.medal} ${MEDAL[pl.place] ?? MEDAL[3]}`} aria-label={`Place ${pl.place}`}>
                {pl.place}
              </span>
              <div className={`min-w-0 flex-1 ${d.place}`}>
                {pl.winners.map((w, i) => (
                  <PodiumTeam key={i} award={w} density={d} />
                ))}
              </div>
            </li>
          ))}
          {more > 0 ? <li className="text-[28px] text-slate-300">and {more} more tied</li> : null}
        </ol>
      )}
    </section>
  );
}

function PodiumTeam({ award, density }: { award: AwardRow; density: Density }) {
  const n = podiumNumbers(award);
  const tone = n.changeBp === null ? "text-slate-300" : n.changeBp >= 0 ? "text-emerald-400" : "text-red-400";
  const name = award.teams?.name ?? "—";
  return (
    <div className="min-w-0">
      <p className={`font-bold break-words ${name.length > LONG_NAME ? density.longName : density.name}`}>{name}</p>
      {/* Code, final value and return each stay whole; a long line wraps the return onto its own line. Consulting
          teams are ranked by final value only (settlement records no return for them), so no return is shown. */}
      <p className="flex flex-wrap gap-x-3 text-[28px] leading-tight text-slate-300 tabular-nums" data-testid="award-numbers">
        <span className="font-mono whitespace-nowrap text-white">{award.teams?.code ?? "—"}</span>
        <span className="whitespace-nowrap">· {n.value}</span>
        {n.changeBp !== null ? <span className={`font-bold whitespace-nowrap ${tone}`}>· {n.change}</span> : null}
      </p>
    </div>
  );
}

/** The winning team's code and, for a company award, its ticker and name. */
function who(a: AwardRow): string {
  const company = a.companies ? `${a.companies.ticker}${a.companies.name ? ` · ${a.companies.name}` : ""}` : null;
  return [a.teams?.code, company].filter(Boolean).join(" · ");
}

function SpecialWinner({ award }: { award: AwardRow }) {
  const winner = award.teams?.name ?? award.companies?.name ?? "—";
  return (
    <div className="mt-1 min-w-0">
      <p className={`font-bold ${winner.length > 30 ? "line-clamp-2 text-[32px] leading-[1.15]" : "truncate text-[40px] leading-[1.15]"}`}>{winner}</p>
      <p className="truncate text-[28px] leading-snug text-slate-300">{who(award)}</p>
      <p className="line-clamp-2 text-[28px] leading-snug text-white">{awardMetric(award)}</p>
    </div>
  );
}
