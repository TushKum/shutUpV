import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent } from "@/lib/admin/event";
import { supabaseServer } from "@/lib/supabase/server";
import { correctionOptions, correctionViews, type CorrectionEntryLine, type CorrectionView } from "@/lib/admin/ledger-corrections";
import { loadCorrections, loadLedgerBase } from "@/lib/admin/ledger-data";
import { clock, dateTime } from "@/lib/format";
import { Badge, Notice, Panel, Table, Td } from "@/components/ui/ui";
import { LedgerTabs } from "../tabs";
import { decideCorrection, requestCorrection } from "../actions";
import { DecideCorrection } from "./decide";
import { RequestCorrectionForm } from "./request-form";

const tone = (sign: number) => (sign > 0 ? "text-emerald-700" : sign < 0 ? "text-red-700" : "");

// Ledger corrections need two people: an organiser requests one with a reason; a different organiser or the fairness
// officer approves it (then it is applied to the ledger and published) or rejects it.
export default async function CorrectionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const organiser = viewer!.role === "ORGANISER";
  const sb = await supabaseServer();
  const [base, { corrections, staff }] = await Promise.all([loadLedgerBase(sb, event.id), loadCorrections(sb, event.id)]);
  const { pending, decided } = correctionViews(corrections, {
    teams: new Map(base.teams.map((t) => [t.id, t])),
    companies: new Map(base.companies.map((c) => [c.id, c])),
    staff: new Map(staff.map((s) => [s.user_id, s])),
    viewer: { userId: viewer!.userId, role: viewer!.role },
  });

  return (
    <div className="space-y-6">
      <LedgerTabs slug={slug} current="corrections" pending={pending.length} />

      <Panel title="Pending corrections">
        {pending.length === 0 ? (
          <p className="text-sm text-slate-500">No correction is waiting for a decision.</p>
        ) : (
          <ol className="space-y-4">
            {pending.map((c, i) => (
              <li key={c.id} className="rounded-md border border-amber-200 bg-amber-50/40 p-3" aria-label={`Pending correction ${i + 1}`}>
                <CorrectionHead c={c} />
                <Entries entries={c.entries} />
                {c.canDecide ? (
                  <DecideCorrection decide={decideCorrection.bind(null, c.id)} label={`correction ${i + 1}`} />
                ) : (
                  <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-700">{c.whyNot}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Request a correction">
        {organiser ? (
          <RequestCorrectionForm
            action={requestCorrection.bind(null, event.id)}
            options={correctionOptions(base.teams, base.companies)}
          />
        ) : (
          <Notice>Only organisers request corrections; you can approve or reject the ones another person requested.</Notice>
        )}
      </Panel>

      <Panel title="Decided corrections">
        <Table head={["Decided", "Decision", "Reason", "Entries", "Requested by", "Decided by", "Note", "Transaction"]} empty="No correction has been decided yet.">
          {decided.map((c) => (
            <tr key={c.id} className="align-top">
              <Td mono>{dateTime(c.decidedAt)}</Td>
              <Td>{c.status === "APPROVED" ? <Badge tone="green">Approved</Badge> : <Badge tone="red">Rejected</Badge>}</Td>
              <Td>
                <span className="block min-w-48 max-w-sm whitespace-normal">{c.reason}</span>
              </Td>
              <Td>
                <ul className="space-y-0.5 font-mono text-xs">
                  {c.entries.map((e, i) => (
                    <li key={i}>{entryText(e)}</li>
                  ))}
                </ul>
              </Td>
              <Td>{c.requestedBy}</Td>
              <Td>{c.decidedBy}</Td>
              <Td>
                <span className="block max-w-xs whitespace-normal">{c.note ?? ""}</span>
              </Td>
              <Td mono>{c.txn ?? ""}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}

function CorrectionHead({ c }: { c: CorrectionView }) {
  return (
    <div>
      <p className="text-sm text-slate-600">
        Requested by <strong className="text-slate-900">{c.requestedBy}</strong> at {clock(c.requestedAt, true)} · {c.entries.length}{" "}
        {c.entries.length === 1 ? "entry" : "entries"}
      </p>
      <p className="mt-1 text-sm text-slate-900">“{c.reason}”</p>
    </div>
  );
}

function Entries({ entries }: { entries: CorrectionEntryLine[] }) {
  return (
    <Table head={["Team", "Company", "Lot", "Cash change", "Share change"]} className="mt-2">
      {entries.map((e, i) => (
        <tr key={i}>
          <Td mono className="font-semibold">
            {e.party}
          </Td>
          <Td mono>{e.ticker}</Td>
          <Td mono>{e.lot}</Td>
          <Td mono className={tone(e.cashSign)}>
            {e.cash}
          </Td>
          <Td mono>{e.shares}</Td>
        </tr>
      ))}
    </Table>
  );
}

const entryText = (e: CorrectionEntryLine) =>
  [e.party, e.ticker, e.lot, e.cash, e.shares ? `${e.shares} shares` : ""].filter(Boolean).join(" · ");
