import Link from "next/link";
import { MOODS, type Pulse, type PulseItem } from "@/lib/team/pulse";
import { count, money } from "@/lib/format";
import { Glyph } from "@/components/ui/matrix";

const pct = (bp: number) => `${bp > 0 ? "+" : bp < 0 ? "−" : ""}${(Math.abs(bp) / 100).toFixed(2)}%`;

// The headline of the last trading round on every team's Home: the biggest riser and faller, the most-traded
// company, and the round's mood. Public market numbers only.
export function PulseCard({ pulse, mine = null }: { pulse: Pulse; mine?: string | null }) {
  const mood = MOODS[pulse.mood];
  const own = mine ? (pulse.moves.find((m) => m.ticker === mine) ?? null) : null;
  return (
    <section className="mx-panel p-5 sm:p-6" aria-label="Market pulse" data-testid="pulse">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-3">
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-white">
          <span className="text-amber-300" aria-hidden>
            <Glyph e="🔥" />
          </span>
          Market pulse · round {pulse.round}
        </h2>
        <p className="font-mono text-xs text-slate-300 sm:text-sm" data-testid="pulse-mood">
          <span aria-hidden>
            <Glyph e={mood.icon} />
          </span>{" "}
          <span className="font-bold text-[#46f097]">{mood.label}</span> · {pulse.up} up · {pulse.down} down · {count(pulse.totalVolume)} shares traded
        </p>
      </div>
      {own ? (
        <p className="mb-3.5 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2.5 text-sm text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]" data-testid="pulse-mine">
          Your squad&apos;s company <span className="font-mono font-bold text-amber-300">{own.ticker}</span>:{" "}
          <span className={`font-mono font-bold ${own.changeBp < 0 ? "text-rose-400" : "text-[#46f097]"}`}>{pct(own.changeBp)}</span> this round, now{" "}
          <span className="font-mono text-white">{money(own.price)}</span>.
        </p>
      ) : null}
      {pulse.riser || pulse.faller || pulse.busiest ? (
        <ul className="grid gap-2.5 sm:grid-cols-3" aria-label="Round headlines">
          <Headline label="Biggest riser" icon="📈" item={pulse.riser} tone="up" testId="pulse-riser" />
          <Headline label="Biggest faller" icon="📉" item={pulse.faller} tone="down" testId="pulse-faller" />
          <Headline label="Most traded" icon="🔥" item={pulse.busiest} tone="busy" testId="pulse-busiest" />
        </ul>
      ) : (
        <p className="text-sm text-slate-400">A quiet round: no price moved.</p>
      )}
    </section>
  );
}

function Headline({ label, icon, item, tone, testId }: { label: string; icon: string; item: PulseItem | null; tone: "up" | "down" | "busy"; testId: string }) {
  return (
    <li
      className={`rounded-2xl border p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] ${
        tone === "down" ? "border-rose-400/30 bg-rose-500/[0.06]" : "border-white/12 bg-white/[0.04]"
      }`}
      data-testid={testId}
    >
      <p className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-slate-400">
        <span className={tone === "down" ? "text-rose-400" : tone === "busy" ? "text-amber-300" : "text-[#46f097]"} aria-hidden>
          <Glyph e={icon} />
        </span>
        {label}
      </p>
      {item ? (
        <>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
            <Link href={`/team/market/${item.ticker}`} className="mx-accent-link-hover font-mono text-xl font-bold text-white underline-offset-2 hover:underline">
              {item.ticker}
            </Link>
            <span className={`font-mono text-lg font-bold tabular-nums ${tone === "busy" ? "text-sky-300" : item.changeBp < 0 ? "text-rose-400" : "text-[#46f097]"}`}>
              {tone === "busy" ? `${count(item.volume)} shares` : pct(item.changeBp)}
            </span>
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {item.name ?? item.ticker} · now {money(item.price)}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-400">Nobody this round.</p>
      )}
    </li>
  );
}
