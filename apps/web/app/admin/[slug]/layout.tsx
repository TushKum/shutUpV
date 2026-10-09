import type { Metadata } from "next";
import Link from "next/link";
import { PHASE_LABELS } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { ClockProvider } from "@/lib/live/clock";
import { EventChannel } from "@/lib/live/channel";
import { Heartbeat } from "@/lib/live/heartbeat";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/ui";
import { ServerClock } from "@/components/ui/countdown";
import { RealtimeDot } from "@/components/ui/realtime-dot";
import { AdminNav } from "./nav";

export const metadata: Metadata = { title: { template: "%s · Control panel", default: "Control panel" } };

// Every admin page of one event: header with the phase, trading state and server clock; the section tabs; the
// event's realtime channel (pages refresh on every broadcast) and the heartbeat (an organiser's console also runs
// the game clock as a backup).
export default async function EventAdminLayout({ children, params }: LayoutProps<"/admin/[slug]">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const status = await loadEventStatus(event.id);
  const organiser = viewer!.role === "ORGANISER";
  return (
    <ClockProvider serverTime={status.server_time}>
      <EventChannel eventId={event.id} staff>
        <Heartbeat eventId={event.id} area="admin" tick={organiser} />
        <div className="min-h-screen bg-slate-50">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-900">
                  Events
                </Link>
                <span className="text-slate-300">/</span>
                <h1 className="text-base font-semibold">{event.name}</h1>
                {event.is_rehearsal ? <Badge tone="violet">Rehearsal ×{event.clock_speed}</Badge> : <Badge tone="blue">Live</Badge>}
                <Badge tone="slate">{PHASE_LABELS[status.phase]}</Badge>
                <Badge tone={status.trading === "OPEN" ? "green" : status.trading === "PAUSED" ? "amber" : "slate"}>{status.trading}</Badge>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <RealtimeDot />
                <ServerClock className="text-base font-semibold" />
                <span className="text-slate-500">IST</span>
                <span className="hidden text-slate-600 sm:inline">
                  {viewer!.displayName} · {organiser ? "Organiser" : "Fairness officer"}
                </span>
                <SignOutButton />
              </div>
            </div>
            <AdminNav slug={slug} fairness={viewer!.role === "FAIRNESS"} />
          </header>
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        </div>
      </EventChannel>
    </ClockProvider>
  );
}
