import type { CrisisCardRow } from "@/lib/team/market-data";

/** A company's crisis card (public from the crisis): its category, title and text, framed in red. */
export function CrisisCard({ card, compact = false }: { card: CrisisCardRow; compact?: boolean }) {
  return (
    <div className="border-l-4 border-danger/70 bg-danger/10 py-2 pl-3 pr-2" data-testid="crisis-card">
      <p className="text-xs font-semibold uppercase tracking-wide text-danger-soft">Crisis · {card.category}</p>
      <h3 className={`mt-1 font-semibold text-phosphor ${compact ? "text-sm" : ""}`}>{card.title}</h3>
      {card.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-paper">{card.body}</p> : null}
    </div>
  );
}
