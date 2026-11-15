// A company's own crisis card, in focus: the pulsing corner frame (components/ui/shine-border-06) in the danger red,
// the category as a badge with its icon, the card, and its twist and the decision the plan must make set apart.
// Used where a team reads the one card it must answer (the crisis room); lists of many cards keep CrisisCard.

import { Banknote, Factory, ShieldAlert, Shuffle, Siren, Scale, TrendingDown, type LucideIcon } from "lucide-react";
import FocusFrameBorder from "@/components/ui/shine-border-06";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CrisisCardRow } from "@/lib/team/market-data";

const ICONS: Record<string, LucideIcon> = {
  operations: Factory,
  market: TrendingDown,
  trust: ShieldAlert,
  money: Banknote,
};

/** The card's text in its three parts (the sector decks write "The twist: …" and "Your plan must decide: …"). */
export function crisisParts(body: string): { situation: string; twist: string | null; decide: string | null } {
  const [head = "", ...rest] = body.split(/\n\s*\nThe twist:\s*/);
  const tail = rest.join("\n\n");
  const [twist = "", decide = null] = tail ? tail.split(/\n\s*\nYour plan must decide:\s*/) : [];
  const [situation, ownDecide] = tail ? [head, null] : head.split(/\n\s*\nYour plan must decide:\s*/);
  return {
    situation: (situation ?? "").trim(),
    twist: twist.trim() || null,
    decide: (decide ?? ownDecide ?? null)?.trim() || null,
  };
}

/** The card's twist and the decision the plan must make, each in its own box (nothing when the card has neither). */
export function CrisisCallouts({ twist, decide }: { twist: string | null; decide: string | null }) {
  return (
    <>
      {twist ? (
        <div className="rounded-md border border-warn/50 bg-warn/10 p-3 text-left" data-testid="crisis-twist">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-warn">
            <Shuffle className="size-3.5" aria-hidden /> The twist
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-paper">{twist}</p>
        </div>
      ) : null}
      {decide ? (
        <div className="rounded-md border border-danger/50 bg-danger/10 p-3 text-left" data-testid="crisis-decide">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-danger-soft">
            <Scale className="size-3.5" aria-hidden /> Your plan must decide
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-paper">{decide}</p>
        </div>
      ) : null}
    </>
  );
}

export function CrisisFocusCard({ card, label }: { card: CrisisCardRow; label?: string }) {
  const Icon = ICONS[card.category.trim().toLowerCase()] ?? Siren;
  const { situation, twist, decide } = crisisParts(card.body ?? "");
  return (
    <FocusFrameBorder color="var(--color-danger)" duration={2.4} className="w-full">
      <Card className="relative h-full rounded-[inherit] border-0 bg-transparent shadow-none" data-testid="crisis-card">
        <CardContent className="flex flex-col gap-3 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/15" aria-hidden>
              <Icon className="size-5 text-danger" />
            </span>
            <Badge variant="destructive" className="uppercase tracking-wide">
              Crisis · {card.category}
            </Badge>
            {label ? <span className="font-mono text-xs text-[var(--term-cyan)]">{label}</span> : null}
          </div>
          <h3 className="text-lg font-semibold leading-snug text-phosphor">{card.title}</h3>
          {situation ? <p className="whitespace-pre-wrap text-sm text-paper">{situation}</p> : null}
          <CrisisCallouts twist={twist} decide={decide} />
        </CardContent>
      </Card>
    </FocusFrameBorder>
  );
}
