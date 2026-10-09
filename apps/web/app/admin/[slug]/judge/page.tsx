import type { Metadata } from "next";
import Link from "next/link";
import type { DeadlineCode, SubmissionType } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { loadJudgeData } from "@/lib/admin/judge-data";
import {
  JUDGE_COLUMNS,
  JUDGE_TYPES,
  TYPE_NAMES,
  TYPE_TITLES,
  companyViews,
  defaultJudgeType,
  refreshInterval,
  parseJudgeType,
  summarise,
  type CompanyJudgeView,
  type TypeSummary,
} from "@/lib/admin/judge";
import { clock } from "@/lib/format";
import { Badge, Notice, Panel, Table } from "@/components/ui/ui";
import { ActionButton } from "@/components/ui/action";
import { Countdown } from "@/components/ui/countdown";
import { CompanyRow } from "./company-row";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { releaseScores, sealMissingScores } from "./actions";

export const metadata: Metadata = { title: "Judge" };

// Judge: per type a summary and every company's runs, spread, median and final score; sealing the 0 of companies with
// no on-time submission; the release. Running the judge itself (and re-runs for an appeal) comes in Phase 6.
export default async function JudgePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const [status, data] = await Promise.all([loadEventStatus(event.id), loadJudgeData(event.id)]);
  const organiser = viewer!.role === "ORGANISER";
  const type = parseJudgeType(query.type) ?? defaultJudgeType(status.phase);
  const views = Object.fromEntries(JUDGE_TYPES.map((t) => [t, companyViews(t, data)])) as Record<SubmissionType, CompanyJudgeView[]>;
  const summaries = Object.fromEntries(JUDGE_TYPES.map((t) => [t, summarise(t, views[t])])) as Record<SubmissionType, TypeSummary>;
  const summary = summaries[type];
  const released = summary.released > 0;
  const refresh = refreshInterval(JUDGE_TYPES.map((t) => summaries[t]));

  return (
    <div className="space-y-6">
      <AutoRefresh everyMs={refresh ?? 15_000} active={refresh !== null} />
      <Notice tone="blue">
        Running the judge (the AI worker that scores every submission 3 times, or 5 when the runs spread more than 10 points), the backup-model switch
        and re-running one submission for a technical appeal come in Phase 6. Here you can follow every stored run, seal the 0 of companies with no
        on-time submission and release the scores.
      </Notice>

      <div className="grid gap-4 md:grid-cols-3">
        {JUDGE_TYPES.map((t) => (
          <SummaryCard key={t} slug={slug} summary={summaries[t]} selected={t === type} />
        ))}
      </div>

      <nav className="flex gap-1 border-b border-slate-200" aria-label="Submission type">
        {JUDGE_TYPES.map((t) => (
          <Link
            key={t}
            href={`/admin/${slug}/judge?type=${t.toLowerCase()}`}
            aria-current={t === type ? "page" : undefined}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${t === type ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-900"}`}
          >
            {TYPE_TITLES[t]}
          </Link>
        ))}
      </nav>

      <Panel
        title={`${TYPE_TITLES[type]} scores`}
        actions={
          <>
            {released ? <Badge tone="green">Released {clock(summary.releasedAt)}</Badge> : null}
            {organiser ? (
              <>
                {/* Kept mounted (disabled) after the release, so the release's own message stays on screen; keyed by type so a
                    message never carries over to another type's tab. */}
                <ActionButton
                  key={`seal-${type}`}
                  action={sealMissingScores.bind(null, event.id, type)}
                  confirm={`Click again to seal missing ${TYPE_NAMES[type]} scores as 0`}
                  disabled={released}
                  title={released ? `${TYPE_TITLES[type]} scores have been released.` : undefined}
                >
                  Seal missing as 0
                </ActionButton>
                <ActionButton
                  key={`release-${type}`}
                  action={releaseScores.bind(null, event.id, type)}
                  confirm={`Click again to release ${TYPE_NAMES[type]} scores`}
                  variant="primary"
                  disabled={released}
                  title={released ? `${TYPE_TITLES[type]} scores have been released.` : undefined}
                >
                  Release {TYPE_NAMES[type]} scores
                </ActionButton>
              </>
            ) : (
              <span className="text-sm text-slate-500">Organisers seal and release scores.</span>
            )}
          </>
        }
      >
        <Rules type={type} deadlines={data.deadlines} />
        {summary.stale > 0 ? (
          <div className="mt-3">
            <Notice tone="red">
              {summary.stale} score{summary.stale === 1 ? " was" : "s were"} sealed for a submission that is no longer the current one. The release
              refuses until {summary.stale === 1 ? "it is" : "they are"} judged again.
            </Notice>
          </div>
        ) : null}
        <Table head={[...JUDGE_COLUMNS]} empty="No companies yet: they are formed at the squad draw." className="mt-4">
          {views[type].map((v) => (
            <CompanyRow key={`${type}-${v.company.id}`} type={type} view={v} />
          ))}
        </Table>
      </Panel>
    </div>
  );
}

function SummaryCard({ slug, summary: s, selected }: { slug: string; summary: TypeSummary; selected: boolean }) {
  const runs = s.runs;
  const anyRuns = runs.QUEUED + runs.RUNNING + runs.DONE + runs.FAILED > 0;
  return (
    <Panel
      title={TYPE_TITLES[s.type]}
      className={selected ? "ring-2 ring-slate-900" : ""}
      actions={
        s.released > 0 ? (
          <Badge tone="green">Released</Badge>
        ) : s.unsealed === 0 && s.companies > 0 ? (
          <Badge tone="blue">All sealed</Badge>
        ) : (
          <Badge tone="slate">Not released</Badge>
        )
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm" aria-label={`${TYPE_TITLES[s.type]} summary`}>
        <dt className="text-slate-500">Companies</dt>
        <dd className="tabular-nums">{s.companies}</dd>
        <dt className="text-slate-500">Submissions</dt>
        <dd className="tabular-nums">
          {s.submissions}
          {s.companies > s.submissions ? <span className="text-slate-500"> · {s.companies - s.submissions} without</span> : null}
        </dd>
        <dt className="text-slate-500">Judge runs</dt>
        <dd className="tabular-nums">
          {anyRuns ? (
            <>
              {runs.DONE} done · {runs.RUNNING} running · {runs.QUEUED} queued ·{" "}
              <span className={runs.FAILED > 0 ? "font-semibold text-red-700" : ""}>{runs.FAILED} failed</span>
            </>
          ) : (
            "None yet"
          )}
        </dd>
        <dt className="text-slate-500">Scores</dt>
        <dd className="tabular-nums">
          {s.sealed} sealed · {s.released} released · {s.missing} missing
        </dd>
        <dt className="text-slate-500">Not sealed</dt>
        <dd className="tabular-nums">{s.unsealed}</dd>
      </dl>
      <Link href={`/admin/${slug}/judge?type=${s.type.toLowerCase()}`} className="mt-2 inline-block text-sm font-semibold text-slate-700 underline">
        {selected ? "Shown below" : `Show ${TYPE_NAMES[s.type]} scores`}
      </Link>
    </Panel>
  );
}

function When({ at }: { at: string | undefined }) {
  if (!at) return <span>—</span>;
  return (
    <span className="font-mono tabular-nums">
      {clock(at)} (<Countdown to={at} passed="passed" />)
    </span>
  );
}

function Rules({ type, deadlines }: { type: SubmissionType; deadlines: Partial<Record<DeadlineCode, string>> }) {
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-600">
      {type === "PITCH" ? (
        <>
          <li>
            Pitch submissions close at <When at={deadlines.PITCH} />. Scores are sealed after that, and missing pitches can then be sealed as 0.
          </li>
          <li>
            Release after consultant call 1 closes at <When at={deadlines.CALL_1} />, in Reading, between rounds. It sets every company&apos;s IPO price
            ($10.00 × (1 + tier)).
          </li>
        </>
      ) : type === "PLAN" ? (
        <>
          <li>
            Plans close at <When at={deadlines.PLAN} /> and deals at <When at={deadlines.DEAL} />; scores are sealed after both. A plan whose deal was not
            fully signed by then is capped at 50.
          </li>
          <li>Release at Verdicts (03:30). The tier moves both the market price and the AI price.</li>
        </>
      ) : (
        <>
          <li>
            Flash answers close at <When at={deadlines.FLASH} />. Scores are sealed after that.
          </li>
          <li>
            Release after round 17 clears (<When at={deadlines.FLASH_TIER} />). The tier moves both the market price and the AI price, and consultant call 2
            is judged.
          </li>
        </>
      )}
      <li>A second injection offence by the same squad costs 10 points (penalty). The final score is the median, capped, minus the penalty.</li>
    </ul>
  );
}
