import type { Metadata } from "next";
import { RULES } from "@msim/engine";
import { memoCase } from "@/lib/judge/prompts";
import { loadTeamContext } from "@/lib/team/context";
import { submissionWindow } from "@/lib/team/squad";
import { loadSquadWorkspace, pauseOf, windowInput } from "@/lib/team/squad-data";
import { Panel } from "@/components/ui/ui";
import { Due } from "../due";
import { squadGate } from "../parts";
import { SubmissionEditor } from "../submission";

export const metadata: Metadata = { title: "Crisis memo" };

// Round 1 Consultancy: every Consulting team answers the same standalone crisis case (published in prompts/MEMO.md)
// with a recommendation memo. It closes with the PRD; its score moves no price and sets the firm's reputation bonus.
export default async function MemoPage() {
  const ctx = await loadTeamContext();
  const gate = squadGate(ctx);
  if (gate) return gate;
  const ws = await loadSquadWorkspace(ctx);
  const win = submissionWindow("MEMO", ctx.team.track, windowInput(ctx, ws));
  const paragraphs = memoCase();
  return (
    <>
      <Panel title="The case">
        <div className="space-y-3 text-sm text-paper" data-testid="memo-case">
          {paragraphs.length ? paragraphs.map((p, i) => <p key={i}>{p}</p>) : <p>The case is published here before the event.</p>}
        </div>
      </Panel>
      <Panel
        title="Crisis memo"
        actions={
          <span className="text-sm text-paper">
            Due <Due at={win.deadline} {...pauseOf(ctx)} testId="memo-due" />
          </span>
        }
      >
        <p className="mb-4 text-sm text-paper">
          Your recommendation to the founders: up to {RULES.WORD_LIMIT.MEMO} words across the six sections. The AI judge scores the diagnosis (25),
          options and trade-offs (20), the recommendation (20), the numbers (15), risks (10) and next steps (10). The score moves no price: it
          sets your firm&apos;s reputation bonus, $500 × (score − 50), paid at settlement.
        </p>
        <SubmissionEditor ctx={ctx} ws={ws} type="MEMO" win={win} />
      </Panel>
    </>
  );
}
