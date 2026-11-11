import type { Metadata } from "next";
import Link from "next/link";
import Form from "next/form";
import { PHASE_CODES, PHASE_LABELS, TRACK_LABELS, type PhaseCode } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent } from "@/lib/admin/event";
import { supabaseServer } from "@/lib/supabase/server";
import { ledgerLines, ledgerRefs } from "@/lib/admin/ledger";
import { loadLedgerBase, type LedgerTeam } from "@/lib/admin/ledger-data";
import {
  FLAG_STATUS_LABELS,
  callLines,
  decisionLog,
  flagLabel,
  flagSummary,
  flagViews,
  holdingLines,
  orderLines,
  resultView,
  type FlagStatus,
  type FlagView,
} from "@/lib/admin/fairness";
import { loadDrillDown, loadFlags, type DrillDown } from "@/lib/admin/fairness-data";
import { clock, dateTime, money } from "@/lib/format";
import { Badge, Notice, Panel, Stat, Table, Td, buttonClass, inputClass, type Tone } from "@/components/ui/ui";
import { ConfirmForm } from "@/components/ui/action";
import { decideFlag } from "./actions";

export const metadata: Metadata = { title: "Fairness" };

const STATUS_TONE: Record<FlagStatus, Tone> = { OPEN: "amber", CLEARED: "green", DISQUALIFIED: "red" };
const reached = (phase: PhaseCode, target: PhaseCode) => PHASE_CODES.indexOf(phase) >= PHASE_CODES.indexOf(target);
const tone = (sign: number) => (sign > 0 ? "text-emerald-700" : sign < 0 ? "text-red-700" : "");

// Fairness (the fairness officer only): the collusion flags raised at settlement, a decision on each (clear it or
// disqualify the teams involved, with a logged reason), the log of decisions, and a drill-down into any team.
export default async function FairnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  if (viewer!.role !== "FAIRNESS") {
    return (
      <Notice tone="amber">
        Collusion flags, their decisions and the team drill-down are for the fairness officer only. Organisers do not see them.
      </Notice>
    );
  }
  const sp = await searchParams;
  const pick = (Array.isArray(sp.team) ? sp.team[0] : sp.team)?.trim().toUpperCase() ?? "";
  const sb = await supabaseServer();
  const [base, { flags, audit, staff }] = await Promise.all([loadLedgerBase(sb, event.id), loadFlags(sb, event.id)]);
  const teams = new Map(base.teams.map((t) => [t.id, t]));
  const companies = new Map(base.companies.map((c) => [c.id, c]));
  const staffMap = new Map(staff.map((s) => [s.user_id, s]));
  const views = flagViews(flags, { teams, companies, staff: staffMap });
  const log = decisionLog(audit, new Map(views.map((v) => [v.id, v])), staffMap);
  const team = pick ? (base.teams.find((t) => t.code === pick) ?? null) : null;
  const drill = team ? await loadDrillDown(sb, team.id) : null;
  const phase = event.current_phase;
  const locked = reached(phase, "AWARDS");
  const refs = ledgerRefs(base.teams, base.companies, base.rounds);

  return (
    <div className="space-y-6">
      <Panel title="Collusion flags">
        <p className="text-sm text-slate-600">
          Raised at settlement. Clear a flag, or disqualify the teams involved (they are excluded from the awards); every decision is logged with its
          reason. {locked ? "Decisions were final at the awards." : "A decision can be changed until the awards."}
        </p>
        <p className="mt-2 text-sm font-medium text-slate-900" data-testid="flag-summary">
          {flagSummary(flags)}
          {flags.length === 0 && !reached(phase, "SETTLEMENT") ? ` Flags are generated when the event enters Settlement (it is in ${PHASE_LABELS[phase]}).` : ""}
        </p>
        {views.length ? (
          <ol className="mt-4 space-y-4">
            {views.map((v, i) => (
              <FlagCard key={v.id} v={v} n={i + 1} slug={slug} locked={locked} />
            ))}
          </ol>
        ) : null}
      </Panel>

      <Panel title="Decisions">
        <Table head={["Time", "Who", "Flag", "Decision", "Reason"]} empty="No decisions yet.">
          {log.map((d) => (
            <tr key={d.id} className="align-top">
              <Td mono>{dateTime(d.at)}</Td>
              <Td>{d.who}</Td>
              <Td mono>{d.flag}</Td>
              <Td>
                <Badge tone={STATUS_TONE[d.decision]}>{FLAG_STATUS_LABELS[d.decision]}</Badge>
              </Td>
              <Td>
                <span className="block min-w-48 max-w-md whitespace-normal">{d.reason}</span>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <div id="drill-down">
        <Panel title="Team drill-down">
          <Form action={`/admin/${slug}/fairness`} className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Team code</span>
              <select name="team" defaultValue={team?.code ?? ""} className={`${inputClass} w-36`}>
                <option value="">Choose…</option>
                {(["PRODUCT", "CONSULTING", "FINANCE"] as const).map((track) => (
                  <optgroup key={track} label={TRACK_LABELS[track]}>
                    {base.teams
                      .filter((t) => t.track === track)
                      .map((t) => (
                        <option key={t.id} value={t.code}>
                          {t.code}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button type="submit" className={buttonClass.primary}>
              Show
            </button>
          </Form>
          {pick && !team ? (
            <div className="mt-4">
              <Notice tone="amber">No team {pick} in this event.</Notice>
            </div>
          ) : null}
          {team && drill ? (
            <TeamDrillDown
              slug={slug}
              team={team}
              drill={drill}
              refs={refs}
              flags={views.filter((v) => v.teams.some((t) => t.id === team.id))}
              settled={reached(phase, "SETTLEMENT")}
            />
          ) : null}
        </Panel>
      </div>
    </div>
  );
}

function FlagCard({ v, n, slug, locked }: { v: FlagView; n: number; slug: string; locked: boolean }) {
  const codes = v.teams.map((t) => t.code);
  return (
    <li aria-label={`Flag ${n}`} className={`rounded-md border p-4 ${v.status === "OPEN" ? "border-amber-200 bg-amber-50/40" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="violet">Flag {v.kind}</Badge>
        <h3 className="text-sm font-semibold text-slate-900">{v.title}</h3>
        <Badge tone={STATUS_TONE[v.status]}>{FLAG_STATUS_LABELS[v.status]}</Badge>
      </div>
      <p className="mt-1 text-sm text-slate-600">{v.rule}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        {v.ticker ? (
          <>
            <dt className="text-slate-500">Company</dt>
            <dd className="font-mono font-semibold">{v.ticker}</dd>
          </>
        ) : null}
        <dt className="text-slate-500">Teams</dt>
        <dd className="flex flex-wrap gap-x-3">
          {v.teams.map((t) => (
            <Link key={t.id} href={`/admin/${slug}/fairness?team=${encodeURIComponent(t.code)}#drill-down`} className="font-mono hover:underline">
              {t.code}
              {t.track ? <span className="font-sans text-xs text-slate-500"> ({t.track})</span> : null}
            </Link>
          ))}
        </dd>
        {v.details.map((d) => (
          <Detail key={d.label} label={d.label} value={d.value} />
        ))}
      </dl>
      {v.status !== "OPEN" ? (
        <p className="mt-3 text-sm text-slate-700">
          {FLAG_STATUS_LABELS[v.status]} by {v.decidedBy ?? "—"} at {dateTime(v.decidedAt)}: “{v.reason}”
        </p>
      ) : null}
      {locked ? null : v.status === "OPEN" ? (
        <DecisionForm flagId={v.id} codes={codes} label="Record decision" />
      ) : (
        // Keyed by the decision, so it closes once a new decision is recorded (the card then shows it).
        <details key={v.decidedAt ?? ""} className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Change the decision</summary>
          <DecisionForm flagId={v.id} codes={codes} label="Change decision" />
        </details>
      )}
    </li>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </>
  );
}

function DecisionForm({ flagId, codes, label }: { flagId: string; codes: string[]; label: string }) {
  return (
    <ConfirmForm
      action={decideFlag.bind(null, flagId, codes)}
      submit={label}
      confirm="Click again to {decision}"
      confirmValues={{ decision: { CLEARED: "clear the flag", DISQUALIFIED: `disqualify ${codes.join(", ")}` } }}
      className="mt-3 border-t border-slate-100 pt-3"
    >
      <fieldset>
        <legend className="text-xs font-medium text-slate-600">Decision</legend>
        <div className="mt-1 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="decision" value="CLEARED" required />
            Clear the flag
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="decision" value="DISQUALIFIED" />
            Disqualify {codes.join(", ")}
          </label>
        </div>
      </fieldset>
      <label className="mt-2 block max-w-xl">
        <span className="text-xs font-medium text-slate-600">Reason (at least 5 characters; logged)</span>
        <textarea name="reason" required rows={2} maxLength={1000} className={inputClass} />
      </label>
    </ConfirmForm>
  );
}

function TeamDrillDown({
  slug,
  team,
  drill,
  refs,
  flags,
  settled,
}: {
  slug: string;
  team: LedgerTeam;
  drill: DrillDown;
  refs: ReturnType<typeof ledgerRefs>;
  flags: FlagView[];
  settled: boolean;
}) {
  const holdings = holdingLines(drill.holdings, refs);
  const orders = orderLines(drill.orders, refs);
  const calls = callLines(drill.calls, refs);
  const ledger = ledgerLines(drill.ledger, refs);
  const result = resultView(drill.result);
  return (
    <div className="mt-5 space-y-5" data-testid="drill-down">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-lg font-semibold text-slate-900">{team.code}</h3>
        <span className="text-sm text-slate-600">
          {team.name} · {TRACK_LABELS[team.track]}
        </span>
        {team.disqualified ? <Badge tone="red">Disqualified</Badge> : <Badge tone="green">Not disqualified</Badge>}
      </div>
      {team.disqualified ? <Notice tone="red">Disqualified: {team.disqualified_reason ?? "—"}</Notice> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Cash" value={money(team.cash_cents)} />
        {team.track === "FINANCE" ? <Stat label="Collateral" value={money(team.collateral_cents)} /> : null}
        {result ? (
          <>
            <Stat label="Final value" value={result.final} hint={`Start ${result.start}`} />
            <Stat label="Return" value={result.returnPct} />
            <Stat label="Rank" value={result.rank} hint={result.eligible ? undefined : "Excluded from the awards"} />
          </>
        ) : (
          <Stat label="Result" value="—" hint={settled ? "No result for this team" : "Computed at settlement"} />
        )}
      </div>

      {flags.length ? (
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Flags naming {team.code}</h4>
          <ul className="mt-1 space-y-1 text-sm">
            {flags.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{flagLabel(f)}</span>
                <Badge tone={STATUS_TONE[f.status]}>{FLAG_STATUS_LABELS[f.status]}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section aria-label="Holdings by lot">
        <h4 className="text-sm font-semibold text-slate-900">Holdings by lot</h4>
        <Table head={["Ticker", "Lot", "Shares", "Cost"]} empty="No shares held.">
          {holdings.map((h) => (
            <tr key={h.key}>
              <Td mono className="font-semibold">
                {h.ticker}
              </Td>
              <Td mono>{h.lot}</Td>
              <Td mono>{h.qty}</Td>
              <Td mono>{h.cost}</Td>
            </tr>
          ))}
        </Table>
      </section>

      {team.track === "FINANCE" ? (
        <section aria-label="Orders">
          <h4 className="text-sm font-semibold text-slate-900">Orders across rounds</h4>
          <div className="max-h-96 overflow-y-auto">
            <Table head={["Round", "Ticker", "Type", "Quantity", "Status", "Entry price", "Fill price", "Placed"]} empty="No orders.">
              {orders.map((o) => (
                <tr key={o.id}>
                  <Td mono>{o.round}</Td>
                  <Td mono>{o.ticker}</Td>
                  <Td>{o.type}</Td>
                  <Td mono>{o.qty}</Td>
                  <Td>{o.status}</Td>
                  <Td mono>{o.entryPrice}</Td>
                  <Td mono>{o.fillPrice}</Td>
                  <Td mono>{clock(o.placedAt, true)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </section>
      ) : null}

      {team.track === "CONSULTING" ? (
        <section aria-label="Consultant calls">
          <h4 className="text-sm font-semibold text-slate-900">Consultant calls</h4>
          <Table head={["Call", "Ticker", "Direction", "Made", "Baseline", "Judged at", "Outcome", "Earnings"]} empty="No calls.">
            {calls.map((c) => (
              <tr key={c.key}>
                <Td mono>{c.callNo}</Td>
                <Td mono>{c.ticker}</Td>
                <Td>{c.direction}</Td>
                <Td mono>{clock(c.madeAt, true)}</Td>
                <Td mono>{c.baseline}</Td>
                <Td mono>{c.judged}</Td>
                <Td>{c.outcome}</Td>
                <Td mono>{c.earnings}</Td>
              </tr>
            ))}
          </Table>
        </section>
      ) : null}

      <section aria-label="Ledger rows">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-900">Ledger rows</h4>
          <Link href={`/admin/${slug}/ledger?team=${encodeURIComponent(team.code)}`} className="text-sm text-slate-600 hover:underline">
            Open in the ledger
          </Link>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <Table head={["Time", "Transaction", "Kind", "Ticker", "Lot", "Cash change", "Share change", "Price", "Round", "Memo"]} empty="No ledger rows.">
            {ledger.map((l) => (
              <tr key={l.id}>
                <Td mono>{clock(l.at, true)}</Td>
                <Td mono>
                  <span title={l.txnId}>{l.txn}</span>
                </Td>
                <Td>{l.kindLabel}</Td>
                <Td mono>{l.ticker}</Td>
                <Td mono>{l.lot}</Td>
                <Td mono className={tone(l.cashSign)}>
                  {l.cash}
                </Td>
                <Td mono>{l.shares}</Td>
                <Td mono>{l.price}</Td>
                <Td mono>{l.round}</Td>
                <Td className="text-slate-600">
                  <span className="block min-w-48 max-w-md whitespace-normal">{l.memo}</span>
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      </section>
    </div>
  );
}
