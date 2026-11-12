import Link from "next/link";
import { money } from "@/lib/format";
import type { CrisisReport } from "@/lib/team/report-data";
import { moveText, type ReportState } from "@/lib/team/report";
import { BentoItem, BentoTitle } from "@/components/ui/terminal-bento-grid";
import { Glyph } from "@/components/ui/matrix/glyph";

const DOT: Record<ReportState, { mark: string; cls: string; words: string }> = {
  scored: { mark: "✓", cls: "border-phosphor-dim text-phosphor", words: "" },
  judging: { mark: "…", cls: "border-warn/60 text-warn", words: "Being scored" },
  now: { mark: "●", cls: "border-[var(--term-amber)] bg-[var(--term-amber)] text-black", words: "On now" },
  later: { mark: "", cls: "border-line text-muted", words: "Still to come" },
};
const name = (k: number) => (k === 5 ? "Round 3" : `Crisis ${k}`);
const starText = (n: number) => `${"★".repeat(Math.round(n))}${"☆".repeat(5 - Math.round(n))}`;

// Home, PRIMUS Rounds 2 and 3: this team's own line for each crisis (never another team's: rankings wait for the awards).
export function CrisisReportCard({ report }: { report: CrisisReport }) {
  return (
    <BentoItem as="section" span={3} aria-label="Your crises so far" data-testid="crisis-report">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <BentoTitle>
          <span aria-hidden>
            <Glyph e="🚨" />
          </span>
          Your crises so far
        </BentoTitle>
        <Link href="/team/crisis" className="text-sm font-semibold text-paper underline underline-offset-2">
          Crisis room
        </Link>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {report.rows.map((r) => {
          const d = DOT[r.state];
          return (
            <li key={r.k} className="border border-line bg-ink p-3" data-testid={`report-${r.k}`} data-state={r.state}>
              <p className="flex items-center gap-2 font-mono text-sm font-bold text-phosphor">
                <span aria-hidden className={`grid h-6 w-6 place-items-center rounded-full border text-xs ${d.cls}`}>
                  {d.mark || r.k}
                </span>
                {name(r.k)}
                {d.words ? <span className="ml-auto text-xs font-normal text-muted">{d.words}</span> : null}
              </p>
              {report.kind === "company" ? (
                (() => {
                  const c = r as (typeof report.rows)[number];
                  return (
                    <>
                      {c.title ? <p className="mt-1 text-sm text-paper [overflow-wrap:anywhere]">{c.title}</p> : null}
                      {c.score !== null ? (
                        <p className="mt-1 font-mono text-lg font-extrabold tabular-nums">
                          <span className="text-phosphor">{c.score}</span>
                          <span className="text-xs font-normal text-muted">/100</span>{" "}
                          {c.moveBp !== null ? <span className={c.moveBp < 0 ? "text-danger-soft" : "text-phosphor"}>price {moveText(c.moveBp)}</span> : null}
                        </p>
                      ) : null}
                      {c.state !== "later" ? (
                        <p className="mt-1 text-xs text-muted">{c.hired ? (c.rating !== null ? `Your firm: ${starText(c.rating)}` : "Firm hired") : "No firm hired"}</p>
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
                      <p className="mt-1 text-sm text-paper">
                        {f.clients === 0 ? "No client" : f.clients === 1 ? "1 client" : `${f.clients} clients`}
                        {f.avgRating !== null ? <span className="ml-2 text-[var(--term-amber)]">{starText(f.avgRating)}</span> : null}
                      </p>
                      {f.feesCents > 0 || f.feeShares > 0 ? (
                        <p className="mt-1 font-mono text-sm tabular-nums text-phosphor">
                          Fees {money(f.feesCents)}
                          {f.feeShares > 0 ? ` + ${f.feeShares.toLocaleString("en-US")} shares` : ""}
                        </p>
                      ) : null}
                      {f.bonusCents !== null ? (
                        <p className={`mt-1 font-mono text-sm font-bold tabular-nums ${f.bonusCents < 0 ? "text-danger-soft" : "text-phosphor"}`}>
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
