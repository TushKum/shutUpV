import type { Metadata } from "next";
import Link from "next/link";
import { SUBMISSION_TYPES, TRACKS, TRACK_LABELS, type Track } from "@msim/engine";
import { clock } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { loadTeamContext } from "@/lib/team/context";
import { SUBMISSION_PATHS, pickState, submissionStatus, submissionWindow, whoLabel, type SubmissionStatus } from "@/lib/team/squad";
import { loadSquadWorkspace, pauseOf, windowInput } from "@/lib/team/squad-data";
import { Badge, Panel } from "@/components/ui/ui";
import { Due } from "./due";
import { squadGate } from "./parts";

export const metadata: Metadata = { title: "Squad" };

const ROLE_WORK: Record<Track, string> = {
  PRODUCT: "Picks the problem card, writes the pitch card, co-writes the rescue plan and the flash answer, agrees the fee and signs the deal.",
  CONSULTING: "Co-writes the rescue plan and the flash answer, agrees the fee, proposes the deal price and signs the deal.",
  FINANCE: "Sets the deal amount and signs the deal.",
};

// The squad at a glance: its number, its company, the three teams, the problem card, and where each submission
// stands (draft saved when and by whom, submitted when, word count, the version judged) with its deadline.
export default async function SquadOverview() {
  const ctx = await loadTeamContext();
  const gate = squadGate(ctx);
  if (gate) return gate;
  const squad = ctx.squad!;
  const ws = await loadSquadWorkspace(ctx);
  const w = windowInput(ctx, ws);
  const pause = pauseOf(ctx);
  const pick = pickState({ ...pause, track: ctx.team.track, nowMs: w.nowMs, deadline: ws.deadlines.PROBLEM_PICK ?? null, dealt: squad.dealt_card_ids, chosenId: squad.chosen_card_id, byDefault: squad.chosen_by_default });
  const windows = SUBMISSION_TYPES.map((t) => submissionWindow(t, ctx.team.track, w));
  const statuses = SUBMISSION_TYPES.map((t, i) => submissionStatus(t, ws.drafts[t], ws.submissions, windows[i]!, pause));
  const chosen = ws.cards.find((c) => c.id === pick.chosenId) ?? null;
  const ids: Record<Track, string> = { PRODUCT: squad.product_team_id, CONSULTING: squad.consulting_team_id, FINANCE: squad.finance_team_id };
  const pitchDraft = ws.drafts.PITCH?.content ?? {};
  const draftName = typeof pitchDraft.company_name === "string" ? pitchDraft.company_name.trim() : "";
  const draftTicker = typeof pitchDraft.ticker === "string" ? pitchDraft.ticker.trim().toUpperCase() : "";

  return (
    <div className="space-y-4">
      {/* Drafts saved by the partner team send no realtime message: re-read while something can still change. */}
      <AutoRefresh everyMs={15_000} active={pick.open || pick.defaultPending || windows.some((x) => x.stage === "OPEN")} />

      <Panel title={`Squad ${String(squad.number).padStart(2, "0")}`}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Company</h3>
            {ctx.company?.ticker ? (
              <p className="mt-1 text-lg font-semibold text-slate-900" data-testid="squad-company">
                {ctx.company.name ?? "—"} <span className="font-mono">({ctx.company.ticker})</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-700" data-testid="squad-company">
                No name or ticker claimed yet: they are claimed when the pitch card is submitted.
                {draftName || draftTicker ? (
                  <span className="block text-slate-500">
                    In the draft: {draftName || "—"}
                    {draftTicker ? <span className="font-mono"> ({draftTicker})</span> : null}
                  </span>
                ) : null}
              </p>
            )}
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Teams</h3>
            <ul className="mt-1 space-y-2 text-sm" aria-label="Squad teams">
              {TRACKS.map((t) => {
                const mine = ids[t] === ctx.team.id;
                return (
                  <li key={t} className={mine ? "rounded-md bg-sky-50 px-2 py-1 ring-1 ring-inset ring-sky-200" : "px-2 py-1"}>
                    <span className="font-semibold text-slate-900">{TRACK_LABELS[t]}</span>{" "}
                    {mine ? (
                      <Badge tone="blue">Your team · {ctx.team.code}</Badge>
                    ) : (
                      <span className="text-slate-500">· partner team</span>
                    )}
                    <span className="block text-xs text-slate-600">{ROLE_WORK[t]}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel
        title="Problem card"
        actions={
          <Link href="/team/squad/problem" className="text-sm font-semibold underline">
            {pick.canPick ? (pick.chosenId ? "Change the pick" : "Pick a card") : "See the cards"}
          </Link>
        }
      >
        <div className="space-y-1 text-sm" data-testid="squad-problem">
          {chosen ? (
            <p>
              <span className="font-semibold text-slate-900">{chosen.title}</span> <span className="text-slate-500">({chosen.sector})</span>{" "}
              {pick.byDefault ? <Badge tone="amber">Chosen by default</Badge> : <Badge tone="green">Picked</Badge>}
            </p>
          ) : (
            <p className="font-semibold text-slate-900">Not picked yet.</p>
          )}
          <p className="text-slate-600">{pick.note}</p>
          <p className="text-slate-600">
            Pick closes: <Due at={ws.deadlines.PROBLEM_PICK ?? null} {...pause} />
          </p>
        </div>
      </Panel>

      <Panel title="Submissions">
        <ul className="grid gap-3 lg:grid-cols-3">
          {statuses.map((s, i) => (
            <StatusCard key={s.type} s={s} who={(id) => whoLabel(squad, ctx.team.id, id)} due={windows[i]!.deadline} pause={pause} />
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          Only the last version submitted on time is judged; a saved draft that is not submitted is not judged.
          {ws.deadlines.DEAL ? ` The deal must be fully signed by ${clock(ws.deadlines.DEAL)}, or the plan score is capped at 50.` : ""}
        </p>
      </Panel>
    </div>
  );
}

function StatusCard({
  s,
  who,
  due,
  pause,
}: {
  s: SubmissionStatus;
  who: (teamId: string | null) => string;
  due: string | null;
  pause: { paused: boolean; pausedAt: string | null };
}) {
  return (
    <li className="rounded-md border border-slate-200 p-3" aria-label={s.label} data-testid={`status-${s.type}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{s.label}</h3>
        <Badge tone={s.state.tone}>{s.state.text}</Badge>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-500">Due</dt>
        <dd>
          <Due at={due} {...pause} />
        </dd>
        <dt className="text-slate-500">Draft</dt>
        <dd data-testid={`draft-${s.type}`}>
          {s.draft ? (
            <>
              Version {s.draft.version} · {s.draft.words} words · saved by {who(s.draft.by)} at <span className="font-mono">{clock(s.draft.savedAt, true)}</span>
            </>
          ) : (
            "Not saved yet"
          )}
        </dd>
        <dt className="text-slate-500">Submitted</dt>
        <dd data-testid={`submitted-${s.type}`}>
          {s.current ? (
            <>
              <span className="font-mono">{clock(s.current.submittedAt, true)}</span> by {who(s.current.by)} · {s.current.words} words ·{" "}
              {s.current.late ? <Badge tone="red">late</Badge> : "on time"} · current (judged)
            </>
          ) : (
            "Not submitted"
          )}
        </dd>
        {s.superseded > 0 ? (
          <>
            <dt className="text-slate-500">Earlier</dt>
            <dd>
              {s.superseded} superseded {s.superseded === 1 ? "version" : "versions"}
            </dd>
          </>
        ) : null}
      </dl>
      {s.changedSinceSubmit ? <p className="mt-2 text-xs text-amber-800">The saved draft differs from the submitted version.</p> : null}
      <Link href={SUBMISSION_PATHS[s.type]} className="mt-2 inline-block text-sm font-semibold underline">
        Open the {s.label.toLowerCase()}
      </Link>
    </li>
  );
}
