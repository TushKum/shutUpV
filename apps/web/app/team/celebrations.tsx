"use client";

// Pop-ups on Home for the moments worth celebrating: a badge just earned, and a big move (5% or more, either way) of
// the team's own squad company in the last round. Each shows once per team, remembered in this browser; on a team's
// first visit the badges it already has are only remembered, not announced, so nobody gets a flood of pop-ups.
// Storage can be missing (private windows): then nothing is announced, and the page still works.

import { useEffect, useState } from "react";
import { Glyph } from "@/components/ui/matrix";

interface Toast {
  id: string;
  icon: string;
  title: string;
  line: string;
  tone: "good" | "bad";
}

/** Pop-ups on screen now, kept across the page's live re-reads (which rebuild this component) until they expire. */
const live = new Map<string, { toast: Toast; until: number }>();
const SHOW_MS = 8000;

function read(key: string): string[] | null {
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as string[]) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* no storage: nothing to remember */
  }
}

export function Celebrations({
  teamId,
  badges,
  move,
}: {
  teamId: string;
  badges: { key: string; icon: string; name: string }[];
  move: { round: number; ticker: string; changeBp: number } | null;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const badgeKeys = badges.map((b) => b.key).join(",");

  useEffect(() => {
    const out: Toast[] = [];
    const remember: (() => void)[] = []; // written when the pop-ups show, so a cancelled run announces nothing
    const bKey = `msim:badges-seen:${teamId}`;
    const seen = read(bKey);
    if (seen === null) {
      write(bKey, badges.map((b) => b.key)); // first visit: remember, do not announce
    } else {
      const fresh = badges.filter((b) => !seen.includes(b.key));
      for (const b of fresh) out.push({ id: `b-${b.key}`, icon: b.icon, title: "Badge earned!", line: b.name, tone: "good" });
      if (fresh.length) remember.push(() => write(bKey, [...seen, ...fresh.map((b) => b.key)]));
    }
    if (move) {
      const mKey = `msim:moves-seen:${teamId}`;
      const moves = read(mKey) ?? [];
      const id = `${move.round}`;
      if (!moves.includes(id)) {
        const up = move.changeBp > 0;
        out.push({
          id: `m-${id}`,
          icon: up ? "🚀" : "📉",
          title: up ? "Your company is flying!" : "Your company took a hit",
          line: `${move.ticker} ${up ? "+" : "−"}${(Math.abs(move.changeBp) / 100).toFixed(2)}% in round ${move.round}`,
          tone: up ? "good" : "bad",
        });
        remember.push(() => write(mKey, [...moves, id]));
      }
    }
    const now = Date.now();
    for (const [id, l] of live) if (l.until <= now) live.delete(id);
    const still = [...live.values()].map((l) => l.toast).filter((t) => !out.some((o) => o.id === t.id));
    if (out.length === 0 && still.length === 0) return;
    const show = window.setTimeout(() => {
      for (const r of remember) r();
      for (const t of out) live.set(t.id, { toast: t, until: Date.now() + SHOW_MS });
      setToasts([...still, ...out]);
    }, 0);
    const until = Math.max(...[...live.values()].map((l) => l.until), now + (out.length ? SHOW_MS : 0));
    const hide = window.setTimeout(() => setToasts([]), Math.max(0, until - now));
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
    // Re-run only when the earned badges or the move change (each page re-read passes new arrays).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, badgeKeys, move?.round, move?.changeBp]);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" role="status" aria-live="polite" data-testid="celebrations">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`mx-panel glow-box pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl p-4 ring-2 ${t.tone === "good" ? "ring-phosphor" : "ring-danger"}`}
          data-testid={`toast-${t.id}`}
        >
          <span className={`text-3xl ${t.tone === "good" ? "text-phosphor glow" : "text-danger-soft"}`} aria-hidden>
            <Glyph e={t.icon} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted">{t.title}</p>
            <p className="text-lg font-extrabold text-phosphor">{t.line}</p>
          </div>
          <button type="button" className="mx-key mx-key-quiet rounded-lg px-2 py-1 text-sm" onClick={() => {
              live.delete(t.id);
              setToasts((ts) => ts.filter((x) => x.id !== t.id));
            }}>
            OK
          </button>
        </div>
      ))}
    </div>
  );
}
