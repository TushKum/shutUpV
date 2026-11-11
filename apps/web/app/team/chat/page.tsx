import type { Metadata } from "next";
import { loadTeamContext } from "@/lib/team/context";
import { loadChat } from "@/lib/team/chat-data";
import { author, chatState } from "@/lib/team/chat";
import { clock } from "@/lib/format";
import { Notice, Panel } from "@/components/ui/ui";
import { postSquadMessage } from "./actions";
import { ChatLive } from "@/components/chat-live";
import { ChatForm } from "./chat";

export const metadata: Metadata = { title: "Chat" };

const TRACK_TONE = {
  PRODUCT: "bg-phosphor-deep/40 text-phosphor-mid",
  CONSULTING: "bg-phosphor-deep/40 text-phosphor-mid",
  FINANCE: "bg-phosphor/10 text-phosphor",
} as const;

// The squad chat: the three teams of a squad (product, consulting, finance) agree the fee and the rescue deal here
// instead of across the hall. Only the squad and the staff read it. New messages arrive over the squad's own
// realtime channel, which re-reads the page.
export default async function ChatPage() {
  const { team, status, squad } = await loadTeamContext();
  const state = chatState(status.phase, squad !== null);
  if (!squad) {
    return (
      <Panel title="Squad chat">
        <Notice>The squad chat opens at the squad draw, for the three teams of your squad.</Notice>
      </Panel>
    );
  }
  const { messages, more } = await loadChat(squad.id);
  return (
    <Panel title={`Squad ${String(squad.number).padStart(2, "0")} chat`}>
      <ChatLive newest={messages.at(-1)?.id ?? null} />
      <p className="text-sm text-paper">
        A private chat for your squad&apos;s three teams: product, consulting and finance. Agree the fee and the deal here. Organisers and the
        fairness officer can read it too, so keep it fair.
      </p>
      <div id="chat-log" className="mt-4 max-h-[60vh] overflow-y-auto rounded-md border border-line bg-raised p-3" data-testid="chat-log">
        {more ? <p className="mb-2 text-center text-xs text-muted">Older messages are not shown.</p> : null}
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No messages yet. Say hello to your squad.</p>
        ) : (
          <ol className="space-y-2" aria-label="Messages">
            {messages.map((m) => {
              const a = author(m.team_id, squad, team.id);
              return (
                <li key={m.id} className={`flex ${a.mine ? "justify-end" : "justify-start"}`}>
                  <article className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${a.mine ? "bg-phosphor-deep text-phosphor" : "bg-panel text-phosphor"}`}>
                    <header className="mb-0.5 flex items-center gap-2 text-xs">
                      <span className={`rounded px-1.5 py-0.5 font-semibold ${a.mine ? "bg-phosphor/10 text-phosphor" : a.track ? TRACK_TONE[a.track] : "bg-raised"}`}>{a.label}</span>
                      <time dateTime={m.created_at} className={a.mine ? "text-muted" : "text-muted"}>
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
        {state === "OPEN" ? <ChatForm action={postSquadMessage} /> : <Notice>The squad chat closed at the awards. The messages stay readable.</Notice>}
      </div>
    </Panel>
  );
}
