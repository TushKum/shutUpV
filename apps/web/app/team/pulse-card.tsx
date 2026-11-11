import Link from "next/link";
import { MOODS, type Pulse, type PulseItem } from "@/lib/team/pulse";
import { count, money } from "@/lib/format";
import { Glyph } from "@/components/ui/matrix";

const pct = (bp: number) => `${bp > 0 ? "+" : bp < 0 ? "−" : ""}${(Math.abs(bp) / 100).toFixed(2)}%`;

// The headline of the last trading round on every team's Home: the biggest riser and faller, the most-traded
// company, and the round's mood. Public market numbers only.
export function PulseCard({ pulse }: { pulse: Pulse }) {
  const mood = MOODS[pulse.mood];
  return (
    <section className="mx-panel rounded-2xl p-4" aria-label="Market pulse" data-testid="pulse">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-phosphor glow">
          <span aria-hidden>
            <Glyph e="🔥" />
          </span>
          Market pulse · round {pulse.round}
        </h2>
        <p className="font-mono text-sm text-paper" data-testid="pulse-mood">
          <span aria-hidden>
            <Glyph e={mood.icon} />
          </span>{" "}
          <span className="font-bold text-phosphor">{mood.label}</span> · {pulse.up} up · {pulse.down} down · {count(pulse.totalVolume)} shares traded
        </p>
      </div>
      {pulse.riser || pulse.faller || pulse.busiest ? (
        <ul className="grid gap-2 sm:grid-cols-3" aria-label="Round headlines">
          <Headline label="Biggest riser" icon="📈" item={pulse.riser} tone="up" testId="pulse-riser" />
          <Headline label="Biggest faller" icon="📉" item={pulse.faller} tone="down" testId="pulse-faller" />
          <Headline label="Most traded" icon="🔥" item={pulse.busiest} tone="busy" testId="pulse-busiest" />
        </ul>
      ) : (
        <p className="text-sm text-muted">A quiet round: no price moved.</p>
      )}
    </section>
  );
}

function Headline({ label, icon, item, tone, testId }: { label: string; icon: string; item: PulseItem | null; tone: "up" | "down" | "busy"; testId: string }) {
  return (
    <li className={`rounded-xl bg-panel p-3 ring-1 ${tone === "down" ? "ring-danger/70" : "ring-phosphor-dim"}`} data-testid={testId}>
      <p className="flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-wide text-muted">
        <span className={tone === "down" ? "text-danger-soft" : "text-phosphor"} aria-hidden>
          <Glyph e={icon} />
        </span>
        {label}
      </p>
      {item ? (
        <>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <Link href={`/team/market/${item.ticker}`} className="font-mono text-xl font-extrabold text-phosphor underline-offset-2 hover:underline">
              {item.ticker}
            </Link>
            <span className={`font-mono text-lg font-extrabold tabular-nums ${tone === "busy" ? "text-paper" : item.changeBp < 0 ? "text-danger-soft" : "text-phosphor glow"}`}>
              {tone === "busy" ? `${count(item.volume)} shares` : pct(item.changeBp)}
            </span>
          </p>
          <p className="truncate text-xs text-muted">
            {item.name ?? item.ticker} · now {money(item.price)}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">Nobody this round.</p>
      )}
    </li>
  );
}
