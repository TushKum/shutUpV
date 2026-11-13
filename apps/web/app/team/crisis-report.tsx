import Link from "next/link";
import { money } from "@/lib/format";
import type { CrisisReport } from "@/lib/team/report-data";
import { moveText, type ReportState } from "@/lib/team/report";
import { ordinal } from "@/lib/team/crisis";
import { BentoItem, BentoTitle } from "@/components/ui/terminal-bento-grid";
import { Glyph } from "@/components/ui/matrix/glyph";

const DOT: Record<ReportState, { mark: string; cls: string; words: string }> = {
  scored: { mark: "✓", cls: "border-[#46f097]/40 bg-[#46f097]/12 text-[#46f097]", words: "" },
  judging: { mark: "…", cls: "border-amber-400/50 bg-amber-400/12 text-amber-300", words: "Being scored" },
  now: { mark: "●", cls: "border-amber-300 bg-amber-300 text-[#031109]", words: "On now" },
  later: { mark: "", cls: "border-white/15 bg-white/[0.04] text-slate-400", words: "Still to come" },
};
const name = (k: number) => (k === 5 ? "Round 3" : `Crisis ${k}`);
const starText = (n: number) => `${"★".repeat(Math.round(n))}${"☆".repeat(5 - Math.round(n))}`;

// Home, PRIMUS Rounds 2 and 3: this team's own line for each crisis (never another team's: rankings wait for the awards).
export function CrisisReportCard({ report }: { report: CrisisReport }) {
  return (
    <BentoItem as="section" span={3} aria-label="Your crises so far" data-testid="crisis-report">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2.5">
        <BentoTitle>
          <span aria-hidden>
            <Glyph e="🚨" />
          </span>
          Your crises so far
        </BentoTitle>
        <Link href="/team/crisis" className="text-sm font-medium text-sky-300 underline-offset-2 hover:text-white hover:underline">
          Crisis room
        </Link>
      </div>
      <ol className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {report.rows.map((r) => {
          const d = DOT[r.state];
          return (
            <li
              key={r.k}
              className="rounded-2xl border border-white/12 bg-white/[0.04] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
              data-testid={`report-${r.k}`}
              data-state={r.state}
            >
              <p className="flex items-center gap-2 font-mono text-sm font-bold text-white">
                <span aria-hidden className={`grid h-6 w-6 place-items-center rounded-full border text-xs ${d.cls}`}>
                  {d.mark || r.k}
                </span>
                {name(r.k)}
                {d.words ? <span className="ml-auto text-xs font-normal text-slate-400">{d.words}</span> : null}
              </p>
              {report.kind === "company" ? (
                (() => {
                  const c = r as (typeof report.rows)[number];
                  return (
                    <>
                      {c.title ? <p className="mt-1.5 text-sm text-slate-200 [overflow-wrap:anywhere]">{c.title}</p> : null}
                      {c.score !== null ? (
                        <p className="mt-1.5 font-mono text-lg font-bold tabular-nums">
                          <span className="mx-accent-text">{c.score}</span>
                          <span className="text-xs font-normal text-slate-400">/100</span>{" "}
                          {c.moveBp !== null ? <span className={c.moveBp < 0 ? "text-rose-400" : "text-[#46f097]"}>price {moveText(c.moveBp)}</span> : null}
                        </p>
                      ) : null}
                      {c.rank ? (
                        <p className="mt-1 text-xs font-semibold text-amber-300" data-testid="report-rank">
                          {c.rank.of === 1 ? "Alone on your statement: the full move" : `${ordinal(c.rank.place)} of ${c.rank.of} on your statement`}
                        </p>
                      ) : null}
                      {c.state !== "later" ? (
                        <p className="mt-1 text-xs text-slate-400">{c.hired ? (c.rating !== null ? `Your firm: ${starText(c.rating)}` : "Firm hired") : "No firm hired"}</p>
                      ) : null}
                    </>
                  );
                })()
              ) : (
                (() => {
                  const f = r as (typeof report.rows)[number];
                  if (f.state === "later") return null;
                  return (
                    <>
                      <p className="mt-1.5 text-sm text-slate-200">
                        {f.clients === 0 ? "No client" : f.clients === 1 ? "1 client" : `${f.clients} clients`}
                        {f.avgRating !== null ? <span className="ml-2 text-amber-300">{starText(f.avgRating)}</span> : null}
                      </p>
                      {f.feesCents > 0 || f.feeShares > 0 ? (
                        <p className="mx-accent-text mt-1 font-mono text-sm tabular-nums">
                          Fees {money(f.feesCents)}
                          {f.feeShares > 0 ? ` + ${f.feeShares.toLocaleString("en-US")} shares` : ""}
                        </p>
                      ) : null}
                      {f.bonusCents !== null ? (
                        <p className={`mt-1 font-mono text-sm font-bold tabular-nums ${f.bonusCents < 0 ? "text-rose-400" : "text-[#46f097]"}`}>
                          Bonus {f.bonusCents < 0 ? "−" : "+"}
                          {money(Math.abs(f.bonusCents))}
                        </p>
                      ) : null}
                    </>
                  );
                })()
              )}
            </li>
          );
        })}
      </ol>
    </BentoItem>
  );
}
