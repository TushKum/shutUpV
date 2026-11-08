import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/viewer";
import { supabaseServer } from "@/lib/supabase/server";
import MurmurationWordmark from "@/components/ui/murmuration-wordmark";

export const metadata: Metadata = { title: "Welcome" };

// The opening screen right after a team signs in: thousands of green "birds" over falling code, forming PRIMUS every
// few seconds, with the team's name and the way in. Nothing here changes the game; the team's pages are one click on.
export default async function Welcome() {
  const viewer = await requireRole(["TEAM"], "/welcome");
  const sb = await supabaseServer();
  const { data: event } = await sb.from("events").select("name, is_rehearsal").eq("id", viewer.team!.eventId).maybeSingle();

  return (
    <main className="min-h-svh w-full bg-black">
      <MurmurationWordmark word="PRIMUS" preset="matrix" flyFor={4} holdFor={3.6} height="100svh">
        <div className="flex h-full flex-col justify-between p-5 font-mono text-emerald-300 sm:p-8">
          <header className="flex flex-wrap items-center justify-between gap-2 text-xs tracking-[0.25em] uppercase">
            <span className="text-emerald-400 [text-shadow:0_0_8px_rgba(52,211,153,0.6)]">&gt; PRIMUS{event?.is_rehearsal ? " · rehearsal" : ""}</span>
            <span className="text-emerald-500/80">{event?.name}</span>
          </header>

          <div className="mx-auto mb-[6svh] flex w-full max-w-md flex-col items-center gap-4 rounded-xl bg-black/60 px-6 py-5 text-center ring-1 ring-emerald-500/20 backdrop-blur-[2px]">
            <p className="text-sm text-emerald-400/90">
              Signed in as <span className="font-bold text-emerald-200">{viewer.team!.code}</span>
              <span className="block truncate text-base text-emerald-100">{viewer.team!.name}</span>
            </p>
            <Link
              href="/team"
              data-interactive
              className="rounded-md border border-emerald-400 bg-emerald-400 px-6 py-3 text-sm font-bold tracking-[0.2em] text-black uppercase shadow-[0_0_24px_rgba(52,211,153,0.45)] transition hover:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-200"
            >
              Enter the night →
            </Link>
            <p className="text-[11px] tracking-wider text-emerald-600">Build · Rescue · Invest</p>
          </div>
        </div>
      </MurmurationWordmark>
    </main>
  );
}
