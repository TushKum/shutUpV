"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PhaseCode, Track } from "@msim/engine";
import { STAGES, inFocus, opensIn } from "@/lib/team/focus";
import { Glyph } from "@/components/ui/matrix/glyph";

// Only this round's pages: a page from another round shows a friendly "not now" card instead (an old link, a
// bookmark or a typed address). The game functions still decide every action on the server.
export function FocusGate({ track, phase, taskHref, children }: { track: Track; phase: PhaseCode; taskHref: string | null; children: ReactNode }) {
  const path = usePathname();
  if (inFocus(track, phase, path, taskHref)) return <>{children}</>;
  const later = opensIn(track, phase, path);
  const when = later ? STAGES[later] : null;
  return (
    <div className="mx-panel glow-box mx-auto max-w-md rounded-2xl p-6 text-center" data-testid="not-now">
      <p className="text-6xl text-phosphor" aria-hidden>
        <Glyph e="🔒" />
      </p>
      <p aria-hidden className="mx-tag mt-2 text-xs text-warn">
        Access locked
      </p>
      <h2 className="mt-1 text-2xl font-extrabold text-phosphor glow">Not right now</h2>
      <p className="mt-1 text-base text-paper">
        {when ? (when.round ? `This opens in Round ${when.round}: ${when.title}.` : `This opens at the ${when.title.toLowerCase()}.`) : "This part is not used any more tonight."}{" "}
        Focus on this round for now!
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href="/team" className="mx-key mx-key-quiet rounded-xl px-4 py-2">
          <Glyph e="🏠" spoken /> Back to Home
        </Link>
        {taskHref ? (
          <Link href={taskHref} className="mx-key mx-key-solid rounded-xl px-4 py-2">
            <Glyph e="🎯" spoken /> Do this now
          </Link>
        ) : null}
      </div>
    </div>
  );
}
