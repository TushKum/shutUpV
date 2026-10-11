import type { Metadata } from "next";
import { RULES } from "@msim/engine";
import { clock } from "@/lib/format";
import { loadTeamContext } from "@/lib/team/context";
import { planCap, submissionWindow } from "@/lib/team/squad";
import { loadSquadWorkspace, pauseOf, windowInput } from "@/lib/team/squad-data";
import { Notice, Panel } from "@/components/ui/ui";
import { Due } from "../due";
import { squadGate } from "../parts";
import { SubmissionEditor } from "../submission";

export const metadata: Metadata = { title: "Plan" };

// The rescue plan: one per squad, co-edited by the Product and Consulting teams, up to 500 words, hard deadline
// 03:00. A late plan scores 0, and the plan is capped at 50 if the deal is not fully signed by 03:00.
export default async function PlanPage() {
  const ctx = await loadTeamContext();
  const gate = squadGate(ctx);
  if (gate) return gate;
  const ws = await loadSquadWorkspace(ctx);
  const win = submissionWindow("PLAN", ctx.team.track, windowInput(ctx, ws));
  const cap = planCap(ws.deal, ws.deadlines.DEAL ?? null);
  return (
    <Panel
      title="Rescue plan"
      actions={
        <span className="text-sm text-slate-600">
          Due <Due at={win.deadline} {...pauseOf(ctx)} testId="plan-due" />
        </span>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Up to {RULES.WORD_LIMIT.PLAN} words, written together by your squad&apos;s Product and Consulting teams: each save shows here for both. The judge
        also reads your pitch card, your crisis card and a summary of the deal.
      </p>
      <div className="mb-4 space-y-2" data-testid="plan-rules">
        <Notice tone="red">
          Hard deadline{win.deadline ? ` ${clock(win.deadline)}` : ""}: a late plan scores 0. Only a version submitted by then is judged.
        </Notice>
        <Notice tone={cap.tone}>{cap.text}</Notice>
      </div>
      <SubmissionEditor ctx={ctx} ws={ws} type="PLAN" win={win} />
    </Panel>
  );
}
