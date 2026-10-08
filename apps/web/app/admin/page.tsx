import Link from "next/link";
import { PHASE_LABELS, type PhaseCode } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { supabaseServer } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge, Panel } from "@/components/ui/ui";
import { dateTime } from "@/lib/format";

// The events this account can run: the live night and any rehearsal.
export default async function AdminHome() {
  const viewer = (await currentViewer())!;
  const sb = await supabaseServer();
  const { data: events } = await sb
    .from("events")
    .select("slug, name, is_rehearsal, clock_speed, starts_at, current_phase, paused")
    .order("is_rehearsal")
    .order("starts_at");
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Control panel</h1>
        <SignOutButton />
      </div>
      <p className="mt-1 text-slate-600">
        {viewer.displayName} · {viewer.role === "FAIRNESS" ? "Fairness officer" : "Organiser"}
      </p>
      <Panel title="Events" className="mt-6">
        {!events?.length ? (
          <p className="text-sm text-slate-600">No event has been seeded yet (see the README, “Seed an event”).</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {events.map((e) => (
              <li key={e.slug}>
                <Link href={`/admin/${e.slug}`} className="flex items-center justify-between gap-3 py-3 hover:bg-slate-50">
                  <span>
                    <span className="font-semibold">{e.name}</span>{" "}
                    {e.is_rehearsal ? <Badge tone="violet">Rehearsal ×{e.clock_speed}</Badge> : <Badge tone="blue">Live</Badge>}
                    <span className="block text-sm text-slate-500">Starts {dateTime(e.starts_at)} IST</span>
                  </span>
                  <span className="text-right text-sm">
                    {PHASE_LABELS[e.current_phase as PhaseCode]}
                    {e.paused ? (
                      <>
                        {" "}
                        <Badge tone="amber">Paused</Badge>
                      </>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}
