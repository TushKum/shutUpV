import type { Metadata } from "next";
import { DEADLINE_LABELS, PHASE_LABELS, type DeadlineCode, type PhaseCode } from "@msim/engine";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { supabaseServer } from "@/lib/supabase/server";
import { clock } from "@/lib/format";
import { Badge, Panel, Table, Td } from "@/components/ui/ui";
import { Countdown } from "@/components/ui/countdown";

export const metadata: Metadata = { title: "Schedule" };

interface PhaseRow {
  code: PhaseCode;
  seq: number;
  starts_at: string;
  ends_at: string;
  started_at: string | null;
  ended_at: string | null;
}

// The night's timetable: every phase (as planned, or as it actually ran), every deadline with its countdown, and
// every trading round.
export default async function SchedulePage({ params }: PageProps<"/admin/[slug]/schedule">) {
  const { slug } = await params;
  const event = await loadAdminEvent(slug);
  const status = await loadEventStatus(event.id);
  const sb = await supabaseServer();
  const [phases, deadlines, rounds] = await Promise.all([
    sb.from("phases").select("code, seq, starts_at, ends_at, started_at, ended_at").eq("event_id", event.id).order("seq"),
    sb.from("deadlines").select("code, at").eq("event_id", event.id).order("at"),
    sb.from("rounds").select("number, phase, status, opens_at, closes_at").eq("event_id", event.id).order("number"),
  ]);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Panel title="Phases">
        <ol className="space-y-1 text-sm">
          {((phases.data ?? []) as PhaseRow[]).map((p) => {
            const current = p.code === status.phase;
            return (
              <li key={p.code} className={`flex justify-between gap-2 rounded px-2 py-1 ${current ? "bg-phosphor-deep text-phosphor" : p.ended_at ? "text-muted" : ""}`}>
                <span>{PHASE_LABELS[p.code]}</span>
                <span className="font-mono tabular-nums">
                  {clock(p.started_at ?? p.starts_at)}–{clock(p.ended_at ?? p.ends_at)}
                </span>
              </li>
            );
          })}
        </ol>
      </Panel>
      <Panel title="Deadlines">
        <ul className="space-y-1 text-sm">
          {((deadlines.data ?? []) as { code: DeadlineCode; at: string }[]).map((d) => (
            <li key={d.code} className="flex justify-between gap-2">
              <span>{DEADLINE_LABELS[d.code]}</span>
              <span className="font-mono tabular-nums text-paper">
                {clock(d.at)} · <Countdown to={d.at} passed="closed" />
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Trading rounds">
        <Table head={["Round", "Phase", "Opens", "Closes", "Status"]} empty="No rounds." label="Trading rounds">
          {((rounds.data ?? []) as { number: number; phase: PhaseCode; status: string; opens_at: string; closes_at: string }[]).map((r) => (
            <tr key={r.number} className={r.status === "OPEN" ? "bg-phosphor/10" : ""}>
              <Td mono>{r.number}</Td>
              <Td>{PHASE_LABELS[r.phase]}</Td>
              <Td mono>{clock(r.opens_at)}</Td>
              <Td mono>{clock(r.closes_at)}</Td>
              <Td>
                <Badge tone={r.status === "OPEN" ? "green" : r.status === "CLEARED" ? "slate" : "blue"}>{r.status}</Badge>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
