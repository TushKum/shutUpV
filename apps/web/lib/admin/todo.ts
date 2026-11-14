// "To do now" on the control panel: the organiser's next jobs, worked out from the event's state, most urgent first,
// each with a link to the page that does it. Pure, so every rule is tested (lib/admin/todo.test.ts).

import type { SubmissionType } from "@msim/engine";
import { TYPE_NAMES } from "./judge";

export interface TypeJudging {
  type: SubmissionType;
  /** The type's deadline has passed (it can be judged). */
  closed: boolean;
  /** Current on-time submissions with no score yet: Start judging has not reached them. */
  unscored: number;
  /** Scores being worked out (runs queued or running). */
  scoring: number;
  /** Failed judge runs of submissions still being scored. */
  failed: number;
  /** Scores sealed and waiting to be released. */
  sealed: number;
  released: number;
}

export interface TodoInput {
  format: "CLASSIC" | "PRIMUS";
  /** The squad draw has happened (the decks are locked). */
  drawn: boolean;
  deck: { problems: number; crises: number; statements: number };
  judging: readonly TypeJudging[];
  /** Appeals with a new score waiting for a decision. */
  appealsReady: number;
}

export interface Todo {
  tone: "red" | "amber" | "slate";
  text: string;
  /** Path under /admin/<slug> (no leading slash for the control panel itself). */
  path: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function organiserTodos(x: TodoInput): Todo[] {
  const out: Todo[] = [];
  if (!x.drawn && x.deck.problems === 0) out.push({ tone: "red", text: "Upload the problem deck: the squad draw needs it.", path: "/content" });
  if (!x.drawn && x.format === "PRIMUS" && x.deck.crises === 0)
    out.push({ tone: "red", text: "Upload the crisis deck: it locks at the squad draw.", path: "/content" });
  if (x.format === "PRIMUS" && x.deck.statements === 0)
    out.push({ tone: "amber", text: "Upload the Round 3 problem statements before the draft.", path: "/content" });

  for (const j of x.judging) {
    if (!j.closed) continue;
    const name = TYPE_NAMES[j.type];
    const path = `/judge?type=${j.type}`;
    if (j.failed > 0) out.push({ tone: "red", text: `${plural(j.failed, "judge run")} of the ${name} failed: retry them.`, path });
    if (j.unscored > 0) out.push({ tone: "red", text: `Start judging the ${name}: ${plural(j.unscored, "answer waits", "answers wait")}.`, path });
    else if (j.scoring > 0 && j.failed === 0) out.push({ tone: "slate", text: `The judge is scoring the ${name} (${j.scoring} left).`, path });
    else if (j.sealed > 0 && j.scoring === 0)
      out.push({ tone: "amber", text: `Release the ${name} scores (${j.sealed} ready): prices move when you do.`, path });
  }
  if (x.appealsReady > 0)
    out.push({ tone: "amber", text: `${plural(x.appealsReady, "appeal has", "appeals have")} a new score: apply or dismiss.`, path: "/judge" });

  const rank = { red: 0, amber: 1, slate: 2 } as const;
  return out.map((t, i) => ({ t, i })).sort((a, b) => rank[a.t.tone] - rank[b.t.tone] || a.i - b.i).map(({ t }) => t);
}
