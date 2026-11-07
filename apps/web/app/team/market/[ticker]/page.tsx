import type { Metadata } from "next";
import Link from "next/link";
import { phaseReached, type SubmissionType } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadCompanyView, type PublicSubmission } from "@/lib/team/market-data";
import { PUBLIC_FROM, SUBMISSION_TITLES, chartPoints, historyLines, marketOpensText } from "@/lib/team/market";
import { LineChart } from "@/components/ui/line-chart";
import { clock, money } from "@/lib/format";
import { Badge, Notice, Panel, Stat, Table, Td } from "@/components/ui/ui";
import { ScoreCard } from "../../score-card";
import { Submission } from "../submission";
import { CrisisCard } from "../crisis-card";

export const metadata: Metadata = { title: "Market" };

const TONE = { 1: "text-emerald-700", 0: "text-slate-600", [-1]: "text-red-700" } as const;

// One company: its prices and chart, and everything public about it so far: the PRD and its score (from 23:30), the
// crisis card (from 23:45), the crisis solution (from 02:15) and its score (from 02:45), and every price change.
export default async function CompanyPage({ params }: PageProps<"/team/market/[ticker]">) {
  const { ticker } = await params;
  const { event, status, built, rescued } = await loadTeamContext();
  const back = (
    <Link href="/team/market" className="text-sm font-medium text-slate-700 underline underline-offset-2">
      ← All companies
    </Link>
  );
  if (!phaseReached(status.phase, "REVEAL_1")) {
    return (
      <div className="space-y-4">
        {back}
        <Notice>{marketOpensText()}</Notice>
      </div>
    );
  }
  const code = decodeURIComponent(ticker).toUpperCase();
  const view = /^[A-Z]{4}$/.test(code) ? await loadCompanyView(event.id, code, status.phase) : null;
  if (!view) {
    return (
      <div className="space-y-4">
        {back}
        <Notice tone="amber">No company has the ticker {code.slice(0, 8)}.</Notice>
      </div>
    );
  }
  const { company: c, history, submissions, scores, crisis, types } = view;
  const lines = historyLines(history);
  const waiting = (["PRD", "SOLUTION"] as SubmissionType[]).filter((t) => !types.includes(t));

  return (
    <div className="space-y-6">
      {back}
      <Panel
        title={
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono">{c.ticker}</span>
            <span>{c.name}</span>
            {built?.id === c.id ? <Badge tone="violet">You built it</Badge> : rescued?.id === c.id ? <Badge tone="amber">You rescue it</Badge> : null}
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Market price" value={money(c.market_price)} />
          <Stat label="Score-based price" value={money(c.score_price)} hint="start × 0.85 × reveal factor" />
          <Stat label="Starting price" value={money(c.start_price)} hint={c.post_crisis_price ? `${money(c.post_crisis_price)} after the crisis` : undefined} />
          {c.closing_price !== null ? <Stat label="Closing price" value={money(c.closing_price)} hint="½ market + ½ score-based" /> : <Stat label="Closing price" value="—" hint="at the closing bell" />}
        </div>
        <div className="mt-4">
          <LineChart points={chartPoints(lines)} label={`${c.ticker} price by step`} mainName="Market price" secondName="Score-based price" testId="price-chart" />
        </div>
      </Panel>

      {crisis ? (
        <Panel title="Crisis card">
          <CrisisCard card={crisis} />
        </Panel>
      ) : null}

      {types.includes("SOLUTION") ? (
        <SubmissionPanel type="SOLUTION" s={submissions.SOLUTION} score={scores.SOLUTION ?? null} note={scores.SOLUTION ? null : "Its score is revealed at the score reveal."} />
      ) : null}
      {types.includes("PRD") ? <SubmissionPanel type="PRD" s={submissions.PRD} score={scores.PRD ?? null} note={null} /> : null}
      {waiting.length ? <p className="text-sm text-slate-500">{waiting.map((t) => PUBLIC_FROM[t]).join(" ")}</p> : null}

      <Panel title="Price history">
        <Table head={["Step", "Time", "Price", "Change", "Score-based price", "Detail"]} label="Price history" empty="No price yet.">
          {lines.map((l) => (
            <tr key={l.key}>
              <Td className="font-medium">{l.label}</Td>
              <Td mono>{clock(l.at)}</Td>
              <Td mono className="text-right font-semibold">
                {money(l.price)}
              </Td>
              <Td mono className={`text-right ${TONE[l.changeSign]}`}>
                {l.change}
              </Td>
              <Td mono className="text-right">
                {money(l.scorePrice)}
              </Td>
              <Td className="text-slate-600">{l.detail}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}

function SubmissionPanel({
  type,
  s,
  score,
  note,
}: {
  type: SubmissionType;
  s: PublicSubmission | undefined;
  score: Parameters<typeof ScoreCard>[0]["score"] | null;
  note: string | null;
}) {
  return (
    <Panel title={SUBMISSION_TITLES[type]}>
      {score ? (
        <div className="mb-4 border-b border-slate-100 pb-4">
          <ScoreCard type={type} score={score} />
        </div>
      ) : note ? (
        <p className="mb-3 text-sm text-slate-500">{note}</p>
      ) : null}
      {s ? <Submission type={type} s={s} /> : <p className="text-sm text-slate-500">Nothing was saved before the lock.</p>}
    </Panel>
  );
}
