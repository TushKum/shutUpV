import Link from "next/link";
import type { WireItem } from "@/lib/team/wire";
import { clock } from "@/lib/format";

const TONE: Record<WireItem["tone"], string> = {
  up: "text-phosphor",
  down: "text-danger-soft",
  flat: "text-paper",
  info: "text-muted",
};
const TAG: Record<WireItem["kind"], string> = { SCORE: "SCORE", PLANS: "PLANS", NEWS: "NEWS " };

// The Wire Feed, drawn as a terminal log: what just became public, newest first. It re-renders with the page, so a
// score release or a bulletin appears without a reload.
export function WireFeed({ items }: { items: WireItem[] }) {
  return (
    <section className="mx-panel rounded-2xl p-4 font-mono" aria-label="Wire feed" data-testid="wire">
      <p className="mb-2 text-sm text-muted" aria-hidden>
        <span className="text-phosphor">root@primus</span>:<span className="text-phosphor-mid">~</span>$ tail -f wire.log
      </p>
      <h2 className="sr-only">Wire feed</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted">
          &gt; waiting for the first score or bulletin<span className="mx-cursor" aria-hidden />
        </p>
      ) : (
        <ol className="space-y-1 text-sm" aria-label="Latest public news, newest first">
          {items.map((i) => (
            <li key={i.key} className="flex flex-wrap gap-x-3 [overflow-wrap:anywhere]" data-testid={`wire-${i.key}`} data-tone={i.tone}>
              <span className="tabular-nums text-muted">{clock(i.at)}</span>
              <span className="text-phosphor-dim">[{TAG[i.kind]}]</span>
              {i.href ? (
                <Link href={i.href} className={`min-w-0 flex-1 underline-offset-2 hover:underline ${TONE[i.tone]}`}>
                  {i.text}
                </Link>
              ) : (
                <span className={`min-w-0 flex-1 ${TONE[i.tone]}`}>{i.text}</span>
              )}
            </li>
          ))}
          <li aria-hidden className="text-muted">
            &gt; <span className="mx-cursor" />
          </li>
        </ol>
      )}
    </section>
  );
}
