import type { Metadata } from "next";
import Link from "next/link";
import { phaseReached, startPrice } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadDeadline, loadDraft, loadProblemCard, loadRevealedScore, loadTwist, writingFacts } from "@/lib/team/round-data";
import { closedNote, writingOpen } from "@/lib/team/writing";
import { backupKey } from "@/lib/team/editor";
import { clock, money } from "@/lib/format";
import { Badge, Notice, Panel } from "@/components/ui/ui";
import { Countdown } from "@/components/ui/countdown";
import { RefreshAt } from "@/lib/live/refresh-at";
import { DraftEditor } from "../draft-editor";
import { CardView } from "../card";
import { ScoreCard } from "../score-card";

export const metadata: Metadata = { title: "Round 1: PRD" };

// Round 1 (21:15–23:00): the problem card the lottery dealt, the twist (22:15), the PRD editor (nine parts, 800 words,
// the company name and a unique ticker, autosaved), and from 23:30 the PRD's score and starting price.
export default async function BuildPage() {
  const ctx = await loadTeamContext();
  const { team, event, status, built } = ctx;
  const [lock, draft, card, twist, score] = await Promise.all([
    loadDeadline(event.id, "PRD_LOCK"),
    loadDraft(team.id, "PRD"),
    loadProblemCard(built?.problem_card_id ?? null),
    loadTwist(event.id),
    built ? loadRevealedScore(built.id, "PRD") : Promise.resolve(null),
  ]);
  const facts = writingFacts(ctx, lock);
  const open = writingOpen("PRD", facts);
  const twistAt = await loadDeadline(event.id, "TWIST");

  return (
    <div className="space-y-6">
      <RefreshAt at={open ? lock : null} />
      {score && built ? (
        <Panel title="Your PRD's score">
          <ScoreCard
            type="PRD"
            score={score}
            extra={
              <span className="text-sm text-slate-700">
                Starting share price of <span className="font-mono font-semibold">{built.ticker}</span>:{" "}
                <span className="font-mono font-semibold">{money(built.start_price ?? (score.final_score !== null ? startPrice(score.final_score) : null))}</span>
              </span>
            }
          />
          <p className="mt-3 text-xs text-slate-500">Starting price = $10.00 + $0.10 × (score − 50). Round 1 points = your PRD score.</p>
        </Panel>
      ) : phaseReached(status.phase, "JUDGING_1") ? (
        <Notice tone="blue">Your PRD is locked and being judged. Scores and starting prices are revealed together once every PRD is judged.</Notice>
      ) : null}

      <Panel title="Your problem card">
        {card ? (
          <CardView card={card} label="Problem card" />
        ) : (
          <p className="text-sm text-slate-600">The lottery deals one problem card to every team when Build starts (up to three teams share a card).</p>
        )}
      </Panel>

      <Panel title="The twist" actions={twist ? <Badge tone="violet">Published {clock(twist.published_at)}</Badge> : null}>
        {twist ? (
          <div>
            <p className="font-semibold text-slate-900">{twist.title}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{twist.body}</p>
            <p className="mt-2 text-xs text-slate-500">Your PRD is expected to deal with it.</p>
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            One twist goes out to every team at the same moment, {twistAt ? <>at {clock(twistAt)} (<Countdown to={twistAt} />)</> : "during Build"}. Your PRD is expected to
            deal with it.
          </p>
        )}
      </Panel>

      <Panel
        title="Your PRD"
        actions={
          open && lock ? (
            <span className="text-sm text-slate-600">
              Locks at {clock(lock)} · <Countdown to={lock} className="font-semibold text-slate-900" />
            </span>
          ) : null
        }
      >
        <p className="mb-4 text-sm text-slate-600">
          Up to 800 words in nine parts, plus your company&apos;s name and a four-letter ticker. Everyone in your team can type at once; it saves on its own.
          The last version saved before {clock(lock)} is judged (three readings, the median counts):{" "}
          <Link href="/team/judging" className="underline">
            how the judge scores
          </Link>
          .
        </p>
        <DraftEditor
          type="PRD"
          draft={draft}
          editable={open}
          closedNote={closedNote("PRD", facts)}
          deadline={lock}
          paused={status.paused}
          pausedAt={status.paused_at}
          storageKey={backupKey(team.id, "PRD")}
        />
      </Panel>
    </div>
  );
}
