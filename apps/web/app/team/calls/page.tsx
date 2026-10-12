import type { Metadata } from "next";
import Link from "next/link";
import { RULES } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { sectionAllowed } from "@/lib/team/sections";
import { supabaseServer } from "@/lib/supabase/server";
import { callsInput, loadCalls } from "@/lib/team/calls-data";
import { CALL_WINDOWS, callCell, callsSummary, coveredLabels, findCall, windowStage, type CallCell } from "@/lib/team/calls";
import { pauseOf } from "@/lib/team/rescue-data";
import { clock, money } from "@/lib/format";
import { RefreshAt } from "@/lib/live/refresh-at";
import { Badge, Notice, Panel, Stat } from "@/components/ui/ui";
import { Due } from "../rescue/parts";
import { CallChoice } from "./call-choice";

export const metadata: Metadata = { title: "Calls" };

const STAGE_BADGE = {
  NOT_OPEN: { tone: "slate", text: "Not open yet" },
  OPEN: { tone: "green", text: "Open" },
  CLOSED: { tone: "amber", text: "Closed · awaiting judging" },
  JUDGED: { tone: "blue", text: "Judged" },
} as const;

// A Consulting team's calls: BUY or SELL on each of its two covered companies in three windows, editable until each
// is due, then read-only; once judged, the baseline, the judged price, right or wrong and the $2,500 earned. The
// windows open and close at releases and the close (broadcast, which refreshes the page) and at their due times (the
// page re-reads itself then). Calls are private: no other team sees them.
export default async function CallsPage() {
  const ctx = await loadTeamContext();
  if (!sectionAllowed(ctx.team.track, "/calls")) {
    return (
      <Notice tone="blue">
        Consultant calls are made by the Consulting teams.{" "}
        <Link href="/team" className="font-semibold underline">
          Back to Home
        </Link>
      </Notice>
    );
  }
  const sb = await supabaseServer();
  const data = await loadCalls(sb, ctx);
  if (data.coverage.length === 0) {
    return <Notice>Your two covered companies are assigned at the squad draw. Your calls on them are made here.</Notice>;
  }
  const input = callsInput(ctx, data);
  const pause = pauseOf(ctx);
  const companies = coveredLabels(data.coverage, data.companies);
  const windows = CALL_WINDOWS.map((w) => {
    const stage = windowStage(w.no, input);
    return { ...w, stage, due: data.deadlines[w.deadline] ?? null, cells: companies.map((c) => ({ company: c, cell: callCell(findCall(data.calls, c.id, w.no), stage) })) };
  });
  const summary = callsSummary(windows.flatMap((w) => w.cells.map((c) => c.cell)));
  const unnamed = companies.some((c) => c.ticker === null);

  return (
    <div className="space-y-4">
      {windows.map((w) => (w.stage === "OPEN" ? <RefreshAt key={w.no} at={w.due} /> : null))}
      <Panel title="Your calls">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Covered" value={companies.map((c) => c.label).join(" · ")} />
          <Stat label="Judged" value={`${summary.judged} of ${summary.judged + summary.pending}`} />
          <Stat label="Correct" value={summary.correct} />
          <Stat label="Earned" value={money(summary.earnings)} hint={`${money(RULES.CALL_EARNING)} per correct call`} />
        </div>
        <p className="mt-3 text-sm text-slate-600">
          In each window, call BUY or SELL on each covered company. A BUY is correct if the judged price is above the baseline, a SELL if it is below; an
          equal price or a missing call is wrong. You can change a call until it is due. Your calls are private: no other team sees them.
        </p>
        {unnamed ? (
          <p className="mt-2 text-sm text-slate-600">
            Your covered companies&apos; names and pitches are public from the Reading phase (22:30); until then they are numbered.
          </p>
        ) : null}
      </Panel>

      {windows.map((w) => {
        const judged = w.cells.length > 0 && w.cells.every((c) => c.cell.stage === "JUDGED");
        const badge = STAGE_BADGE[judged ? "JUDGED" : w.stage];
        return (
          <Panel
            key={w.no}
            title={
              <span className="flex flex-wrap items-center gap-2">
                Call {w.no} <Badge tone={badge.tone}>{badge.text}</Badge>
              </span>
            }
            actions={
              <span className="text-sm text-slate-600">
                Due <Due at={w.due} pause={pause} testId={`call-${w.no}-due`} passed="closed" />
              </span>
            }
          >
            <section aria-label={`Call ${w.no}`} data-testid={`call-${w.no}`} data-stage={judged ? "JUDGED" : w.stage}>
              <p className="text-sm text-slate-600">
                Baseline: the {w.baseline}. Judged at the {w.judgedAt}, {w.judged}.
                {w.stage === "NOT_OPEN" ? ` Opens ${w.opens}.` : ""}
              </p>
              <ul className="mt-3 divide-y divide-slate-100">
                {w.cells.map(({ company, cell }) => (
                  <li key={company.id} className="flex flex-wrap items-start justify-between gap-3 py-3" data-testid={`call-${w.no}-${company.label}`}>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">
                        <span className="font-mono">{company.label}</span>
                        {company.name ? <span className="ml-1 font-normal text-slate-600">{company.name}</span> : null}
                      </p>
                      <CallState cell={cell} />
                    </div>
                    {cell.editable ? <CallChoice companyId={company.id} label={company.label} no={w.no} direction={cell.direction} due={w.due} pause={pause} /> : null}
                  </li>
                ))}
              </ul>
            </section>
          </Panel>
        );
      })}
    </div>
  );
}

function CallState({ cell }: { cell: CallCell }) {
  const r = cell.result;
  if (r) {
    return (
      <p className="mt-1 text-sm" data-testid="call-result">
        {cell.direction ?? "No call"} · baseline <span className="font-mono">{money(r.baseline)}</span> → judged <span className="font-mono">{money(r.judged)}</span> ·{" "}
        {r.correct ? <Badge tone="green">Correct · {money(r.earnings)}</Badge> : <Badge tone="red">Wrong · {money(r.earnings)}</Badge>}
      </p>
    );
  }
  return (
    <p className="mt-1 text-sm text-slate-600" data-testid="call-current">
      {cell.direction ? (
        <>
          Your call: <span className="font-semibold text-slate-900">{cell.direction}</span>
          {cell.madeAt ? ` (made ${clock(cell.madeAt, true)})` : ""}
        </>
      ) : cell.stage === "CLOSED" ? (
        "No call made"
      ) : (
        "No call yet"
      )}
      {cell.stage === "CLOSED" ? (cell.direction ? " · closed, awaiting judging" : " · closed: a missing call counts as wrong") : ""}
    </p>
  );
}
