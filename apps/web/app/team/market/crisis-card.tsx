import type { CrisisCardRow } from "@/lib/team/market-data";

/** A company's crisis card (public from the crisis): its category, title and text, framed in red. */
export function CrisisCard({ card, compact = false }: { card: CrisisCardRow; compact?: boolean }) {
  return (
    <div className="border-l-4 border-red-600 bg-red-50/70 py-2 pl-3 pr-2" data-testid="crisis-card">
      <p className="text-xs font-semibold uppercase tracking-wide text-red-800">Crisis · {card.category}</p>
      <h3 className={`mt-1 font-semibold text-slate-900 ${compact ? "text-sm" : ""}`}>{card.title}</h3>
      {card.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{card.body}</p> : null}
    </div>
  );
}
