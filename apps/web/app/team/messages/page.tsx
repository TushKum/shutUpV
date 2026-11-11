import type { Metadata } from "next";
import Link from "next/link";
import { clock, money } from "@/lib/format";
import { chatState } from "@/lib/team/chat";
import { loadTeamContext } from "@/lib/team/context";
import { loadCrisisRoom } from "@/lib/team/crisis-data";
import { subroundTitle, termsText } from "@/lib/team/crisis";
import { hireThreads } from "@/lib/team/hire";
import { loadHireMessages, pairKey } from "@/lib/team/hire-data";
import { sectionAllowed } from "@/lib/team/sections";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { Badge, Notice, Panel, buttonClass } from "@/components/ui/ui";
import { ChatForm } from "../chat/chat";
import { companyLabel } from "../crisis/parts";
import { postHireMessage } from "./actions";
import { KeepNewestInView } from "./scroll";

export const metadata: Metadata = { title: "Hire chat" };

// The hire chat: a private one-on-one thread between a company (its Product team) and each Consulting firm it hired,
// open from the moment an offer is accepted until the awards. Only the two teams and the staff read it. The page
// re-reads itself every few seconds while it is open.
export default async function HireChatPage({ searchParams }: { searchParams: Promise<{ c?: string; f?: string }> }) {
  const ctx = await loadTeamContext();
  if (!sectionAllowed(ctx.team.track, "/messages")) return <Notice>This section is not part of your team&apos;s portal.</Notice>;
  const data = await loadCrisisRoom(ctx);
  if (data.format !== "PRIMUS") return <Notice>Tonight&apos;s event plays the classic format: use the squad Chat.</Notice>;
  const threads = hireThreads(data.engagements, data.companies, ctx.team.id);
  const product = ctx.team.track === "PRODUCT";

  if (threads.length === 0) {
    return (
      <Panel title="Hire chat">
        <Notice>
          {product
            ? "Your one-on-one chat with a firm opens as soon as you hire it (the firm accepts your offer, or you accept its counter)."
            : "Your one-on-one chat with a client opens as soon as a company hires you (you accept its offer, or it accepts your counter)."}
        </Notice>
        {product ? (
          <Link href="/team/firms" className={`${buttonClass.primary} mt-3 inline-block`}>
            Browse the firms →
          </Link>
        ) : (
          <Link href="/team/crisis" className={`${buttonClass.primary} mt-3 inline-block`}>
            See your offers in the Crisis room →
          </Link>
        )}
      </Panel>
    );
  }

  const { c, f } = await searchParams;
  const active = threads.find((t) => t.company_id === c && t.firm_team_id === f) ?? threads[0];
  const messages = await loadHireMessages(ctx.event.id);
  const firm = new Map(data.firms.map((x) => [x.team_id, x]));
  const company = new Map(data.companies.map((x) => [x.id, x]));
  const label = (t: (typeof threads)[number]) => {
    if (product) {
      const x = firm.get(t.firm_team_id);
      return { title: x?.code ?? "Firm", sub: x?.name ?? "" };
    }
    const co = company.get(t.company_id);
    return { title: co?.ticker ?? "Client", sub: co?.name ?? "Product team" };
  };
  const log = messages.get(pairKey(active.company_id, active.firm_team_id)) ?? [];
  const head = label(active);
  const open = chatState(ctx.status.phase, true) === "OPEN";
  const deals = data.engagements.filter((e) => e.company_id === active.company_id && e.firm_team_id === active.firm_team_id).sort((a, b) => b.k - a.k);

  return (
    <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
      <AutoRefresh everyMs={5_000} active={open} />
      <KeepNewestInView newest={log.at(-1)?.id ?? null} />
      <nav className="border border-line bg-panel" aria-label="Conversations">
        <h2 className="border-b border-line bg-raised px-3 py-1.5 text-sm font-bold uppercase tracking-wider text-[var(--term-amber)]">
          {product ? "Your firms" : "Your clients"}
        </h2>
        <ul>
          {threads.map((t) => {
            const l = label(t);
            const last = messages.get(pairKey(t.company_id, t.firm_team_id))?.at(-1);
            const current = t === active;
            return (
              <li key={pairKey(t.company_id, t.firm_team_id)} className="border-b border-line last:border-b-0">
                <Link
                  href={`/team/messages?c=${t.company_id}&f=${t.firm_team_id}`}
                  aria-current={current ? "page" : undefined}
                  className={`block px-3 py-2 ${current ? "bg-[var(--term-amber)] text-black" : "hover:bg-raised"}`}
                  data-testid={`thread-${l.title}`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className={`font-mono font-semibold ${current ? "" : "text-[var(--term-amber)]"}`}>{l.title}</span>
                    <span className={`truncate text-xs ${current ? "" : "text-muted"}`}>{l.sub}</span>
                  </span>
                  <span className={`block truncate text-xs ${current ? "" : "text-paper"}`}>
                    {last ? `${last.team_id === ctx.team.id ? "You: " : ""}${last.body}` : "No messages yet"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Panel title={`${head.title}${head.sub ? ` · ${head.sub}` : ""}`}>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          {deals.map((e) => (
            <Badge key={e.id} tone="green">
              {subroundTitle(e.k)}: {termsText(money(e.cash_cents), e.shares)}
            </Badge>
          ))}
          {product ? (
            <Link href={`/team/firms/${encodeURIComponent(head.title)}`} className="ml-auto text-[var(--term-amber)] hover:underline">
              Firm profile →
            </Link>
          ) : (
            <span className="ml-auto text-muted">{companyLabel(company.get(active.company_id))}</span>
          )}
        </div>
        <p className="text-sm text-paper">
          A private chat between {product ? "your company and this firm" : "your firm and this client"}. Organisers and the fairness officer can read it too, so keep it fair.
        </p>
        <div id="chat-log" className="mt-3 max-h-[55vh] min-h-[12rem] overflow-y-auto border border-line bg-raised p-3" data-testid="chat-log">
          {log.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No messages yet. {product ? "Tell your firm what you need." : "Say hello to your client."}</p>
          ) : (
            <ol className="space-y-2" aria-label="Messages">
              {log.map((m) => {
                const mine = m.team_id === ctx.team.id;
                return (
                  <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <article className={`max-w-[85%] px-3 py-2 text-sm ${mine ? "bg-phosphor-deep text-phosphor" : "bg-panel text-phosphor"}`}>
                      <header className="mb-0.5 flex items-center gap-2 text-xs">
                        <span className="font-semibold text-[var(--term-amber)]">{mine ? "You" : head.title}</span>
                        <time dateTime={m.created_at} className="text-muted">
                          {clock(m.created_at)}
                        </time>
                      </header>
                      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</p>
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <div className="mt-3">
          {open ? (
            <ChatForm
              key={pairKey(active.company_id, active.firm_team_id)}
              action={postHireMessage.bind(null, active.company_id, active.firm_team_id)}
              placeholder={`Write to ${head.title}…`}
            />
          ) : (
            <Notice>The hire chat closed at the awards. The messages stay readable.</Notice>
          )}
        </div>
      </Panel>
    </div>
  );
}
