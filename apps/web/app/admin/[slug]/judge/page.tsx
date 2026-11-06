import type { Metadata } from "next";
import Link from "next/link";
import { SUBMISSION_TYPES } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent } from "@/lib/admin/event";
import { loadJudgeData } from "@/lib/admin/judge-data";
import { JUDGE_TYPE_LABELS, judgeLines, judgeProgress, pickType, type ScoreStatus } from "@/lib/admin/judge";
import { count } from "@/lib/format";
import { Badge, Notice, Panel, Stat, Table, Td, type Tone } from "@/components/ui/ui";
import { ActionButton } from "@/components/ui/action";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { setModelSlot } from "./actions";

export const metadata: Metadata = { title: "Judge" };

const STATUS_TONE: Record<ScoreStatus | "NOT_LOCKED", Tone> = { NOT_LOCKED: "slate", PENDING: "blue", SCORING: "blue", SEALED: "green", REVEALED: "violet" };
const STATUS_LABEL: Record<ScoreStatus | "NOT_LOCKED", string> = { NOT_LOCKED: "Not locked", PENDING: "Judging", SCORING: "Judging", SEALED: "Sealed", REVEALED: "Revealed" };

// Judge: each round's progress (locked submissions, the three readings, sealed and revealed scores), every company's
// readings, median, penalty and final score, and the backup-model switch. Scores stay secret from everyone but
// organisers until their reveal (PRDs 23:30, solutions 02:45).
export default async function JudgePage({ params, searchParams }: PageProps<"/admin/[slug]/judge">) {
  const { slug } = await params;
  const sp = await searchParams;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  if (viewer!.role !== "ORGANISER") {
    return <Notice tone="amber">Judging is the organisers&apos;. Scores are secret until their reveal; the fairness officer sees them from then on, under Fairness.</Notice>;
  }
  const data = await loadJudgeData(event.id);
  const type = pickType(sp.type, data.crisisApplied);
  const progress = judgeProgress(data, type);
  const lines = judgeLines(data, type);
  const slot = data.slots[type];
  const active = progress.readings.queued + progress.readings.running > 0;

  return (
    <div className="space-y-6">
      <AutoRefresh everyMs={5000} active={active} />
      <nav className="flex gap-2" aria-label="Round">
        {SUBMISSION_TYPES.map((t) => (
          <Link
            key={t}
            href={`/admin/${slug}/judge?type=${t}`}
            aria-current={t === type ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${t === type ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            {JUDGE_TYPE_LABELS[t]}
          </Link>
        ))}
      </nav>

      <Panel
        title={JUDGE_TYPE_LABELS[type]}
        actions={
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-600">Model:</span>
            <Badge tone={slot === "PRIMARY" ? "green" : "amber"}>{slot === "PRIMARY" ? "Primary" : "Backup"}</Badge>
            <ActionButton
              action={setModelSlot.bind(null, event.id, type, slot === "PRIMARY" ? "BACKUP" : "PRIMARY")}
              confirm={`Click again to switch to the ${slot === "PRIMARY" ? "backup" : "primary"} model`}
            >
              Switch to {slot === "PRIMARY" ? "backup" : "primary"}
            </ActionButton>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Locked submissions" value={count(progress.submissions)} hint={`${progress.missing} with nothing saved (score 0)`} />
          <Stat
            label="Readings done"
            value={`${count(progress.readings.done)} of ${count(progress.readings.total)}`}
            hint={`${progress.readings.queued} queued · ${progress.readings.running} running`}
          />
          <Stat label="Failed readings" value={<span className={progress.readings.failed ? "text-red-700" : ""}>{count(progress.readings.failed)}</span>} />
          <Stat
            label="Sealed"
            value={`${count(progress.sealed)} of ${count(progress.companies)}`}
            hint={progress.revealed ? `${progress.revealed} revealed` : progress.complete ? "Every score sealed" : "The phase waits for every score"}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Each submission is read three times, independently; the median counts. Lines aimed at the judge are removed before it reads, and a team&apos;s
          second removed line costs 10 points. The judge worker seals each score when its three readings are in. If the primary model fails, switch
          to the backup: readings claimed from then on use it.
        </p>
      </Panel>

      <Panel title={`Companies (${lines.length})`}>
        <Table head={["Ticker", "Author", "Words", "Readings", "Median", "Penalty", "Final", "Removed lines", "Status"]} empty="No company to judge yet.">
          {lines.map((l) => (
            <tr key={l.companyId} className={l.readings.some((r) => r.status === "FAILED") ? "bg-red-50" : ""}>
              <Td mono className="font-semibold">
                <span title={l.name}>{l.ticker}</span>
              </Td>
              <Td mono>{l.author}</Td>
              <Td mono>{l.words ?? "—"}</Td>
              <Td mono>
                {l.readings.length
                  ? l.readings.map((r) => (
                      <span key={r.runNo} title={r.error ?? r.status} className={`mr-2 ${r.status === "FAILED" ? "text-red-700" : r.status === "DONE" ? "" : "text-slate-400"}`}>
                        {r.total ?? (r.status === "FAILED" ? "✗" : "·")}
                      </span>
                    ))
                  : "—"}
              </Td>
              <Td mono>{l.median ?? "—"}</Td>
              <Td mono>{l.penalty ? `−${l.penalty}` : ""}</Td>
              <Td mono className="font-semibold">{l.final ?? "—"}</Td>
              <Td mono>{l.removed ?? "—"}</Td>
              <Td>
                <Badge tone={STATUS_TONE[l.status]}>{l.missing ? "Missing (0)" : STATUS_LABEL[l.status]}</Badge>
                {l.waiting ? <span className="ml-2 text-xs text-slate-500">{l.waiting}</span> : null}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
