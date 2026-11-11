import Link from "next/link";
import { PHASE_LABELS, type PhaseCode } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { supabaseServer } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/ui";
import { BentoGrid, BentoItem, BentoTitle } from "@/components/ui/terminal-bento-grid";
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
    <main className="terminal-container terminal-theme-scope px-4 py-8">
      <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="blinking-cursor text-2xl font-bold glow">Control panel</h1>
        <SignOutButton />
      </div>
      <p className="mt-1 text-paper">
        {viewer.displayName} · {viewer.role === "FAIRNESS" ? "Fairness officer" : "Organiser"}
      </p>
      <section aria-label="Events" className="mt-6">
        <BentoTitle className="mb-3">Events</BentoTitle>
        {!events?.length ? (
          <BentoItem>
            <p className="text-sm text-paper">No event has been seeded yet (see the README, “Seed an event”).</p>
          </BentoItem>
        ) : (
          <BentoGrid>
            {events.map((e, i) => (
              <BentoItem key={e.slug} span={i === 0 && !e.is_rehearsal ? 2 : 1} className={e.is_rehearsal ? "" : "bento-item-hot"}>
                <Link href={`/admin/${e.slug}`} className="flex h-full flex-col justify-between gap-3">
                  <span>
                    <span className="block font-mono text-xs text-phosphor-mid" aria-hidden>
                      &gt; ./{e.slug}
                    </span>
                    <span className="font-semibold">{e.name}</span>{" "}
                    {e.is_rehearsal ? <Badge tone="violet">Rehearsal ×{e.clock_speed}</Badge> : <Badge tone="blue">Live</Badge>}
                    <span className="block text-sm text-muted">Starts {dateTime(e.starts_at)} IST</span>
                  </span>
                  <span className="text-sm text-phosphor">
                    {PHASE_LABELS[e.current_phase as PhaseCode]}
                    {e.paused ? (
                      <>
                        {" "}
                        <Badge tone="amber">Paused</Badge>
                      </>
                    ) : null}
                  </span>
                </Link>
              </BentoItem>
            ))}
          </BentoGrid>
        )}
      </section>
      </div>
    </main>
  );
}
