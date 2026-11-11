import type { Metadata } from "next";
import { RULES } from "@msim/engine";
import { clock } from "@/lib/format";
import { loadTeamContext } from "@/lib/team/context";
import { submissionWindow } from "@/lib/team/squad";
import { loadSquadWorkspace, pauseOf, windowInput } from "@/lib/team/squad-data";
import { Panel } from "@/components/ui/ui";
import { Due } from "../due";
import { squadGate } from "../parts";
import { SubmissionEditor } from "../submission";

export const metadata: Metadata = { title: "Flash" };

// The flash answer: once the flash bulletin is published, the squad answers it in up to 100 words until the flash
// deadline. The bulletin is shown next to the answer.
export default async function FlashPage() {
  const ctx = await loadTeamContext();
  const gate = squadGate(ctx);
  if (gate) return gate;
  const ws = await loadSquadWorkspace(ctx);
  const win = submissionWindow("FLASH", ctx.team.track, windowInput(ctx, ws));
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
      <Panel title="Flash bulletin">
        {ws.flash ? (
          <article data-testid="flash-bulletin">
            <p className="text-xs text-slate-500">Published at {clock(ws.flash.published_at)}</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">{ws.flash.title}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{ws.flash.body}</p>
          </article>
        ) : (
          <p className="text-sm text-slate-600">
            Not published yet{ws.deadlines.FLASH_BULLETIN ? `: it is planned for ${clock(ws.deadlines.FLASH_BULLETIN)}` : ""}. It appears here as soon as it
            is out.
          </p>
        )}
      </Panel>
      <Panel
        title="Flash answer"
        actions={
          <span className="text-sm text-slate-600">
            Due <Due at={win.deadline} {...pauseOf(ctx)} testId="flash-due" />
          </span>
        }
      >
        <p className="mb-4 text-sm text-slate-600">
          Up to {RULES.WORD_LIMIT.FLASH} words, written together by your squad&apos;s Product and Consulting teams. The judge scores how you respond to the
          news (50), how realistic it is (30) and how clear (20).
        </p>
        <SubmissionEditor ctx={ctx} ws={ws} type="FLASH" win={win} />
      </Panel>
    </div>
  );
}
