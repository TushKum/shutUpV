import type { SubmissionType } from "@msim/engine";
import { clock } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import type { TeamContext } from "@/lib/team/context";
import { backupKey, toSnapshot } from "@/lib/team/editor";
import { currentSubmission, type SubmissionWindow } from "@/lib/team/squad";
import type { SquadWorkspace } from "@/lib/team/squad-data";
import { ContentView } from "./parts";
import { DraftEditor } from "./draft-editor";

const EMPTY = { version: 0, content: {}, updatedAt: null, updatedBy: null };

/**
 * One submission's editor with what keeps it current: the partner's saves send no realtime message, so the page
 * re-reads every 10 seconds while the window is open (the editor keeps what was typed), and once more when the
 * deadline passes. Below it, the submitted version that will be judged.
 */
export function SubmissionEditor({ ctx, ws, type, win }: { ctx: TeamContext; ws: SquadWorkspace; type: SubmissionType; win: SubmissionWindow }) {
  const squad = ctx.squad!;
  const cur = currentSubmission(ws.submissions, type);
  return (
    <>
      <AutoRefresh everyMs={10_000} active={win.stage === "OPEN"} />
      <RefreshAt at={win.deadline} />
      <DraftEditor
        type={type}
        draft={toSnapshot(ws.drafts[type]) ?? EMPTY}
        editable={win.editable}
        closedNote={win.note}
        deadline={win.deadline}
        paused={ctx.status.paused}
        pausedAt={ctx.status.paused_at}
        squad={{ product_team_id: squad.product_team_id, consulting_team_id: squad.consulting_team_id, finance_team_id: squad.finance_team_id }}
        me={ctx.team.id}
        storageKey={backupKey(squad.id, ctx.team.id, type)}
        submitted={cur ? { content: cur.content, submittedAt: cur.submitted_at } : null}
      />
      {cur ? (
        <details className="mt-4 rounded-md border border-slate-200 p-3" data-testid="submitted-version">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            The submitted version (judged): {clock(cur.submitted_at, true)}, {cur.word_count} words
          </summary>
          <div className="mt-3">
            <ContentView type={type} content={cur.content} />
          </div>
        </details>
      ) : null}
    </>
  );
}
