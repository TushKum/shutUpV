import type { Metadata } from "next";
import Link from "next/link";
import Form from "next/form";
import { TRACK_LABELS, type Track } from "@msim/engine";
import { loadAdminEvent } from "@/lib/admin/event";
import { SEARCH_LIMIT, SQUAD_LIMIT, chatHref, likePattern, parseChatQuery, sortChatSquads, type ChatSquad } from "@/lib/admin/chats";
import { supabaseServer } from "@/lib/supabase/server";
import { clock, count } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { SquadChannel } from "@/lib/live/squad-channel";
import { ChatLive } from "@/components/chat-live";
import { ScrollToCurrent } from "@/components/scroll-to-current";
import { Badge, Notice, Panel, buttonClass, inputClass } from "@/components/ui/ui";

export const metadata: Metadata = { title: "Chats" };

interface SquadRow {
  id: string;
  number: number;
  product_team_id: string;
  consulting_team_id: string;
  finance_team_id: string;
}

interface MessageRow {
  id: number;
  squad_id: string;
  team_id: string;
  body: string;
  created_at: string;
}

const TRACK_TONE = { PRODUCT: "violet", CONSULTING: "blue", FINANCE: "green" } as const;

// The squad chats, read-only for the staff (organisers and the fairness officer): every squad with its message
// count and latest activity, one squad's chat (live over its channel), and a search across every chat. Teams are
// told on their chat page that the staff can read it.
export default async function ChatsPage({ params, searchParams }: PageProps<"/admin/[slug]/chats">) {
  const { slug } = await params;
  const q = parseChatQuery(await searchParams);
  const event = await loadAdminEvent(slug);
  const sb = await supabaseServer();
  const [squads, companies, teams, summary] = await Promise.all([
    sb.from("squads").select("id, number, product_team_id, consulting_team_id, finance_team_id").eq("event_id", event.id).order("number"),
    sb.from("companies").select("squad_id, ticker").eq("event_id", event.id),
    sb.from("teams").select("id, code, track").eq("event_id", event.id),
    sb.rpc("chat_summary", { p_event: event.id }),
  ]);
  for (const r of [squads, companies, teams, summary]) if (r.error) throw new Error(`Could not read the chats: ${r.error.message}`);
  const squadRows = (squads.data ?? []) as SquadRow[];
  if (squadRows.length === 0) {
    return (
      <Panel title="Squad chats">
        <Notice>The squad chats open at the squad draw.</Notice>
      </Panel>
    );
  }
  const tickers = new Map((companies.data ?? []).map((c) => [c.squad_id as string, (c.ticker as string | null) ?? null]));
  const stats = new Map(((summary.data ?? []) as { squad_id: string; messages: number; last_at: string }[]).map((s) => [s.squad_id, s]));
  const teamById = new Map((teams.data ?? []).map((t) => [t.id as string, { code: t.code as string, track: t.track as Track }]));
  const list: ChatSquad[] = sortChatSquads(
    squadRows.map((s) => ({ id: s.id, number: s.number, ticker: tickers.get(s.id) ?? null, messages: stats.get(s.id)?.messages ?? 0, lastAt: stats.get(s.id)?.last_at ?? null })),
  );
  const total = list.reduce((n, s) => n + s.messages, 0);
  const selected = q.squad ? (squadRows.find((s) => s.number === q.squad) ?? null) : null;

  let messages: MessageRow[] = [];
  let more = false;
  if (q.q) {
    const { data, error } = await sb
      .from("squad_messages")
      .select("id, squad_id, team_id, body, created_at")
      .eq("event_id", event.id)
      .ilike("body", likePattern(q.q))
      .order("id", { ascending: false })
      .limit(SEARCH_LIMIT + 1);
    if (error) throw new Error(`Could not search the chats: ${error.message}`);
    messages = (data ?? []) as MessageRow[];
    more = messages.length > SEARCH_LIMIT;
    messages = messages.slice(0, SEARCH_LIMIT);
  } else if (selected) {
    const { data, error } = await sb
      .from("squad_messages")
      .select("id, squad_id, team_id, body, created_at")
      .eq("squad_id", selected.id)
      .order("id", { ascending: false })
      .limit(SQUAD_LIMIT + 1);
    if (error) throw new Error(`Could not read the chat: ${error.message}`);
    const rows = (data ?? []) as MessageRow[];
    more = rows.length > SQUAD_LIMIT;
    messages = rows.slice(0, SQUAD_LIMIT).reverse();
  }
  const numberOf = new Map(squadRows.map((s) => [s.id, s.number]));

  const Message = ({ m, showSquad }: { m: MessageRow; showSquad: boolean }) => {
    const t = teamById.get(m.team_id);
    return (
      <li className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
        <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {showSquad ? (
            <Link href={chatHref(slug, { squad: numberOf.get(m.squad_id) })} className="font-semibold text-slate-900 underline-offset-2 hover:underline">
              Squad {String(numberOf.get(m.squad_id) ?? 0).padStart(2, "0")}
            </Link>
          ) : null}
          <span className="font-mono font-semibold text-slate-900">{t?.code ?? "?"}</span>
          {t ? <Badge tone={TRACK_TONE[t.track]}>{TRACK_LABELS[t.track]}</Badge> : null}
          <time dateTime={m.created_at}>{clock(m.created_at, true)}</time>
        </div>
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-slate-900">{m.body}</p>
      </li>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* The list's counts are not broadcast to the staff (one message per chat line would refresh every console):
          re-read every 10 s. The open squad's chat is live over its own channel. */}
      <AutoRefresh everyMs={10_000} />
      <div className="min-w-0 lg:col-span-1">
        <Panel title={`Squads · ${count(total)} messages`}>
          <ol id="chat-squads" className="max-h-60 divide-y divide-slate-100 overflow-y-auto lg:max-h-[70vh]" aria-label="Squads">
            {list.map((s) => {
              const current = selected?.id === s.id && !q.q;
              return (
                <li key={s.id}>
                  <Link
                    href={chatHref(slug, { squad: s.number })}
                    aria-current={current ? "page" : undefined}
                    className={`flex items-center justify-between gap-2 px-2 py-2 text-sm ${current ? "bg-slate-900 text-white" : "hover:bg-slate-50"}`}
                  >
                    <span className="font-semibold">
                      Squad {String(s.number).padStart(2, "0")}
                      {s.ticker ? <span className={`ml-2 font-mono text-xs ${current ? "text-slate-300" : "text-slate-500"}`}>{s.ticker}</span> : null}
                    </span>
                    <span className={`text-xs ${current ? "text-slate-300" : "text-slate-500"}`}>
                      {s.messages ? `${count(s.messages)} · ${clock(s.lastAt)}` : "quiet"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          <ScrollToCurrent listId="chat-squads" current={q.q ? null : (selected?.id ?? null)} />
        </Panel>
      </div>
      <div className="min-w-0 space-y-4 lg:col-span-2">
        <Form action={`/admin/${slug}/chats`} className="flex gap-2" role="search" aria-label="Search the chats">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Search every chat</span>
            <input name="q" defaultValue={q.q} placeholder="Search every chat…" className={inputClass} />
          </label>
          <button type="submit" className={buttonClass.secondary}>
            Search
          </button>
          {q.q ? (
            <Link href={chatHref(slug, { squad: q.squad })} className={buttonClass.secondary}>
              Clear
            </Link>
          ) : null}
        </Form>
        {q.q ? (
          <Panel title={`Messages containing “${q.q}”`}>
            {messages.length === 0 ? (
              <p className="text-sm text-slate-500">No message matches.</p>
            ) : (
              <>
                <ol className="space-y-2" aria-label="Search results">
                  {messages.map((m) => (
                    <Message key={m.id} m={m} showSquad />
                  ))}
                </ol>
                {more ? <p className="mt-2 text-xs text-slate-500">Only the latest {SEARCH_LIMIT} matches are shown.</p> : null}
              </>
            )}
          </Panel>
        ) : selected ? (
          <SquadChannel squadId={selected.id}>
            <ChatLive newest={messages.at(-1)?.id ?? null} />
            <Panel title={`Squad ${String(selected.number).padStart(2, "0")}${tickers.get(selected.id) ? ` · ${tickers.get(selected.id)}` : ""}`}>
              <p className="mb-3 text-xs text-slate-500">
                {(["PRODUCT", "CONSULTING", "FINANCE"] as const)
                  .map((tr) => teamById.get(selected[`${tr.toLowerCase() as "product" | "consulting" | "finance"}_team_id`])?.code ?? "?")
                  .join(" · ")}{" "}
                · read-only, live
              </p>
              <div id="chat-log" className="max-h-[60vh] overflow-y-auto" data-testid="staff-chat-log">
                {more ? <p className="mb-2 text-center text-xs text-slate-500">Older messages are not shown.</p> : null}
                {messages.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">No messages yet.</p>
                ) : (
                  <ol className="space-y-2" aria-label="Messages">
                    {messages.map((m) => (
                      <Message key={m.id} m={m} showSquad={false} />
                    ))}
                  </ol>
                )}
              </div>
            </Panel>
          </SquadChannel>
        ) : (
          <Notice>Choose a squad to read its chat, or search every chat. Teams are told that organisers and the fairness officer can read it.</Notice>
        )}
      </div>
    </div>
  );
}
