"use client";

// The crisis reveal: when a crisis card is dealt, the team's screen shows its company's card full-screen for a moment,
// like turning a card over, with one button to the crisis room. It shows only in the first two minutes after the
// reveal (so a screen opened later is not interrupted) and once per crisis per team on this browser.

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useServerNow } from "@/lib/live/clock";
import { Glyph } from "@/components/ui/matrix/glyph";
import FocusFrameBorder from "@/components/ui/shine-border-06";
import { CrisisCallouts, crisisParts } from "./crisis-focus-card";

export interface SplashCard {
  eventId: string;
  /** Remembered per team: several teams may share a laptop. */
  teamId: string;
  k: number;
  category: string;
  title: string;
  body: string;
  revealedAt: string;
}

const SHOW_FOR_MS = 120_000;
const key = (c: SplashCard) => `msim:crisis-splash:${c.eventId}:${c.teamId}:${c.k}`;

// "Seen" lives in localStorage (an outside store): read on the client; the server renders it as seen (nothing).
const subscribe = (on: () => void) => {
  window.addEventListener("storage", on);
  return () => window.removeEventListener("storage", on);
};
function readSeen(k: string | null): boolean {
  if (!k) return true;
  try {
    return window.localStorage.getItem(k) === "1";
  } catch {
    return false;
  }
}

export function CrisisSplash({ card, own }: { card: SplashCard | null; own: boolean }) {
  const now = useServerNow(1000);
  const k = card ? key(card) : null;
  const stored = useSyncExternalStore(subscribe, () => readSeen(k), () => true);
  const [closed, setClosed] = useState<string | null>(null);
  if (!card || stored || closed === k) return null;
  const age = now - Date.parse(card.revealedAt);
  if (age < 0 || age > SHOW_FOR_MS) return null;
  const close = () => {
    try {
      window.localStorage.setItem(key(card), "1");
    } catch {
      /* private window: it simply closes */
    }
    setClosed(key(card));
  };
  const parts = crisisParts(card.body);
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-black/85 p-4 motion-safe:animate-[fadein_.25s_ease-out]" role="dialog" aria-modal="true" aria-label={`Crisis ${card.k}`} data-testid="crisis-splash">
      {/* A long card (one with a twist) scrolls on a small phone instead of being cut off. */}
      <div className="flex min-h-full items-center justify-center">
        {/* The card in the pulsing focus frame (components/ui/shine-border-06), in danger red. */}
        <FocusFrameBorder
          color="var(--color-danger)"
          duration={2.4}
          className="w-full max-w-xl motion-safe:animate-[cardflip_.6s_ease-out]"
          contentClassName="border-2 border-danger bg-ink shadow-[0_0_60px_rgba(255,59,59,.35)]"
        >
          <div className="p-6 text-center">
            <p className="font-mono text-sm font-bold uppercase tracking-[0.3em] text-danger-soft">
              {card.k === 5 ? "Round 3" : `Crisis ${card.k} of 4`}
            </p>
            <p className="mt-3 text-6xl text-danger" aria-hidden>
              <Glyph e="🚨" />
            </p>
            <p className="mt-3 text-xs font-bold uppercase tracking-widest text-danger-soft">{card.category}</p>
            <h2 className="mt-1 text-3xl font-extrabold leading-tight text-[var(--term-amber)]">{card.title}</h2>
            <p className={`mt-3 whitespace-pre-wrap text-base text-paper ${parts.situation.length > 220 ? "text-left" : ""}`}>{parts.situation}</p>
            {parts.twist || parts.decide ? (
              <div className="mt-4 flex flex-col gap-3">
                <CrisisCallouts twist={parts.twist} decide={parts.decide} />
              </div>
            ) : null}
            <p className="mt-4 rounded-lg border border-danger/60 px-3 py-2 text-sm font-semibold text-danger-soft">
              {own ? "This is your company's card." : "This is your squad's company's card."} Every share price just fell 5%.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Link href="/team/crisis" onClick={close} className="mx-key mx-key-solid rounded-xl px-5 py-3 text-base font-extrabold">
                Open the crisis room →
              </Link>
              <button type="button" onClick={close} className="mx-key mx-key-quiet rounded-xl px-5 py-3 text-base">
                Got it
              </button>
            </div>
          </div>
        </FocusFrameBorder>
      </div>
    </div>
  );
}
