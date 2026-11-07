import type { Metadata } from "next";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { supabaseServer } from "@/lib/supabase/server";
import { RefreshAt } from "@/lib/live/refresh-at";
import type { PhaseTiming, RoundTiming, TimingLogEntry } from "@/lib/admin/timing";
import { TimingPanel } from "./panel";

export const metadata: Metadata = { title: "Event timing" };

// Event timing: the night's clock, run by the organisers. Everything here is read from the database, which projects
// every time from when each phase actually started; the panel only edits durations and sends them back.
export default async function TimingPage({ params }: PageProps<"/admin/[slug]/timing">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const status = await loadEventStatus(event.id);
  const sb = await supabaseServer();
  const [phases, rounds, offsets, log] = await Promise.all([
    sb
      .from("phases")
      .select("code, seq, duration_seconds, starts_at, ends_at, started_at, ended_at, paused_seconds, extended_seconds")
      .eq("event_id", event.id)
      .order("seq"),
    sb
      .from("rounds")
      .select("id, number, phase, status, duration_seconds, opens_at, closes_at, opened_at, closed_at, paused_seconds, extended_seconds")
      .eq("event_id", event.id)
      .order("number"),
    sb.from("events").select("twist_offset_seconds, freeze_offset_seconds").eq("id", event.id).single(),
    sb
      .from("audit_log")
      .select("at, action, actor_role, after")
      .eq("event_id", event.id)
      .like("action", "timing:%")
      .order("id", { ascending: false })
      .limit(40),
  ]);
  const open = (rounds.data ?? []).find((r) => r.status === "OPEN");
  const pending = open
    ? ((await sb.from("orders").select("id", { count: "exact", head: true }).eq("round_id", open.id).eq("status", "PENDING")).count ?? 0)
    : 0;

  return (
    <>
      {/* When the phase's time is up (or the open round's), the controls change: re-read then. */}
      <RefreshAt at={status.phase_ends_at} />
      <RefreshAt at={status.open_round?.closes_at} />
      <TimingPanel
        eventId={event.id}
        organiser={viewer!.role === "ORGANISER"}
        rehearsal={event.is_rehearsal}
        status={status}
        phases={(phases.data ?? []) as PhaseTiming[]}
        rounds={(rounds.data ?? []) as (RoundTiming & { id: string })[]}
        offsets={offsets.data ?? { twist_offset_seconds: 3600, freeze_offset_seconds: 2700 }}
        log={(log.data ?? []) as TimingLogEntry[]}
        pendingOrders={pending}
      />
    </>
  );
}
