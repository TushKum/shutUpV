import type { Metadata } from "next";
import Link from "next/link";
import { phaseReached } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadCrisisCard, loadDeadline, loadDraft, loadRevealedScore, loadSubmission, writingFacts } from "@/lib/team/round-data";
import { closedNote, writingOpen } from "@/lib/team/writing";
import { backupKey } from "@/lib/team/editor";
import { clock, money } from "@/lib/format";
import { Notice, Panel } from "@/components/ui/ui";
import { Countdown } from "@/components/ui/countdown";
import { RefreshAt } from "@/lib/live/refresh-at";
import { supabaseServer } from "@/lib/supabase/server";
import { DraftEditor } from "../draft-editor";
import { CardView } from "../card";
import { ScoreCard } from "../score-card";

export const metadata: Metadata = { title: "Round 2: Rescue" };

// Round 2 (00:15–01:45): the crisis hit every company at 23:45. This team's own company's crisis card and who rescues it;
// the company it rescues (its PRD and its crisis card); the crisis-solution editor (six parts, 500 words, autosaved);
// and from 02:45 the solution's score (secret until then).
export default async function RescuePage() {
  const ctx = await loadTeamContext();
  const { team, event, status, built, rescued } = ctx;
  if (!event.crisis_applied_at || !rescued) {
    return (
      <Panel title="Round 2: Rescue">
        <p className="text-sm text-slate-700">
          At the crisis every company is hit by a crisis and every share price falls 15%. The lottery then gives each team another team&apos;s company to rescue:
          you write its crisis solution (until its form locks), and its founders answer your questions on the Q&amp;A board while it is open.
        </p>
      </Panel>
    );
  }
  const [lock, draft, ownCrisis, theirCrisis, theirPrd, solutionScore, rescuer] = await Promise.all([
    loadDeadline(event.id, "SOLUTION_LOCK"),
    loadDraft(team.id, "SOLUTION"),
    loadCrisisCard(built?.crisis_card_id ?? null),
    loadCrisisCard(rescued.crisis_card_id),
    loadSubmission(rescued.id, "PRD"),
    loadRevealedScore(rescued.id, "SOLUTION"),
    loadRescuerCode(event.id, team.code),
  ]);
  const facts = writingFacts(ctx, lock);
  const open = writingOpen("SOLUTION", facts);
  const prdScore = await loadRevealedScore(rescued.id, "PRD");

  return (
    <div className="space-y-6">
      <RefreshAt at={open ? lock : null} />
      {solutionScore ? (
        <Panel title={`Your crisis solution's score (${rescued.ticker})`}>
          <ScoreCard type="SOLUTION" score={solutionScore} />
          <p className="mt-3 text-xs text-slate-500">
            At the score reveal {rescued.ticker}&apos;s market price and score-based price were multiplied by 1 + 0.5% × (score − 50). Round 2 points = this score.
          </p>
        </Panel>
      ) : phaseReached(status.phase, "JUDGING_2") ? (
        <Notice tone="blue">Your crisis solution is locked and being judged. Scores stay secret until the score reveal, when they move every price at once.</Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={`You rescue ${rescued.ticker ?? "a company"}`}>
          <p className="text-sm text-slate-700">
            <span className="font-mono font-semibold">{rescued.ticker}</span> {rescued.name}: price {money(rescued.market_price)} after the crisis
            {prdScore ? ` · its PRD scored ${prdScore.final_score}` : ""}.
          </p>
          <div className="mt-3">{theirCrisis ? <CardView card={theirCrisis} label="Its crisis card" tone="red" /> : null}</div>
          <p className="mt-3 text-sm">
            <Link href="/team/qa" className="font-semibold underline">
              Ask its founders on the Q&amp;A board
            </Link>{" "}
            (while the board is open; every question and answer is public).
          </p>
          {theirPrd ? (
            <details className="mt-3 rounded-md bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200">
              <summary className="cursor-pointer font-semibold">Its PRD ({theirPrd.word_count} words)</summary>
              <p className="mt-2 whitespace-pre-wrap text-slate-800">{theirPrd.body_text}</p>
            </details>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Its founders saved no PRD before the lock.</p>
          )}
        </Panel>

        <Panel title={`Your own company${built?.ticker ? ` (${built.ticker})` : ""}`}>
          {ownCrisis ? <CardView card={ownCrisis} label="Its crisis card" tone="red" /> : null}
          <p className="mt-3 text-sm text-slate-700">
            Team <span className="font-mono font-semibold">{rescuer ?? "—"}</span> rescues it. Answer their questions on the{" "}
            <Link href="/team/qa" className="underline">
              Q&amp;A board
            </Link>
            . Your own Round 2 points come from the solution you write, never from how well your company is rescued.
          </p>
        </Panel>
      </div>

      <Panel
        title={`Your crisis solution for ${rescued.ticker ?? "the company you rescue"}`}
        actions={
          open && lock ? (
            <span className="text-sm text-slate-600">
              Locks at {clock(lock)} · <Countdown to={lock} className="font-semibold text-slate-900" />
            </span>
          ) : null
        }
      >
        <p className="mb-4 text-sm text-slate-600">
          Up to 500 words in six parts. The judge also reads the company&apos;s PRD and its crisis card. The last version saved before {clock(lock)} is judged:{" "}
          <Link href="/team/judging" className="underline">
            how the judge scores
          </Link>
          .
        </p>
        <DraftEditor
          type="SOLUTION"
          draft={draft}
          editable={open}
          closedNote={closedNote("SOLUTION", facts)}
          deadline={lock}
          paused={status.paused}
          pausedAt={status.paused_at}
          storageKey={backupKey(team.id, "SOLUTION")}
        />
      </Panel>
    </div>
  );
}

/** The code of the team that rescues this team's company, from the public lottery record (teams read only their own row). */
async function loadRescuerCode(eventId: string, myCode: string): Promise<string | null> {
  const sb = await supabaseServer();
  const { data } = await sb.rpc("lottery_record", { p_event: eventId });
  const rec = (data as { record?: { draws: { team: string; rescues: string }[] } } | null)?.record;
  return rec?.draws.find((d) => d.rescues === myCode)?.team ?? null;
}
