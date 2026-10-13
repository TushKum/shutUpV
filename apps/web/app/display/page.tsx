import Link from "next/link";
import { redirect } from "next/navigation";
import { PHASE_LABELS, type PhaseCode } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { dateTime } from "@/lib/format";

// Which event the projector shows. With a single event it goes straight there; otherwise the operator picks (the
// live night first, then rehearsals).
export default async function DisplayHome() {
  const sb = await supabaseServer();
  const { data: events } = await sb
    .from("events")
    .select("slug, name, is_rehearsal, clock_speed, starts_at, current_phase")
    .order("is_rehearsal")
    .order("starts_at");
  if (events?.length === 1) redirect(`/display/${events[0]!.slug}`);
  return (
    <main className="min-h-dvh bg-black px-10 py-12 text-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between">
        <h1 className="text-5xl font-black tracking-tight">Big screen</h1>
        <SignOutButton />
      </div>
      {!events?.length ? (
        <p className="mx-auto mt-10 max-w-4xl text-2xl text-slate-300">No event has been seeded yet.</p>
      ) : (
        <ul className="mx-auto mt-10 max-w-4xl divide-y divide-white/20">
          {events.map((e) => (
            <li key={e.slug}>
              <Link href={`/display/${e.slug}`} className="flex items-center justify-between gap-6 py-6 hover:bg-white/10">
                <span>
                  <span className="text-3xl font-bold">{e.name}</span>{" "}
                  <span className={`ml-2 rounded px-2 py-0.5 text-lg font-bold ${e.is_rehearsal ? "bg-violet-500" : "bg-emerald-500 text-black"}`}>
                    {e.is_rehearsal ? `Rehearsal ×${e.clock_speed}` : "Live"}
                  </span>
                  <span className="block text-xl text-slate-400">Starts {dateTime(e.starts_at)} IST</span>
                </span>
                <span className="text-2xl text-slate-200">{PHASE_LABELS[e.current_phase as PhaseCode]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
