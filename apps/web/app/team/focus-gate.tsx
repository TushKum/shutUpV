"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PhaseCode, Track } from "@msim/engine";
import { STAGES, inFocus, opensIn } from "@/lib/team/focus";

// Only this round's pages: a page from another round shows a friendly "not now" card instead (an old link, a
// bookmark or a typed address). The game functions still decide every action on the server.
export function FocusGate({ track, phase, taskHref, children }: { track: Track; phase: PhaseCode; taskHref: string | null; children: ReactNode }) {
  const path = usePathname();
  if (inFocus(track, phase, path, taskHref)) return <>{children}</>;
  const later = opensIn(track, phase, path);
  const when = later ? STAGES[later] : null;
  return (
    <div className="mx-auto max-w-md rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200" data-testid="not-now">
      <p className="text-5xl" aria-hidden>
        🔒
      </p>
      <h2 className="mt-2 text-2xl font-extrabold text-slate-900">Not right now</h2>
      <p className="mt-1 text-slate-600">
        {when ? (when.round ? `This opens in Round ${when.round}: ${when.title}.` : `This opens at the ${when.title.toLowerCase()}.`) : "This part is not used any more tonight."}{" "}
        Focus on this round for now!
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href="/team" className="rounded-xl bg-slate-900 px-4 py-2 font-bold text-white hover:bg-slate-700">
          🏠 Back to Home
        </Link>
        {taskHref ? (
          <Link href={taskHref} className="rounded-xl bg-indigo-600 px-4 py-2 font-bold text-white hover:bg-indigo-500">
            🎯 Do this now
          </Link>
        ) : null}
      </div>
    </div>
  );
}
