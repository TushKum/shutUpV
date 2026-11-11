import type { SubmissionType } from "@msim/engine";
import { clock } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import type { TeamContext } from "@/lib/team/context";
import { backupKey, toSnapshot } from "@/lib/team/editor";
import { SUBMISSION_LABELS, currentSubmission, submissionVersions, whoLabel, type SubmissionWindow } from "@/lib/team/squad";
import { pauseOf, type SquadWorkspace } from "@/lib/team/squad-data";
import { Badge } from "@/components/ui/ui";
import { ContentView } from "./parts";
import { DraftEditor } from "./draft-editor";

const EMPTY = { version: 0, content: {}, updatedAt: null, updatedBy: null };

/**
 * One submission's editor with what keeps it current: the partner's saves send no realtime message, so the page
 * re-reads every 10 seconds while the window is open (the editor keeps what was typed), and once more when the
 * deadline passes. Below it, every submitted version: the current one (judged) and those it superseded.
 */
export function SubmissionEditor({ ctx, ws, type, win }: { ctx: TeamContext; ws: SquadWorkspace; type: SubmissionType; win: SubmissionWindow }) {
  const squad = ctx.squad!;
  const cur = currentSubmission(ws.submissions, type);
  const versions = submissionVersions(ws.submissions, type, win.deadline, pauseOf(ctx));
  const who = (teamId: string) => whoLabel(squad, ctx.team.id, teamId);
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
      <section className="mt-6" aria-label="Submitted versions" data-testid="submitted-versions">
        <h3 className="text-sm font-semibold text-slate-900">Submitted versions</h3>
        {versions.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">
            No {SUBMISSION_LABELS[type].toLowerCase()} has been submitted yet. A saved draft is not judged until it is submitted.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {versions.map((v) => (
              <li key={v.id}>
                <details className="rounded-md border border-slate-200 px-3 py-2" open={v.current && versions.length === 1}>
                  <summary className="cursor-pointer text-sm">
                    <span className="font-mono">{clock(v.submittedAt, true)}</span> · by {who(v.by)} · {v.words} words{" "}
                    {v.current ? <Badge tone="green">Current · judged</Badge> : <Badge tone="slate">Superseded</Badge>}{" "}
                    {v.late ? <Badge tone="red">Late</Badge> : null}
                  </summary>
                  <div className="mt-3">
                    <ContentView type={type} content={v.content} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
