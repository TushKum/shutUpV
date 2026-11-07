// A problem card or a crisis card, as dealt by the lottery.

import type { Card } from "@/lib/team/round-data";

export function CardView({ card, label, tone = "slate" }: { card: Card; label: string; tone?: "slate" | "red" }) {
  const ring = tone === "red" ? "bg-red-50 ring-red-200" : "bg-white ring-slate-200";
  return (
    <article className={`rounded-lg p-4 ring-1 ring-inset ${ring}`} aria-label={label}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label} #{card.number} · {card.kind}
      </p>
      <h3 className="mt-1 text-lg font-semibold text-slate-900">{card.title}</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{card.body}</p>
    </article>
  );
}
