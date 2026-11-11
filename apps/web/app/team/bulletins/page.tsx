import type { Metadata } from "next";
import { loadTeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { Panel } from "@/components/ui/ui";
import { BulletinItem, type PublishedBulletin } from "./bulletin";

export const metadata: Metadata = { title: "Bulletins" };

// Bulletins: every published bulletin of the event, newest first. A new one arrives over the event's realtime
// channel, which refreshes the page.
export default async function TeamBulletinsPage() {
  const { event } = await loadTeamContext();
  const sb = await supabaseServer();
  const rows = await fetchAll<PublishedBulletin>((from, to) =>
    sb
      .from("bulletins")
      .select("id, kind, title, body, published_at")
      .eq("event_id", event.id)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );
  return (
    <Panel title={`Bulletins (${rows.length})`}>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No bulletins yet. They appear here, and in the header, the moment the organisers publish them.</p>
      ) : (
        <ul className="space-y-3" aria-label="Bulletins">
          {rows.map((b) => (
            <li key={b.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
              <BulletinItem b={b} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
