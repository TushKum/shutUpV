import type { Metadata } from "next";
import { RULES } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { submissionWindow } from "@/lib/team/squad";
import { loadSquadWorkspace, pauseOf, windowInput } from "@/lib/team/squad-data";
import { Panel } from "@/components/ui/ui";
import { Due } from "../due";
import { squadGate } from "../parts";
import { SubmissionEditor } from "../submission";
import { DoThis, HowItWorks } from "@/components/ui/how-it-works";

export const metadata: Metadata = { title: "Pitch" };

// The PRD: the Product team writes it (with the company name and the ticker it claims), the Consulting team
// reads it. It hard-closes at the pitch deadline; its score sets the IPO price.
export default async function PitchPage() {
  const ctx = await loadTeamContext();
  const gate = squadGate(ctx);
  if (gate) return gate;
  const ws = await loadSquadWorkspace(ctx);
  const win = submissionWindow("PITCH", ctx.team.track, windowInput(ctx, ws));
  return (
    <Panel
      title="PRD"
      actions={
        <span className="text-sm text-paper">
          Due <Due at={win.deadline} {...pauseOf(ctx)} testId="pitch-due" />
        </span>
      }
    >
      <div className="mb-4">
        <DoThis testId="pitch-todo">Write your company&apos;s plan in seven short parts (up to {RULES.WORD_LIMIT.PITCH} words), then press Submit.</DoThis>
        <HowItWorks label="How it is scored" testId="pitch-rules">
          <p>
            This is your Product Requirements Document (PRD). The AI judge scores the problem (20), the solution and MVP (20), success metrics (15), business
            model (15), feasibility and risks (15) and clarity (15).
          </p>
          <p>The score sets your company&apos;s IPO price: a better PRD means a higher starting share price.</p>
        </HowItWorks>
      </div>
      <SubmissionEditor ctx={ctx} ws={ws} type="PITCH" win={win} />
    </Panel>
  );
}
