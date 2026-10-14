// The 00:30 crisis: every company has drawn a crisis card and its price fell 15%. Each company's card and its price
// before → after (up to 20 at a time, the pages turning every 20 s by the server clock), and the seed reveal: the
// seed, the dice, the commitment, SHA-256(seed) checked against the commitment here on the server, and the address of
// the public lottery record that anyone can re-run with `pnpm verify-lottery`.

import { verifyCommitment } from "@msim/engine";
import { TAKEOVER_TITLES } from "@/lib/display/takeover";
import { crisisTitle, evenPages } from "@/lib/display/takeovers";
import type { TakeoverProps } from "./index";
import { TakeoverFrame } from "./frame";
import { loadCompanies, loadCrisisCards, loadPriceMoves, lotteryRecordAddress } from "./data";
import { HexGroups, PriceMove } from "./parts";
import { Pager } from "./pager";

/** 4 columns × 5 rows; with 50 companies, three pages (17, 17, 16). */
const PER_PAGE = 20;

interface CrisisCompany {
  id: string;
  ticker: string;
  category: string | null;
  title: string | null;
  before: number | null;
  after: number | null;
}

export async function CrisisTakeover({ event, takeover }: TakeoverProps) {
  const [companies, cards, moves, record] = await Promise.all([
    loadCompanies(event.id),
    loadCrisisCards(event.id),
    loadPriceMoves(event.id, "CRISIS"),
    lotteryRecordAddress(event.slug),
  ]);
  const rows: CrisisCompany[] = companies.map((c) => {
    const card = c.crisis_card_id ? cards.get(c.crisis_card_id) : undefined;
    const move = moves.get(c.id);
    return {
      id: c.id,
      ticker: c.ticker,
      category: card?.category ?? null,
      title: card ? crisisTitle(card.category, card.title) : null,
      before: move?.market_before ?? null,
      after: move?.market_after ?? null,
    };
  });
  const pages = evenPages(rows, PER_PAGE);
  const seed = event.seed_revealed;
  const commitment = event.seed_commitment;
  const matches = seed && commitment ? verifyCommitment(seed, commitment) : null;

  return (
    <TakeoverFrame title={TAKEOVER_TITLES.CRISIS} at={takeover.at} until={takeover.until} tone="bg-red-500 text-black">
      <div className="flex h-full flex-col gap-5">
        <div className="min-h-0 flex-1">
          <Pager
            pages={pages.map((page, i) => (
              <div key={i} className="flex h-full flex-col gap-4">
                <div className="flex shrink-0 items-baseline justify-between gap-8">
                  <p className="text-[52px] leading-tight font-black" data-testid="crisis-headline">
                    Every company has been hit. <span className="text-red-400">All share prices fell 15%.</span>
                  </p>
                  {pages.length > 1 ? (
                    <p className="shrink-0 text-[28px] text-slate-400 tabular-nums" data-testid="crisis-page">
                      Page {i + 1} of {pages.length}
                    </p>
                  ) : null}
                </div>
                <ul className="grid min-h-0 flex-1 grid-cols-4 grid-rows-5 gap-3" data-testid="crisis-companies">
                  {page.map((c) => (
                    <li
                      key={c.id}
                      className="flex min-h-0 min-w-0 flex-col justify-center rounded-xl border-2 border-red-500/50 bg-red-950/50 px-4"
                      data-testid={`crisis-${c.ticker}`}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[36px] leading-[1.1] font-black">{c.ticker}</span>
                        <PriceMove before={c.before} after={c.after} tone="down" className="text-[32px] leading-[1.1]" />
                      </div>
                      <p className="truncate text-[28px] leading-[1.3]">
                        <span className="font-bold text-amber-300">{c.category ?? "No card"}</span>
                        {c.title ? <span className="text-slate-200"> · {c.title}</span> : null}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          />
        </div>

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
            <p className="text-[32px] text-slate-300">The seed is revealed with the crisis draw.</p>
          )}
        </section>
      </div>
    </TakeoverFrame>
  );
}
