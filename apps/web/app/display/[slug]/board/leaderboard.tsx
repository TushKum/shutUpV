// The leaderboard's turn on the price board (until the 03:30 freeze): the top 30 teams by total so far, in three
// columns, with each round's points. Team codes only (no names before the awards). Ties share a rank.

import type { LiveRow } from "./data";

const PER_COLUMN = 10;

export function LeaderboardPage({ rows }: { rows: LiveRow[] }) {
  const top = rows.filter((r) => r.rank !== null).slice(0, PER_COLUMN * 3);
  const columns = [0, 1, 2].map((i) => top.slice(i * PER_COLUMN, (i + 1) * PER_COLUMN)).filter((c) => c.length > 0);
  return (
    <section className="flex h-full flex-col" aria-label="Leaderboard" data-testid="display-leaderboard">
      <h2 className="shrink-0 text-[48px] leading-tight font-black">
        Leaderboard <span className="text-[30px] font-semibold text-slate-400">· top {top.length} of {rows.length} teams · live until the freeze</span>
      </h2>
      {top.length === 0 ? (
        <p className="mt-6 text-[36px] text-slate-300">No points yet: Round 1 points appear at the PRD reveal.</p>
      ) : (
        <div className="mt-3 grid min-h-0 flex-1 grid-cols-3 gap-8">
          {columns.map((col, i) => (
            <ol key={i} className="flex min-h-0 flex-col gap-1.5">
              <li className="grid grid-cols-[4rem_minmax(0,1fr)_4.5rem_4.5rem_4.5rem_6rem] gap-2 px-3 text-[22px] font-semibold tracking-wide text-slate-400 uppercase">
                <span>#</span>
                <span>Team</span>
                <span className="text-right">R1</span>
                <span className="text-right">R2</span>
                <span className="text-right">R3</span>
                <span className="text-right">Total</span>
              </li>
              {col.map((r) => (
                <li
                  key={r.team_id}
                  className="grid grid-cols-[4rem_minmax(0,1fr)_4.5rem_4.5rem_4.5rem_6rem] items-baseline gap-2 rounded-lg bg-white/[0.06] px-3 py-1 tabular-nums"
                  data-testid={`display-leaderboard-${r.code}`}
                >
                  <span className="text-[32px] font-black text-slate-400">{r.rank}</span>
                  <span className="font-mono text-[34px] font-black">{r.code}</span>
                  <span className="text-right text-[28px] text-slate-300">{r.r1}</span>
                  <span className="text-right text-[28px] text-slate-300">{r.r2}</span>
                  <span className="text-right text-[28px] text-slate-300">{r.r3}</span>
                  <span className="text-right text-[34px] font-black text-amber-300">{r.total}</span>
                </li>
              ))}
            </ol>
          ))}
        </div>
      )}
    </section>
  );
}
