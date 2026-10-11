import type { Metadata } from "next";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import { loadTeamContext } from "@/lib/team/context";
import { pickState } from "@/lib/team/squad";
import { loadSquadWorkspace, pauseOf, windowInput } from "@/lib/team/squad-data";
import { ActionButton } from "@/components/ui/action";
import { Badge, Notice, Panel } from "@/components/ui/ui";
import { pickProblemCard } from "../actions";
import { Due } from "../due";
import { squadGate } from "../parts";

export const metadata: Metadata = { title: "Problem card" };

// The three problem cards dealt to the squad at the draw. The Product team picks one (two clicks; it can change its
// pick until the pick closes); the Consulting team sees the cards and the pick. If nothing is picked by the
// deadline, the first card dealt is chosen by default.
export default async function ProblemCardPage() {
  const ctx = await loadTeamContext();
  const gate = squadGate(ctx);
  if (gate) return gate;
  const squad = ctx.squad!;
  const ws = await loadSquadWorkspace(ctx);
  const w = windowInput(ctx, ws);
  const deadline = ws.deadlines.PROBLEM_PICK ?? null;
  const pick = pickState({
    ...pauseOf(ctx),
    track: ctx.team.track,
    nowMs: w.nowMs,
    deadline,
    dealt: squad.dealt_card_ids,
    chosenId: squad.chosen_card_id,
    byDefault: squad.chosen_by_default,
  });

  return (
    <div className="space-y-4">
      {/* A pick sends no realtime message: the partner's screens and other devices re-read while it can change. */}
      <AutoRefresh everyMs={10_000} active={pick.open || pick.defaultPending} />
      <RefreshAt at={deadline} />
      <Panel
        title="Problem card"
        actions={
          <span className="text-sm text-slate-600">
            Pick closes <Due at={deadline} {...pauseOf(ctx)} testId="pick-due" />
          </span>
        }
      >
        <Notice tone={pick.canPick && !pick.chosenId ? "amber" : "slate"}>{pick.note}</Notice>
        {ws.cards.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No cards have been dealt to your squad.</p>
        ) : (
          <ol className="mt-3 grid gap-3 md:grid-cols-3">
            {ws.cards.map((c, i) => {
              const chosen = c.id === pick.chosenId;
              return (
                <li
                  key={c.id}
                  aria-label={`Card ${i + 1}: ${c.title}`}
                  className={`flex flex-col rounded-md p-3 ${chosen ? "bg-emerald-50/50 ring-2 ring-emerald-600" : "ring-1 ring-slate-200"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                      Card {i + 1} of 3 · No. {c.number} · {c.sector}
                    </span>
                    {chosen ? <Badge tone={pick.byDefault ? "amber" : "green"}>{pick.byDefault ? "Chosen by default" : "Picked"}</Badge> : null}
                  </div>
                  <h3 className="mt-1 font-semibold text-slate-900">{c.title}</h3>
                  <p className="mt-1 flex-1 whitespace-pre-wrap text-sm text-slate-700">{c.body}</p>
                  {pick.canPick && !chosen ? (
                    <div className="mt-3">
                      <ActionButton action={pickProblemCard.bind(null, c.id, c.title)} confirm={`Click again to pick “${c.title}”`}>
                        {pick.chosenId ? "Pick this card instead" : "Pick this card"}
                      </ActionButton>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
        {!pick.mayPick ? <p className="mt-3 text-sm text-slate-500">The Product team picks the card; you see its pick here.</p> : null}
      </Panel>
    </div>
  );
}
