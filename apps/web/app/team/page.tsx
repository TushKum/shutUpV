import type { Metadata } from "next";
import Link from "next/link";
import { phaseReached } from "@msim/engine";
import { loadTeamContext, type CompanyRow } from "@/lib/team/context";
import { loadLatestBulletins, loadPlanFacts } from "@/lib/team/home-data";
import { homePlan, type HomeTask, type TaskState } from "@/lib/team/home";
import { clock, money } from "@/lib/format";
import { RefreshAt } from "@/lib/live/refresh-at";
import { Badge, Notice, Panel, Stat, buttonClass } from "@/components/ui/ui";
import { Countdown } from "@/components/ui/countdown";
import { BulletinItem } from "./bulletins/bulletin";

export const metadata: Metadata = { title: "Home" };

const STATE_BADGES: Record<TaskState, { tone: "amber" | "blue" | "green" | "slate"; label: string } | null> = {
  todo: { tone: "amber", label: "To do" },
  done: { tone: "green", label: "Done" },
  info: null,
};

// Home: what this team should do now and the next moments of the night, the company it built and the one it rescues,
// its cash, and the latest news. Deadlines count down against the server clock; the page re-reads itself when one
// passes and on every broadcast.
export default async function TeamHome() {
  const ctx = await loadTeamContext();
  const { team, built, rescued, status, event } = ctx;
  const [facts, bulletins] = await Promise.all([loadPlanFacts(ctx), loadLatestBulletins(event.id)]);
  const plan = homePlan(facts);
  const nowMs = facts.nowMs;
  const times = [...plan.now.map((t) => t.due), ...plan.next.map((n) => n.at)]
    .filter((t): t is string => !!t && new Date(t).getTime() > nowMs)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const market = phaseReached(status.phase, "REVEAL_1");

  return (
    <div className="space-y-6">
      <RefreshAt at={times[0] ?? null} />

      <Panel title="Now">
        {plan.now.length === 0 ? (
          <p className="text-sm text-slate-700" data-testid="home-idle">
            {plan.idle}
          </p>
        ) : (
          <ul className="space-y-3" aria-label="What to do now">
            {plan.now.map((t) => (
              <TaskItem key={t.key} t={t} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Coming up">
        {plan.next.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing else ahead tonight.</p>
        ) : (
          <ul className="divide-y divide-slate-100" aria-label="Coming up">
            {plan.next.map((n) => (
              <li key={n.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm">
                <span className="min-w-0">
                  {n.href ? (
                    <Link href={n.href} className="font-medium text-slate-900 underline-offset-2 hover:underline">
                      {n.title}
                    </Link>
                  ) : (
                    <span className="font-medium text-slate-900">{n.title}</span>
                  )}
                </span>
                <span className="whitespace-nowrap font-mono tabular-nums text-slate-600">
                  {clock(n.at)} · in <Countdown to={n.at} passed="now" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Your companies" className="lg:col-span-2">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <CompanyFact
              label="You built"
              testId="home-built"
              c={built}
              market={market}
              empty={event.drawn_at ? "Name your company and claim its ticker in your PRD." : "You get your problem card at 21:15 and build a company from it."}
            />
            <CompanyFact
              label="You rescue"
              testId="home-rescued"
              c={rescued}
              market={market}
              empty="The rescue lottery at 23:45 gives you another team's company to rescue."
            />
          </dl>
          <p className="mt-3 text-xs text-slate-500">Your team can never trade the company it built or the one it rescues.</p>
        </Panel>

        <Panel title="Cash">
          <Stat label="Cash" value={<span data-testid="home-cash">{money(team.cash)}</span>} hint={phaseReached(status.phase, "MARKET_BLIND") ? undefined : "Every team starts trading at 02:15 with $100,000."} />
          {phaseReached(status.phase, "MARKET_BLIND") ? (
            <Link href="/team/trade/positions" className={`mt-3 inline-block ${buttonClass.secondary}`}>
              Your portfolio
            </Link>
          ) : null}
        </Panel>
      </div>

      <Panel
        title="Latest news"
        actions={
          <Link href="/team/bulletins" className="text-sm font-medium text-slate-700 underline underline-offset-2">
            All news
          </Link>
        }
      >
        {bulletins.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing yet.</p>
        ) : (
          <ul className="space-y-3" aria-label="Latest news">
            {bulletins.map((b) => (
              <li key={b.id}>
                <BulletinItem b={b} clamp />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {status.paused ? <Notice tone="amber">While the event is paused, countdowns keep running but no deadline passes; each moves later on resume.</Notice> : null}
    </div>
  );
}

function CompanyFact({ label, c, market, empty, testId }: { label: string; c: CompanyRow | null; market: boolean; empty: string; testId: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd data-testid={testId}>
        {c?.ticker ? (
          <>
            <span className="font-semibold">{c.name ?? c.ticker}</span> <span className="font-mono text-slate-600">({c.ticker})</span>
            {market ? (
              <>
                {" "}
                <Link href={`/team/market/${c.ticker}`} className="text-slate-600 underline underline-offset-2">
                  {c.market_price !== null ? money(c.market_price) : "in the market"}
                </Link>
              </>
            ) : null}
          </>
        ) : c ? (
          <span className="text-slate-600">No name or ticker yet.</span>
        ) : (
          <span className="text-slate-600">{empty}</span>
        )}
      </dd>
    </div>
  );
}

function TaskItem({ t }: { t: HomeTask }) {
  const badge = STATE_BADGES[t.state];
  return (
    <li className="rounded-md border border-slate-200 p-3" data-testid={`task-${t.key}`} data-state={t.state}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-900">{t.title}</h3>
            {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-slate-600">{t.detail}</p>
        </div>
        {t.due ? (
          <p className="whitespace-nowrap text-right text-sm">
            <span className="block text-xs text-slate-500">{t.dueLabel} · {clock(t.due)}</span>
            <Countdown to={t.due} passed="closed" className="font-semibold" />
          </p>
        ) : null}
      </div>
      {t.href ? (
        <Link href={t.href} className={`mt-2 inline-block ${t.state === "todo" ? buttonClass.primary : buttonClass.secondary}`}>
          {t.linkLabel}
        </Link>
      ) : null}
    </li>
  );
}
