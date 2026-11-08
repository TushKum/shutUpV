import type { Metadata } from "next";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent } from "@/lib/admin/event";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Notice, Panel, Stat, Table, Td, type Tone } from "@/components/ui/ui";
import { ActionButton } from "@/components/ui/action";
import { setTeamStatus } from "./actions";

export const metadata: Metadata = { title: "Teams" };

type Status = "ACTIVE" | "BACKUP" | "WITHDRAWN";
const TONE: Record<Status, Tone> = { ACTIVE: "green", BACKUP: "blue", WITHDRAWN: "slate" };
const LABEL: Record<Status, string> = { ACTIVE: "Playing", BACKUP: "Backup", WITHDRAWN: "Withdrawn" };

// Teams: who plays tonight. Until the lottery draw an organiser activates backups (a walk-in team, a replacement) and
// withdraws teams that did not come; at the draw only the playing teams get a company. Each change is logged.
export default async function TeamsPage({ params }: PageProps<"/admin/[slug]/teams">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const organiser = viewer!.role === "ORGANISER";
  const sb = await supabaseServer();
  const [teams, members] = await Promise.all([
    sb.from("teams").select("id, code, name, status").eq("event_id", event.id).order("code"),
    sb.from("members").select("team_id").eq("event_id", event.id),
  ]);
  const rows = (teams.data ?? []) as { id: string; code: string; name: string; status: Status }[];
  const count = new Map<string, number>();
  for (const m of members.data ?? []) count.set(m.team_id, (count.get(m.team_id) ?? 0) + 1);
  const n = (s: Status) => rows.filter((r) => r.status === s).length;
  const open = !event.drawn_at;
  const order: Status[] = ["BACKUP", "ACTIVE", "WITHDRAWN"];
  const sorted = [...rows].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.code.localeCompare(b.code));

  return (
    <div className="space-y-6">
      <Panel title="Who plays tonight">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Playing" value={n("ACTIVE")} hint="get a company at the draw" />
          <Stat label="Backups" value={n("BACKUP")} hint="play only if activated before the draw" />
          <Stat label="Withdrawn" value={n("WITHDRAWN")} hint="do not play" />
        </div>
        <div className="mt-4">
          {open ? (
            <Notice tone="blue">
              Until the problem cards are dealt, <b>activate</b> a backup for a walk-in team or a replacement, and <b>withdraw</b> a team that did not
              come. At the draw only the playing teams get a company, a problem card and a place in the rescue circle; the others are left out of
              the whole night. The problem deck needs at least one card for every three playing teams.
            </Notice>
          ) : (
            <Notice>The problem cards have been dealt: the teams playing tonight are fixed.</Notice>
          )}
        </div>
      </Panel>
      <Panel title={`Teams (${rows.length})`}>
        <Table head={["Code", "Team", "Members", "Status", ""]} empty="No teams.">
          {sorted.map((t) => (
            <tr key={t.id}>
              <Td mono>{t.code}</Td>
              <Td>{t.name}</Td>
              <Td mono>{count.get(t.id) ?? 0}</Td>
              <Td>
                <Badge tone={TONE[t.status]}>{LABEL[t.status]}</Badge>
              </Td>
              <Td>
                {organiser && open ? (
                  <div className="flex flex-wrap gap-2">
                    {t.status !== "ACTIVE" ? (
                      <ActionButton action={setTeamStatus.bind(null, event.id, t.code, "ACTIVE")} confirm={`Click again: ${t.code} plays tonight`} variant="primary">
                        Activate
                      </ActionButton>
                    ) : (
                      <ActionButton action={setTeamStatus.bind(null, event.id, t.code, "WITHDRAWN")} confirm={`Click again: withdraw ${t.code}`}>
                        Withdraw
                      </ActionButton>
                    )}
                    {t.status === "WITHDRAWN" && t.code.match(/^[BY]/) ? (
                      <ActionButton action={setTeamStatus.bind(null, event.id, t.code, "BACKUP")}>Back to backup</ActionButton>
                    ) : null}
                  </div>
                ) : null}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
