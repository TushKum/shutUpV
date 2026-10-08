import { requireRole } from "@/lib/auth/viewer";
import { supabaseServer } from "@/lib/supabase/server";
import { ClockProvider } from "@/lib/live/clock";
import { EventChannel } from "@/lib/live/channel";
import { Heartbeat } from "@/lib/live/heartbeat";

// Every team screen: the server clock, the event's realtime channel (pages refresh on every broadcast) and the
// heartbeat, so the control panel's health view sees the screen and whether its realtime works.
export default async function TeamLayout({ children }: LayoutProps<"/team">) {
  const viewer = await requireRole(["TEAM"], "/team");
  const eventId = viewer.team!.eventId;
  const sb = await supabaseServer();
  const { data: serverTime } = await sb.rpc("server_time");
  return (
    <ClockProvider serverTime={typeof serverTime === "string" ? serverTime : new Date().toISOString()}>
      <EventChannel eventId={eventId}>
        <Heartbeat eventId={eventId} area="team" />
        {children}
      </EventChannel>
    </ClockProvider>
  );
}
