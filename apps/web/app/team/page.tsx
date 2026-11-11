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
import { DitherLayer } from "@/components/ui/matrix/dither-layer";

export const metadata: Metadata = { title: "Home" };

const STATE: Record<TaskState, { icon: string; label: string; chip: string } | null> = {
  todo: { icon: "📝", label: "To do", chip: "text-warn" },
  waiting: { icon: "⏳", label: "Waiting for partners", chip: "text-phosphor-mid" },
  done: { icon: "✅", label: "Done", chip: "text-phosphor" },
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
  const nowMs = data.facts.nowMs;
  const times = [...plan.now.map((t) => t.due), ...plan.next.map((n) => n.at)]
    .filter((t): t is string => !!t && new Date(t).getTime() > nowMs)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const squadWork = plan.now.some((t) => ["PROBLEM_PICK", "PITCH", "FEE", "DEAL", "PLAN", "FLASH"].includes(t.key) && t.state !== "done");
  const marketOpen = phaseReached(status.phase, "READING");
  // The big card: the first task still to do (they come in the order they close); the rest form the checklist.
  const main = plan.now.find((t) => t.state === "todo") ?? null;
  // Coming up: only this round's deadlines (later rounds stay out of sight until they start).
  const comingUp = plan.next.filter((n) => inThisRound(status.phase, n.key));
  const rest = plan.now.filter((t) => t !== main);

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
            <div className="mx-panel flex items-center gap-4 rounded-2xl p-5">
              <span className="text-4xl text-phosphor" aria-hidden>
                <Glyph e={plan.now.length ? "👍" : "☕"} />
              </span>
              <div>
                <h2 className="text-xl font-extrabold text-phosphor glow">{plan.now.length ? "Nothing to press right now" : "Nothing to do yet"}</h2>
                <p className="mt-0.5 text-base text-paper" data-testid="home-idle">
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

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile icon="💵" label="Cash" tone="ring-phosphor">
          <span data-testid="home-cash">{money(team.cash)}</span>
          {team.track === "FINANCE" ? (
            <span className="mt-1 block font-sans text-xs font-normal text-paper">
              Collateral locked: <span className="font-mono">{money(team.collateral)}</span>
            </span>
          ) : null}
        </Tile>
        <Tile icon="📊" label={holdings.closing ? "Shares (closing prices)" : "Shares worth"} tone="ring-line">
          <span data-testid="home-holdings-value">{money(holdings.total)}</span>
          {holdings.unpriced ? (
            <span className="mt-1 block font-sans text-xs font-normal text-paper">
              {`${count(holdings.unpriced)} ${holdings.unpriced === 1 ? "line" : "lines"} without a price until the IPO`}
            </span>
          ) : null}
        </Tile>
        <Tile icon="👥" label="Your squad" tone="ring-line">
          {squad ? (
            <>
              <span data-testid="home-squad">Squad {String(squad.number).padStart(2, "0")}</span>
              <span className="mt-1 block font-sans text-sm font-normal text-paper" data-testid="home-company">
                {company?.ticker ? (
                  <>
                    <span className="font-semibold">{company.name ?? company.ticker}</span>{" "}
                    <span className="font-mono text-paper">({company.ticker})</span>
                    {marketOpen ? (
                      <>
                        {" "}
                        <Link href={`/team/market/${company.ticker}`} className="text-paper underline underline-offset-2">
                          in the market
                        </Link>
                      </>
                    ) : null}
                  </>
                ) : (
                  <span className="text-paper">Named, with its ticker, on the pitch card (by the pitch deadline).</span>
                )}
              </span>
            </>
          ) : (
            <span className="block font-sans text-sm font-normal text-paper" data-testid="home-squad">
              Not drawn yet.
              {data.facts.phaseStarts.SQUAD_DRAW ? ` Squads are drawn at ${clock(data.facts.phaseStarts.SQUAD_DRAW)}.` : ""}
            </span>
          )}
        </Tile>
      </div>

      <Card icon="⏭️" title="Coming up this round">
        {comingUp.length === 0 ? (
          <p className="text-sm text-muted">Nothing else this round.</p>
        ) : (
          <ul className="divide-y divide-line" aria-label="Coming up">
            {comingUp.map((n) => (
              <li key={n.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm">
                <span className="min-w-0">
                  {n.href ? (
                    <Link href={n.href} className="font-semibold text-phosphor underline-offset-2 hover:underline">
                      {n.title}
                    </Link>
                  ) : (
                    <span className="font-semibold text-phosphor">{n.title}</span>
                  )}
                </span>
                <span className="whitespace-nowrap font-mono tabular-nums text-paper">
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
        action={
          <Link href="/team/bulletins" className="text-sm font-semibold text-paper underline underline-offset-2">
            All bulletins
          </Link>
        }
      >
        {data.bulletins.length === 0 ? (
          <p className="text-sm text-muted">No bulletins yet.</p>
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

      <Card icon="🧾" title="Your shares">
        {holdings.lines.length === 0 ? (
          <p className="text-sm text-muted">{squad ? "No shares." : "Shares are issued at the squad draw."}</p>
        ) : (
          <Table head={["Company", "Lot", "Shares", "Price", "Value"]} label="Your holdings">
            {holdings.lines.map((l) => (
              <tr key={l.key}>
                <Td mono className="font-semibold">
                  {l.ticker ?? <span className="font-sans font-normal text-paper">{l.name}</span>}
                </Td>
                <Td>{l.lotLabel}</Td>
                <Td mono className="text-right">
                  {count(l.qty)}
                </Td>
                <Td mono className="text-right">
                  {money(l.price)}
                </Td>
                <Td mono className={`text-right ${l.value !== null && l.value < 0 ? "text-danger-soft" : ""}`}>
                  {money(l.value)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {holdings.lines.some((l) => l.lot === "SHORT") ? (
          <p className="mt-2 text-xs text-muted">A short is shares owed: its value is what covering it would cost now.</p>
        ) : null}
      </Card>

      {status.paused ? <Notice tone="amber">While the event is paused, countdowns keep running but no deadline passes; each moves later on resume.</Notice> : null}
    </div>
  );
}

function Tile({ icon, label, tone, children }: { icon: string; label: string; tone: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl bg-panel p-4 ring-1 ${tone}`}>
      <p className="flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-wide text-muted">
        <span className="text-base text-phosphor" aria-hidden>
          <Glyph e={icon} />
        </span>
        {label}
      </p>
      <div className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-phosphor glow">{children}</div>
    </div>
  );
}

function Card({ icon, title, action, children }: { icon: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mx-panel rounded-2xl p-4" aria-label={title}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-phosphor glow">
          <span aria-hidden>
            <Glyph e={icon} />
          </span>
          <CipherText text={title} duration={450} />
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Due({ t, big = false }: { t: HomeTask; big?: boolean }) {
  if (!t.due) return null;
  return (
    <p className={`whitespace-nowrap ${big ? "sm:text-right" : "text-right"}`}>
      <span className={`block font-mono text-xs ${big ? "text-paper" : "text-muted"}`}>
        {t.dueLabel} · {clock(t.due)}
      </span>
      <Countdown to={t.due} passed="closed" className={big ? "text-3xl font-extrabold text-phosphor glow" : "font-semibold text-phosphor"} />
    </p>
  );
}

/** The one thing to do now: big, with the time left and a big button. */
function BigTask({ t }: { t: HomeTask }) {
  return (
    <li className="mx-panel glow-box relative mb-3 overflow-hidden rounded-2xl border-phosphor" data-testid={`task-${t.key}`} data-state={t.state}>
      {/* A dithered strip on the top edge marks the one big card; the text sits below it on plain black. */}
      <div aria-hidden className="relative h-3 border-b border-phosphor-dim">
        <DitherLayer from="top" tone="bright" opacity={0.6} />
      </div>
      <div className="p-5">
      {/* On a phone the countdown sits under the text, so the text keeps the full width. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-phosphor-mid">
            <Glyph e="📝" spoken /> Do this now
          </p>
          <h3 className="mt-1 text-2xl font-extrabold leading-tight text-phosphor glow">{t.title}</h3>
          <p className="mt-1 text-base text-paper">{t.detail}</p>
        </div>
        <Due t={t} big />
      </div>
      {t.href ? (
        <Link href={t.href} className="mx-key mx-key-solid mt-4 rounded-xl px-5 py-3 text-base font-extrabold">
          {t.linkLabel}
        </Link>
      ) : null}
      </div>
    </li>
  );
}

/** Everything else for now, as a short checklist. */
function SmallTask({ t }: { t: HomeTask }) {
  const st = STATE[t.state];
  return (
    <li className="mx-panel mb-2 flex flex-wrap items-center gap-3 rounded-xl p-3" data-testid={`task-${t.key}`} data-state={t.state}>
      <span className="text-2xl text-phosphor" aria-hidden>
        <Glyph e={st?.icon ?? "ℹ️"} />
      </span>
      <div className="min-w-[12rem] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold text-phosphor">{t.title}</h3>
          {st ? <span className={`mx-tag text-xs ${st.chip}`}>{st.label}</span> : null}
        </div>
        <p className="text-sm text-paper">{t.detail}</p>
      </div>
      {/* On a phone the countdown and the button go on their own row, under the text. */}
      <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
        <Due t={t} />
        {t.href ? (
          <Link
            href={t.href}
            className={`mx-key rounded-xl px-3 py-2 text-sm ${t.state === "todo" ? "" : "mx-key-quiet"}`}
          >
            {t.linkLabel}
          </Link>
        ) : null}
      </div>
    </li>
  );
}
