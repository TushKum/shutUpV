// 23:45 the crisis: every company has drawn a crisis card and every price fell 15%; the rescue lottery has given every
// team another team's company to rescue. The rescue circle shows who rescues whom by ticker (the team that built AAA
// rescues the next company on the line), the pages turning every 20 s by the server clock; which cards were dealt;
// and the seed reveal: the seed, the dice, the commitment, SHA-256(seed) checked against the commitment here on the
// server, and the address of the public lottery record that anyone can re-run with `pnpm verify-lottery`.

import { verifyCommitment } from "@msim/engine";
import { TAKEOVER_TITLES } from "@/lib/display/takeover";
import { circleLines, evenPages, rescueCircles } from "@/lib/display/takeovers";
import { count } from "@/lib/format";
import type { TakeoverProps } from "./index";
import { TakeoverFrame } from "./frame";
import { loadCompanies, loadCrisisCards, lotteryRecordAddress } from "./data";
import { HexGroups } from "./parts";
import { Pager } from "./pager";

/** 10 tickers to a line, 6 lines to a page: 150 companies take 3 pages. */
const PER_LINE = 10;
const LINES_PER_PAGE = 6;

export async function CrisisTakeover({ event, takeover }: TakeoverProps) {
  const [companies, cards, record] = await Promise.all([loadCompanies(event.id), loadCrisisCards(event.id), lotteryRecordAddress(event.slug)]);
  const lines = circleLines(rescueCircles(companies), PER_LINE);
  const pages = evenPages(lines, LINES_PER_PAGE);
  const dealt = new Map<string, number>();
  for (const c of companies) {
    const card = c.crisis_card_id ? cards.get(c.crisis_card_id) : undefined;
    if (card) dealt.set(card.category, (dealt.get(card.category) ?? 0) + 1);
  }
  const seed = event.seed_revealed;
  const commitment = event.seed_commitment;
  const matches = seed && commitment ? verifyCommitment(seed, commitment) : null;

  return (
    <TakeoverFrame title={TAKEOVER_TITLES.CRISIS} at={takeover.at} until={takeover.until} tone="bg-red-500 text-black">
      <div className="flex h-full flex-col gap-5">
        <p className="shrink-0 text-[52px] leading-tight font-black" data-testid="crisis-headline">
          Every company has been hit. <span className="text-red-400">All share prices fell 15%.</span>
        </p>

        <section className="flex min-h-0 flex-1 flex-col" aria-label="The rescue circle" data-testid="crisis-circle">
          <h2 className="flex shrink-0 items-baseline justify-between gap-8 border-b-4 border-red-500 pb-1">
            <span className="text-[40px] font-black text-red-300">The rescue circle: the founders of each company rescue the next</span>
          </h2>
          <div className="min-h-0 flex-1 pt-3">
            {lines.length === 0 ? (
              <p className="text-[34px] text-slate-300">The rescue lottery runs with the crisis.</p>
            ) : (
              <Pager
                pages={pages.map((page, i) => (
                  <div key={i} className="flex h-full flex-col gap-2">
                    {page.map((line, j) => (
                      <p key={j} className="flex flex-wrap items-baseline gap-x-3 font-mono text-[38px] leading-[1.25] font-bold" data-testid="crisis-circle-line">
                        {line.map((t, k) => (
                          <span key={k} className="whitespace-nowrap">
                            {k > 0 ? <span className="mr-3 text-red-400">→</span> : null}
                            {t}
                          </span>
                        ))}
                      </p>
                    ))}
                    {pages.length > 1 ? (
                      <p className="mt-auto text-[26px] text-slate-400 tabular-nums" data-testid="crisis-page">
                        Page {i + 1} of {pages.length}
                      </p>
                    ) : null}
                  </div>
                ))}
              />
            )}
          </div>
        </section>

        {dealt.size > 0 ? (
          <p className="shrink-0 truncate text-[30px] text-slate-200" data-testid="crisis-cards">
            <span className="font-bold text-amber-300">Crisis cards dealt:</span>{" "}
            {[...dealt].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([cat, n]) => `${cat} ×${count(n)}`).join(" · ")}
          </p>
        ) : null}

        <section aria-label="Seed reveal" className="shrink-0 rounded-2xl border-2 border-white/25 bg-white/[0.06] px-7 py-4" data-testid="crisis-seed">
          {seed ? (
            <dl className="grid grid-cols-[15rem_minmax(0,1fr)] items-baseline gap-x-6 gap-y-1">
              <dt className="text-[28px] font-semibold text-slate-400">Seed (revealed)</dt>
              <dd>
                <HexGroups hex={seed} className="inline-flex gap-6 text-[34px] font-bold" testId="crisis-seed-value" />
              </dd>
              <dt className="text-[28px] font-semibold text-slate-400">Commitment</dt>
              <dd>
                <HexGroups hex={commitment} className="inline-flex gap-6 text-[34px] text-slate-200" testId="crisis-commitment" />
              </dd>
              <dt className="text-[28px] font-semibold text-slate-400">Dice</dt>
              <dd className="flex items-baseline gap-12">
                <span className="font-mono text-[34px] font-bold tabular-nums" data-testid="crisis-dice">
                  {event.dice ?? "—"}
                </span>
                {matches ? (
                  <span className="text-[34px] font-black whitespace-nowrap text-emerald-400" data-testid="crisis-seed-check">
                    ✓ SHA-256(seed) = commitment
                  </span>
                ) : (
                  <span className="text-[34px] font-black whitespace-nowrap text-red-400" data-testid="crisis-seed-check">
                    ✗ SHA-256(seed) does not match the commitment
                  </span>
                )}
                <span className="text-[28px] whitespace-nowrap text-slate-300">
                  Re-run the draw: <span className="font-mono text-white">pnpm verify-lottery</span>
                </span>
              </dd>
              <dt className="text-[28px] font-semibold text-slate-400">Public record</dt>
              <dd className="font-mono text-[28px] leading-snug break-all text-white" data-testid="crisis-record">
                {record}
              </dd>
            </dl>
          ) : (
            <p className="text-[32px] text-slate-300">The seed is revealed with the crisis.</p>
          )}
        </section>
      </div>
    </TakeoverFrame>
  );
}
