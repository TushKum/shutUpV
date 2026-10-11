import type { Metadata } from "next";
import Link from "next/link";
import { phaseReached, type SubmissionType } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadCompanyView } from "@/lib/team/market-data";
import { BOOK_PUBLIC_FROM, historyLines, SUBMISSION_TITLES, verdict } from "@/lib/team/market";
import { clock, money } from "@/lib/format";
import { Badge, Notice, Panel, Stat, Table, Td } from "@/components/ui/ui";
import type { PublicSubmission } from "@/lib/team/market-data";
import { Submission } from "../submission";
import { CrisisCard } from "../crisis-card";

export const metadata: Metadata = { title: "Market" };

const TONE = { 1: "text-emerald-700", 0: "text-slate-600", [-1]: "text-red-700" } as const;
const TIER_TONE = { 1: "green", 0: "slate", [-1]: "red" } as const;

// One company: its prices, and everything public about it so far: the pitch (from Reading), the verdicts (released
// scores), the crisis card (from the crisis), the rescue plan (from Plans published), the flash answer (once the
// flash scores are released) and every price change, round by round.
export default async function CompanyPage({ params }: PageProps<"/team/market/[ticker]">) {
  const { ticker } = await params;
  const { event, status, company: own } = await loadTeamContext();
  const back = (
    <Link href="/team/market" className="text-sm font-medium text-slate-700 underline underline-offset-2">
      ← All companies
    </Link>
  );
  if (!phaseReached(status.phase, "READING")) {
    return (
      <div className="space-y-4">
        {back}
        <Notice>The market opens at Reading, when the pitch book goes public.</Notice>
      </div>
    );
  }
  const code = decodeURIComponent(ticker).toUpperCase();
  const view = /^[A-Z]{3,4}$/.test(code) ? await loadCompanyView(event.id, code, status.phase) : null;
  if (!view) {
    return (
      <div className="space-y-4">
        {back}
        <Notice tone="amber">No listed company has the ticker {code.slice(0, 8)}.</Notice>
      </div>
    );
  }
  const { company: c, history, submissions, scores, crisis, types } = view;
  const lines = historyLines(history);
  const waiting = (["PITCH", "PLAN", "FLASH"] as SubmissionType[]).filter((t) => !types.includes(t));

  return (
    <div className="space-y-6">
      {back}
      <Panel
        title={
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono">{c.ticker}</span>
            <span>{c.name}</span>
            {own?.id === c.id ? <Badge tone="violet">Your squad</Badge> : null}
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Market price" value={money(c.market_price)} />
          <Stat label="IPO price" value={money(c.ipo_price)} />
          <Stat label="AI price" value={money(c.ai_price)} hint="IPO × 0.85 × plan and flash tiers" />
          {c.closing_price !== null ? (
            <Stat label="Closing price" value={money(c.closing_price)} hint="(market + AI) ÷ 2" />
          ) : (
            <Stat label="Post-crisis price" value={money(c.post_crisis_price)} />
          )}
        </div>
      </Panel>

      {scores.length ? (
        <Panel title="Verdicts">
          <ul className="space-y-3" aria-label="Verdicts">
            {scores.map((s) => {
              const v = verdict(s);
              return (
                <li key={s.type} className="text-sm" data-testid={`verdict-${s.type}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{v.title}</span>
                    <span className="font-mono text-base font-semibold">{v.score}</span>
                    <Badge tone={TIER_TONE[v.tierSign]}>{v.tier}</Badge>
                  </div>
                  {v.notes.map((n) => (
                    <p key={n} className="mt-1 text-slate-600">
                      {n}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}

      {types.includes("PITCH") ? <SubmissionPanel type="PITCH" s={submissions.PITCH} /> : null}
      {crisis ? (
        <Panel title="Crisis card">
          <CrisisCard card={crisis} />
        </Panel>
      ) : null}

      {types.includes("PLAN") ? <SubmissionPanel type="PLAN" s={submissions.PLAN} /> : null}
      {types.includes("FLASH") ? <SubmissionPanel type="FLASH" s={submissions.FLASH} /> : null}
      {waiting.length || !phaseReached(status.phase, "CRISIS") ? (
        <p className="text-sm text-slate-500">
          {[...(phaseReached(status.phase, "CRISIS") ? [] : [BOOK_PUBLIC_FROM.CRISIS]), ...waiting.map((t) => BOOK_PUBLIC_FROM[t])].join(" ")}
        </p>
      ) : null}

      <Panel title="Price history">
        <Table head={["Step", "Time", "Price", "Change", "AI price", "Detail"]} label="Price history" empty="No price yet: prices start at the IPO.">
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
                {money(l.ai)}
              </Td>
              <Td className="text-slate-600">{l.detail}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}

function SubmissionPanel({ type, s }: { type: SubmissionType; s: PublicSubmission | undefined }) {
  return (
    <Panel title={SUBMISSION_TITLES[type]}>
      {s ? <Submission type={type} s={s} /> : <p className="text-sm text-slate-500">Nothing was submitted on time.</p>}
    </Panel>
  );
}
