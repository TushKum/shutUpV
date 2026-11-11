import type { Metadata } from "next";
import { RULES } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { submissionWindow } from "@/lib/team/squad";
import { loadSquadWorkspace, pauseOf, windowInput } from "@/lib/team/squad-data";
import { Panel } from "@/components/ui/ui";
import { Due } from "../due";
import { squadGate } from "../parts";
import { SubmissionEditor } from "../submission";

export const metadata: Metadata = { title: "Pitch" };

// The pitch card: the Product team writes it (with the company name and the ticker it claims), the Consulting team
// reads it. It hard-closes at the pitch deadline; its score sets the IPO price.
export default async function PitchPage() {
  const ctx = await loadTeamContext();
  const gate = squadGate(ctx);
  if (gate) return gate;
  const ws = await loadSquadWorkspace(ctx);
  const win = submissionWindow("PITCH", ctx.team.track, windowInput(ctx, ws));
  return (
    <Panel
      title="Pitch card"
      actions={
        <span className="text-sm text-slate-600">
          Due <Due at={win.deadline} {...pauseOf(ctx)} testId="pitch-due" />
        </span>
      }
    >
      <p className="mb-4 text-sm text-slate-600">
        Up to {RULES.WORD_LIMIT.PITCH} words in the template&apos;s sections. The judge scores the problem, the solution, the business model and your
        advantage (25 points each); the score sets your IPO price.
      </p>
      <SubmissionEditor ctx={ctx} ws={ws} type="PITCH" win={win} />
    </Panel>
  );
}
