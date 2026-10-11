import type { Metadata } from "next";
import Link from "next/link";
import { phaseReached } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadHomeData } from "@/lib/team/home-data";
import { holdingsView, homePlan, type HomeTask, type TaskState } from "@/lib/team/home";
import { clock, count, money } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import { Badge, Notice, Panel, Stat, Table, Td, buttonClass } from "@/components/ui/ui";
import { Countdown } from "@/components/ui/countdown";
import { BulletinItem } from "./bulletins/bulletin";

export const metadata: Metadata = { title: "Home" };

const STATE_BADGES: Record<TaskState, { tone: "amber" | "blue" | "green" | "slate"; label: string } | null> = {
  todo: { tone: "amber", label: "To do" },
  waiting: { tone: "blue", label: "Waiting for partners" },
  done: { tone: "green", label: "Done" },
  info: null,
};

// Home: what this team should do now (for its track and where the night is), the next deadlines that concern it,
// its squad, its cash and holdings, and the latest bulletins. Deadlines count down against the server clock; the
// page re-reads itself when one passes, and while a squad window is open (a partner's confirmation or submission
// sends no broadcast).
export default async function TeamHome() {
  const ctx = await loadTeamContext();
  const { team, squad, company, status } = ctx;
  const data = await loadHomeData(ctx);
  const plan = homePlan(data.facts);
  const holdings = holdingsView(data.holdings, data.companies);
  const nowMs = data.facts.nowMs;
  const times = [...plan.now.map((t) => t.due), ...plan.next.map((n) => n.at)]
    .filter((t): t is string => !!t && new Date(t).getTime() > nowMs)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const squadWork = plan.now.some((t) => ["PROBLEM_PICK", "PITCH", "FEE", "DEAL", "PLAN", "FLASH"].includes(t.key) && t.state !== "done");
  const marketOpen = phaseReached(status.phase, "READING");

  return (
    <div className="space-y-6">
      <RefreshAt at={times[0] ?? null} />
      <AutoRefresh everyMs={15_000} active={squadWork} />

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
          <p className="text-sm text-slate-500">No further deadlines for your team tonight.</p>
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
        <Panel title="Your squad">
          {squad ? (
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Squad</dt>
                <dd className="text-lg font-semibold" data-testid="home-squad">
                  Squad {String(squad.number).padStart(2, "0")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Company</dt>
                <dd data-testid="home-company">
                  {company?.ticker ? (
                    <>
                      <span className="font-semibold">{company.name ?? company.ticker}</span>{" "}
                      <span className="font-mono text-slate-600">({company.ticker})</span>
                      {marketOpen ? (
                        <>
                          {" "}
                          <Link href={`/team/market/${company.ticker}`} className="text-slate-600 underline underline-offset-2">
                            in the market
                          </Link>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-slate-600">Named, with its ticker, on the pitch card (by the pitch deadline).</span>
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-600" data-testid="home-squad">
              Not drawn yet.
              {data.facts.phaseStarts.SQUAD_DRAW ? ` Squads are drawn at ${clock(data.facts.phaseStarts.SQUAD_DRAW)}.` : ""}
            </p>
          )}
        </Panel>

        <Panel title="Cash and holdings" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Cash" value={<span data-testid="home-cash">{money(team.cash)}</span>} />
            {team.track === "FINANCE" ? <Stat label="Collateral locked" value={money(team.collateral)} hint="Part of your cash, held against shorts" /> : null}
            <Stat
              label={holdings.closing ? "Holdings at closing prices" : "Holdings at market prices"}
              value={<span data-testid="home-holdings-value">{money(holdings.total)}</span>}
              hint={holdings.unpriced ? `${count(holdings.unpriced)} ${holdings.unpriced === 1 ? "line" : "lines"} without a price until the IPO` : undefined}
            />
          </div>
          {holdings.lines.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">{squad ? "No shares." : "Shares are issued at the squad draw."}</p>
          ) : (
            <Table head={["Company", "Lot", "Shares", "Price", "Value"]} label="Your holdings" className="mt-3">
              {holdings.lines.map((l) => (
                <tr key={l.key}>
                  <Td mono className="font-semibold">
                    {l.ticker ?? <span className="font-sans font-normal text-slate-600">{l.name}</span>}
                  </Td>
                  <Td>{l.lotLabel}</Td>
                  <Td mono className="text-right">
                    {count(l.qty)}
                  </Td>
                  <Td mono className="text-right">
                    {money(l.price)}
                  </Td>
                  <Td mono className={`text-right ${l.value !== null && l.value < 0 ? "text-red-700" : ""}`}>
                    {money(l.value)}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          {holdings.lines.some((l) => l.lot === "SHORT") ? (
            <p className="mt-2 text-xs text-slate-500">A short is shares owed: its value is what covering it would cost now.</p>
          ) : null}
        </Panel>
      </div>

      <Panel
        title="Latest bulletins"
        actions={
          <Link href="/team/bulletins" className="text-sm font-medium text-slate-700 underline underline-offset-2">
            All bulletins
          </Link>
        }
      >
        {data.bulletins.length === 0 ? (
          <p className="text-sm text-slate-500">No bulletins yet.</p>
        ) : (
          <ul className="space-y-3" aria-label="Latest bulletins">
            {data.bulletins.map((b) => (
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
