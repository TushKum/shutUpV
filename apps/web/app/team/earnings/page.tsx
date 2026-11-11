import type { Metadata } from "next";
import Link from "next/link";
import { loadTeamContext } from "@/lib/team/context";
import { sectionAllowed } from "@/lib/team/sections";
import { supabaseServer } from "@/lib/supabase/server";
import { loadEarnings } from "@/lib/team/earnings-data";
import { callsInput } from "@/lib/team/calls-data";
import { CALL_WINDOWS, callCell, coveredLabels, findCall, windowStage } from "@/lib/team/calls";
import { bonusesPaid, earnings, type LineStatus } from "@/lib/team/earnings";
import { dealView, feeView } from "@/lib/team/rescue";
import { pauseOf } from "@/lib/team/rescue-data";
import { clock, money, signedMoney } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { Badge, Notice, Panel, Stat } from "@/components/ui/ui";

export const metadata: Metadata = { title: "Earnings" };

const STATUS: Record<LineStatus, { tone: "green" | "amber" | "slate"; text: string }> = {
  FINAL: { tone: "green", text: "Final" },
  PROJECTION: { tone: "amber", text: "Projection" },
  PENDING: { tone: "slate", text: "Not known yet" },
};

// What a Consulting team earns: the fee (cash, and fee shares at the current price, at the closing price after the
// close), the deal bonus, the plan bonus once the plan score is released, and each call; projections are labelled as
// such. The bonuses and call earnings are paid as cash at settlement. No ranking is shown.
export default async function EarningsPage() {
  const ctx = await loadTeamContext();
  if (!sectionAllowed(ctx.team.track, "/earnings")) {
    return (
      <Notice tone="blue">
        The earnings breakdown is for the Consulting teams.{" "}
        <Link href="/team" className="font-semibold underline">
          Back to Home
        </Link>
      </Notice>
    );
  }
  if (!ctx.squad) {
    return <Notice>The squads are formed at the squad draw. Your earnings (the advisor&apos;s fee, the bonuses and your calls) are shown here from then.</Notice>;
  }
  const sb = await supabaseServer();
  const data = await loadEarnings(sb, ctx);
  const pause = pauseOf(ctx);
  const nowMs = Date.parse(ctx.status.server_time);
  const crisisApplied = ctx.event.crisis_applied_at !== null;
  const base = { ...pause, phase: ctx.status.phase, crisisApplied, nowMs, track: ctx.team.track, squad: ctx.squad };
  const deadlines = data.calls.deadlines;
  const fee = feeView({ ...base, deadline: deadlines.FEE ?? null, fee: data.fee });
  const deal = dealView({ ...base, deadlines, deal: data.deal, postCrisis: data.prices.postCrisis });
  const input = callsInput(ctx, data.calls);
  const companies = coveredLabels(data.calls.coverage, data.calls.companies);
  const calls = CALL_WINDOWS.flatMap((w) => companies.map((c) => ({ label: c.label, no: w.no, cell: callCell(findCall(data.calls.calls, c.id, w.no), windowStage(w.no, input)) })));
  const e = earnings({
    fee,
    feeShares: data.feeShares,
    marketPrice: data.prices.market,
    closingPrice: data.prices.closing,
    marketClosed: data.calls.marketClosedAt !== null,
    deal,
    plan: data.plan,
    calls,
    times: { fee: deadlines.FEE ? clock(deadlines.FEE) : null, bonus: deadlines.DEAL_BONUS ? clock(deadlines.DEAL_BONUS) : null },
  });
  const paid = bonusesPaid(data.paid);
  const settled = data.calls.settledAt !== null;

  return (
    <div className="space-y-4">
      {/* The fee and the deal change without a broadcast while they are being agreed. */}
      <AutoRefresh everyMs={15_000} active={fee.stage === "OPEN" || fee.stage === "DEFAULT_PENDING" || deal.stage === "OPEN"} />
      <Panel title="Your earnings">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Stat label={e.final ? "Final total" : "Secured so far"} value={<span data-testid="earnings-secured">{money(e.secured)}</span>} hint="Lines marked Final" />
          {e.final ? null : (
            <Stat
              label="Projection"
              value={<span data-testid="earnings-projected">{money(e.projected)}</span>}
              hint="Final lines plus projections; not a promise"
            />
          )}
          {e.final ? null : <Stat label="Not known yet" value={e.pending} hint={e.pending === 1 ? "line" : "lines"} />}
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Your final value is your cash (the fee&apos;s cash and the bonuses, paid at settlement) plus your fee shares at the closing price. No ranking is shown
          before the awards.
        </p>
        {settled ? (
          <p className="mt-2 text-sm text-slate-700" data-testid="earnings-paid">
            Settlement paid your bonuses and call earnings into your cash: {signedMoney(paid.total)} (plan bonus {signedMoney(paid.plan)}, deal bonus{" "}
            {signedMoney(paid.deal)}, calls {signedMoney(paid.calls)}).
          </p>
        ) : null}
      </Panel>

      <Panel title="Breakdown">
        <ul className="divide-y divide-slate-100" aria-label="Earnings breakdown">
          {e.lines.map((l) => (
            <li key={l.key} className="py-3" data-testid={`earnings-${l.key}`} data-status={l.status}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-semibold text-slate-900">{l.label}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].text}</Badge>
                  <span className="font-mono font-semibold tabular-nums" data-testid="amount">
                    {l.amount === null ? "—" : money(l.amount)}
                  </span>
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">{l.note}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          The fee and the deal are agreed under{" "}
          <Link href="/team/rescue" className="underline">
            Rescue
          </Link>
          ; your calls are under{" "}
          <Link href="/team/calls" className="underline">
            Calls
          </Link>
          .
        </p>
      </Panel>
    </div>
  );
}
