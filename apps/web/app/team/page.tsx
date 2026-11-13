import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { phaseReached } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadHomeData } from "@/lib/team/home-data";
import { holdingsView, homePlan, type HomeTask, type TaskState } from "@/lib/team/home";
import { clock, count, money } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import { Notice, Table, Td } from "@/components/ui/ui";
import { Countdown } from "@/components/ui/countdown";
import { BulletinItem } from "./bulletins/bulletin";
import { inThisRound } from "@/lib/team/focus";
import { Glyph } from "@/components/ui/matrix/glyph";
import { CipherText } from "@/components/ui/matrix/cipher-text";
import { scoreNow } from "@/lib/team/badges";
import { loadBadges } from "@/lib/team/badges-data";
import { BadgesCard } from "./badges-card";
import { loadPulse } from "@/lib/team/pulse-data";
import { PulseCard } from "./pulse-card";
import { Celebrations } from "./celebrations";
import { BIG_MOVE_BP } from "@/lib/team/pulse";
import { BentoGrid, BentoItem, BentoTitle } from "@/components/ui/terminal-bento-grid";
import { loadCrisisReport } from "@/lib/team/report-data";
import { CrisisReportCard } from "./crisis-report";

export const metadata: Metadata = { title: "Home" };

const STATE: Record<TaskState, { icon: string; label: string; chip: string } | null> = {
  todo: { icon: "📝", label: "To do", chip: "border-amber-400/40 bg-amber-400/12 text-amber-300" },
  waiting: { icon: "⏳", label: "Waiting for partners", chip: "border-sky-400/35 bg-sky-400/10 text-sky-300" },
  done: { icon: "✅", label: "Done", chip: "border-[#46f097]/40 bg-[#46f097]/12 text-[#46f097]" },
  info: null,
};

// Home, kept simple: one big card with the thing to do now (or "all done"), a short checklist of the rest, three
// tiles (cash, shares, squad), what comes next, and the latest news. Deadlines count down against the server clock;
// the page re-reads itself when one passes, and while a squad window is open (a partner's confirmation or
// submission sends no broadcast).
export default async function TeamHome() {
  const ctx = await loadTeamContext();
  const { team, squad, company, status } = ctx;
  const data = await loadHomeData(ctx);
  const plan = homePlan(data.facts);
  const holdings = holdingsView(data.holdings, data.companies);
  // The team's own score now, and its badges (both only about this team: the rankings stay hidden until the awards).
  const score = scoreNow(team.track, team.cash, holdings.total, company?.ipo_price ?? null);
  const badges = await loadBadges(score.value);
  const nowMs = data.facts.nowMs;
  const times = [...plan.now.map((t) => t.due), ...plan.next.map((n) => n.at)]
    .filter((t): t is string => !!t && new Date(t).getTime() > nowMs)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const squadWork = plan.now.some((t) => ["PROBLEM_PICK", "PITCH", "FEE", "DEAL", "PLAN", "FLASH", "HIRE", "OFFERS", "DRAFT"].includes(t.key) && t.state !== "done");
  const marketOpen = phaseReached(status.phase, "READING");
  // The last trading round's headline (public prices only), once the market is open.
  const pulse = marketOpen ? await loadPulse(ctx.event.id) : null;
  // The big card: the first task still to do (they come in the order they close); the rest form the checklist.
  const main = plan.now.find((t) => t.state === "todo") ?? null;
  // Coming up: only this round's deadlines (later rounds stay out of sight until they start).
  const comingUp = plan.next.filter((n) => inThisRound(status.phase, n.key));
  const rest = plan.now.filter((t) => t !== main);
  // A PRIMUS event from Round 2: the team's own line per crisis (its scores, price moves, firm and stars).
  const primusOn = ctx.event.format === "PRIMUS" && phaseReached(status.phase, "PRESSURE") && team.track !== "FINANCE";
  const report = primusOn
    ? await loadCrisisReport(ctx, data.facts.primus?.k ?? (phaseReached(status.phase, "CLOSE") ? 5 : null), data.facts.primus?.draft?.statement?.title ?? null)
    : null;

  return (
    <div className="space-y-5">
      <RefreshAt at={times[0] ?? null} />
      <AutoRefresh everyMs={15_000} active={squadWork} />

      <section className="space-y-3">
        {main ? (
          <ul aria-label="What to do now">
            <BigTask t={main} />
            {rest.map((t) => (
              <SmallTask key={t.key} t={t} />
            ))}
          </ul>
        ) : (
          <>
            <div className="mx-panel flex items-center gap-4 p-5 sm:p-6">
              <span className="mx-accent-text grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/15 bg-white/[0.06] text-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]" aria-hidden>
                <Glyph e={plan.now.length ? "👍" : "☕"} />
              </span>
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white">{plan.now.length ? "Nothing to press right now" : "Nothing to do yet"}</h2>
                <p className="mt-0.5 text-sm text-slate-300 sm:text-base" data-testid="home-idle">
                  {plan.idle}
                </p>
              </div>
            </div>
            {plan.now.length ? (
              <ul aria-label="What to do now">
                {plan.now.map((t) => (
                  <SmallTask key={t.key} t={t} />
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      {/* The dashboard: the score across the top, then cash, shares and squad as three glass tiles. */}
      <BentoGrid>
      <ScoreNow track={team.track} score={score} />

        <Tile icon="💵" label="Cash" hot>
          <span data-testid="home-cash">{money(team.cash)}</span>
          {team.track === "FINANCE" ? (
            <span className="mt-1 block font-sans text-xs font-normal text-slate-300">
              Collateral locked: <span className="font-mono text-white">{money(team.collateral)}</span>
            </span>
          ) : null}
        </Tile>
        <Tile icon="📊" label={holdings.closing ? "Shares (closing prices)" : "Shares worth"}>
          <span data-testid="home-holdings-value">{money(holdings.total)}</span>
          {holdings.unpriced ? (
            <span className="mt-1 block font-sans text-xs font-normal text-slate-300">
              {`${count(holdings.unpriced)} ${holdings.unpriced === 1 ? "line" : "lines"} without a price until the IPO`}
            </span>
          ) : null}
        </Tile>
        <Tile icon="👥" label="Your squad">
          {squad ? (
            <>
              <span className="text-white" data-testid="home-squad">Squad {String(squad.number).padStart(2, "0")}</span>
              <span className="mt-1 block font-sans text-sm font-normal text-slate-300" data-testid="home-company">
                {company?.ticker ? (
                  <>
                    <span className="font-semibold text-slate-100">{company.name ?? company.ticker}</span>{" "}
                    <span className="font-mono text-sky-300">({company.ticker})</span>
                    {marketOpen ? (
                      <>
                        {" "}
                        <Link href={`/team/market/${company.ticker}`} className="mx-accent-text underline underline-offset-2">
                          in the market
                        </Link>
                      </>
                    ) : null}
                  </>
                ) : (
                  <span className="text-slate-300">Named, with its ticker, on the PRD (by the pitch deadline).</span>
                )}
              </span>
            </>
          ) : (
            <span className="block font-sans text-sm font-normal text-slate-300" data-testid="home-squad">
              Not drawn yet.
              {data.facts.phaseStarts.SQUAD_DRAW ? ` Squads are drawn at ${clock(data.facts.phaseStarts.SQUAD_DRAW)}.` : ""}
            </span>
          )}
        </Tile>
      </BentoGrid>

      {report ? (
        <BentoGrid>
          <CrisisReportCard report={report} />
        </BentoGrid>
      ) : null}

      {pulse ? <PulseCard pulse={pulse} mine={company?.ticker ?? null} /> : null}
      <Celebrations
        teamId={team.id}
        badges={(badges ?? []).filter((b) => b.earned).map((b) => ({ key: b.key, icon: b.icon, name: b.name }))}
        move={(() => {
          const own = pulse && company?.ticker ? pulse.moves.find((m) => m.ticker === company.ticker) : null;
          return own && Math.abs(own.changeBp) >= BIG_MOVE_BP ? { round: pulse!.round, ticker: own.ticker, changeBp: own.changeBp } : null;
        })()}
      />

      {badges ? <BadgesCard badges={badges} /> : null}

      <BentoGrid>
      <Card icon="⏭️" title="Coming up this round">
        {comingUp.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing else this round.</p>
        ) : (
          <ul className="divide-y divide-white/10" aria-label="Coming up">
            {comingUp.map((n) => (
              <li key={n.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5 text-sm">
                <span className="min-w-0">
                  {n.href ? (
                    <Link href={n.href} className="mx-accent-text font-semibold underline-offset-2 hover:underline">
                      {n.title}
                    </Link>
                  ) : (
                    <span className="font-semibold text-white">{n.title}</span>
                  )}
                </span>
                <span className="whitespace-nowrap font-mono tabular-nums text-slate-300">
                  {clock(n.at)} · in <Countdown to={n.at} passed="now" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        icon="📣"
        title="Latest news"
        span={2}
        action={
          <Link href="/team/bulletins" className="text-sm font-medium text-sky-300 underline-offset-2 hover:text-white hover:underline">
            All bulletins
          </Link>
        }
      >
        {data.bulletins.length === 0 ? (
          <p className="text-sm text-slate-400">No bulletins yet.</p>
        ) : (
          <ul className="space-y-3" aria-label="Latest bulletins">
            {data.bulletins.map((b) => (
              <li key={b.id}>
                <BulletinItem b={b} clamp />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card icon="🧾" title="Your shares" span={3}>
        {holdings.lines.length === 0 ? (
          <p className="text-sm text-slate-400">{squad ? "No shares." : "Shares are issued at the squad draw."}</p>
        ) : (
          <Table head={["Company", "Lot", "Shares", "Price", "Value"]} label="Your holdings">
            {holdings.lines.map((l) => (
              <tr key={l.key}>
                <Td mono className="font-semibold text-white">
                  {l.ticker ?? <span className="font-sans font-normal text-slate-200">{l.name}</span>}
                </Td>
                <Td>{l.lotLabel}</Td>
                <Td mono className="text-right">
                  {count(l.qty)}
                </Td>
                <Td mono className="text-right">
                  {money(l.price)}
                </Td>
                <Td mono className={`text-right ${l.value !== null && l.value < 0 ? "text-rose-400" : "text-[#46f097]"}`}>
                  {money(l.value)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {holdings.lines.some((l) => l.lot === "SHORT") ? (
          <p className="mt-2.5 text-xs text-slate-400">A short is shares owed: its value is what covering it would cost now.</p>
        ) : null}
      </Card>
      </BentoGrid>

      {status.paused ? <Notice tone="amber">While the event is paused, countdowns keep running but no deadline passes; each moves later on resume.</Notice> : null}
    </div>
  );
}

/** The team's own value now and how it has moved since its start (a consultancy shows what it has earned). */
function ScoreNow({ track, score }: { track: string; score: ReturnType<typeof scoreNow> }) {
  if (score.value === null) return null;
  const up = score.changeBp !== null && score.changeBp >= 0;
  return (
    <BentoItem as="section" span={3} className="bento-item-hot flex flex-wrap items-center justify-between gap-3" aria-label="Your score now" data-testid="score-now">
      <div>
        <p className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-slate-400">
          <span className="mx-accent-text text-base" aria-hidden>
            <Glyph e="📈" />
          </span>
          {track === "CONSULTING" ? "Earned so far" : "Your score now"}
        </p>
        <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-[#46f097]" data-testid="score-now-value">
          {money(score.value)}
        </p>
      </div>
      {score.changeBp !== null ? (
        <p
          className={`rounded-2xl border px-3.5 py-2 font-mono text-lg font-bold tabular-nums ${
            up
              ? "border-[#46f097]/40 bg-[#46f097]/10 text-[#46f097]"
              : "border-rose-400/40 bg-rose-500/10 text-rose-400"
          }`}
          data-testid="score-now-change"
        >
          {up ? "▲ +" : "▼ "}
          {(score.changeBp / 100).toFixed(2)}% <span className="text-xs font-normal text-slate-400">since the start</span>
        </p>
      ) : (
        <p className="text-sm text-slate-400">Only your own score: who is winning stays a secret until the awards!</p>
      )}
    </BentoItem>
  );
}

function Tile({ icon, label, hot = false, children }: { icon: string; label: string; hot?: boolean; children: ReactNode }) {
  return (
    <BentoItem className={hot ? "bento-item-hot" : ""}>
      <p className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-slate-400">
        <span className="mx-accent-text text-base" aria-hidden>
          <Glyph e={icon} />
        </span>
        {label}
      </p>
      <div className="mx-accent-text mt-1.5 font-mono text-2xl font-bold tabular-nums">{children}</div>
    </BentoItem>
  );
}

/** A titled frosted window in the bento grid. */
function Card({ icon, title, action, span = 1, children }: { icon: string; title: string; action?: ReactNode; span?: 1 | 2 | 3; children: ReactNode }) {
  return (
    <BentoItem as="section" span={span} aria-label={title}>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2.5">
        <BentoTitle>
          <span aria-hidden>
            <Glyph e={icon} />
          </span>
          <CipherText text={title} duration={450} />
        </BentoTitle>
        {action}
      </div>
      {children}
    </BentoItem>
  );
}

function Due({ t, big = false }: { t: HomeTask; big?: boolean }) {
  if (!t.due) return null;
  return (
    <p className={`whitespace-nowrap ${big ? "sm:text-right" : "text-right"}`}>
      <span className={`block font-mono text-xs ${big ? "text-slate-300" : "text-slate-400"}`}>
        {t.dueLabel} · {clock(t.due)}
      </span>
      <Countdown to={t.due} passed="closed" className={big ? "mx-accent-text text-3xl font-bold" : "mx-accent-text font-semibold"} />
    </p>
  );
}

/** The one thing to do now: featured Liquid Glass action card with its countdown and primary button. */
function BigTask({ t }: { t: HomeTask }) {
  return (
    <li className="mx-team-big-task relative mb-3 p-5 sm:p-6" data-testid={`task-${t.key}`} data-state={t.state}>
      {/* On a phone the countdown sits under the text, so the text keeps the full width. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="mx-accent-text font-mono text-xs font-semibold uppercase tracking-[0.14em]">
            <Glyph e="📝" spoken /> Do this now
          </p>
          <h3 className="mt-1.5 text-2xl font-bold leading-tight text-white">{t.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-300 sm:text-base">{t.detail}</p>
        </div>
        <Due t={t} big />
      </div>
      {t.href ? (
        <Link href={t.href} className="mx-key mx-key-solid mt-4 inline-flex items-center px-5 py-2.5 text-sm sm:text-base">
          {t.linkLabel}
        </Link>
      ) : null}
    </li>
  );
}

/** Everything else for now, as a short checklist. */
function SmallTask({ t }: { t: HomeTask }) {
  const st = STATE[t.state];
  return (
    <li className="mx-team-small-task mb-2.5 flex flex-wrap items-center gap-3 p-3.5 sm:px-4" data-testid={`task-${t.key}`} data-state={t.state}>
      <span className="mx-accent-text grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/12 bg-white/[0.05] text-lg" aria-hidden>
        <Glyph e={st?.icon ?? "ℹ️"} />
      </span>
      <div className="min-w-[12rem] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-white">{t.title}</h3>
          {st ? <span className={`mx-tag ${st.chip}`}>{t.stateLabel ?? st.label}</span> : null}
        </div>
        <p className="mt-0.5 text-sm text-slate-300">{t.detail}</p>
      </div>
      {/* On a phone the countdown and the button go on their own row, under the text. */}
      <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
        <Due t={t} />
        {t.href ? (
          <Link
            href={t.href}
            className={`mx-key px-3.5 py-2 text-xs sm:text-sm ${t.state === "todo" ? "" : "mx-key-quiet"}`}
          >
            {t.linkLabel}
          </Link>
        ) : null}
      </div>
    </li>
  );
}
