import Link from "next/link";
import type { WireItem } from "@/lib/team/wire";
import { clock } from "@/lib/format";

const TONE: Record<WireItem["tone"], string> = {
  up: "text-[#46f097]",
  down: "text-rose-400",
  flat: "text-slate-100",
  info: "text-slate-300",
};
const TAG: Record<WireItem["kind"], string> = { SCORE: "SCORE", PLANS: "PLANS", NEWS: "NEWS " };

// The Wire Feed, drawn as a clean frosted market log: what just became public, newest first.
export function WireFeed({ items }: { items: WireItem[] }) {
  return (
    <section className="mx-panel p-4 sm:p-5 font-mono" aria-label="Wire feed" data-testid="wire">
      <p className="mb-3 flex items-center gap-1.5 border-b border-white/10 pb-2 text-xs text-slate-400" aria-hidden>
        <span className="mx-accent-dot h-2 w-2 rounded-full" />
        <span className="mx-accent-text">root@primus</span>:<span className="text-sky-300">~</span>$ tail -f wire.log
      </p>
      <h2 className="sr-only">Wire feed</h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">
          &gt; waiting for the first score or bulletin<span className="mx-cursor" aria-hidden />
        </p>
      ) : (
        <ol className="space-y-1.5 text-sm" aria-label="Latest public news, newest first">
          {items.map((i) => (
            <li key={i.key} className="flex flex-wrap gap-x-3 [overflow-wrap:anywhere]" data-testid={`wire-${i.key}`} data-tone={i.tone}>
              <span className="tabular-nums text-slate-400">{clock(i.at)}</span>
              <span className="mx-accent-text opacity-85">[{TAG[i.kind]}]</span>
              {i.href ? (
                <Link href={i.href} className={`min-w-0 flex-1 underline-offset-2 hover:underline ${TONE[i.tone]}`}>
                  {i.text}
                </Link>
              ) : (
                <span className={`min-w-0 flex-1 ${TONE[i.tone]}`}>{i.text}</span>
              )}
            </li>
          ))}
          <li aria-hidden className="text-slate-500">
            &gt; <span className="mx-cursor" />
          </li>
        </ol>
      )}
    </section>
  );
}
