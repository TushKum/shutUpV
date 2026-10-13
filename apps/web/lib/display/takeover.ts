// Which full-screen takeover the big screen shows, worked out from moments the database stores (the draw, the crisis,
// each score release, the flash bulletin, the closing bell, the awards) and the server clock. Nothing is kept in the
// browser: a projector that is reloaded, or reconnects, in the middle of a takeover shows the rest of it, and one
// that comes back after it ended shows the ticker board. Pure, so the timing is unit-tested.

export type TakeoverKind = "DRAW" | "CRISIS" | "VERDICTS" | "FLASH" | "CLOSING_BELL" | "AWARDS";
export type VerdictType = "PITCH" | "PLAN" | "FLASH";

export interface TakeoverMoments {
  /** events.drawn_at: the 21:00 squad draw. */
  drawnAt: string | null;
  /** events.crisis_applied_at: the 00:30 crisis draw (and the seed reveal). */
  crisisAt: string | null;
  /** When each kind of score was released (the earliest released_at of that type: the release itself). */
  verdicts: { type: VerdictType; at: string }[];
  /** published_at of the FLASH bulletin (04:00). */
  flashAt: string | null;
  /** events.market_closed_at: the 05:00 close. */
  closedAt: string | null;
  /** When AWARDS began; set only while the event is in AWARDS (the last phase). */
  awardsAt: string | null;
}

/** How long each takeover stays up, in real seconds (also at a rehearsal's faster clock). AWARDS stays up. */
export const TAKEOVER_SECONDS: Record<Exclude<TakeoverKind, "AWARDS">, number> = {
  DRAW: 180,
  CRISIS: 120,
  VERDICTS: 120,
  FLASH: 90,
  CLOSING_BELL: 90,
};

export interface ActiveTakeover {
  kind: TakeoverKind;
  /** When it began (the stored moment). */
  at: string;
  /** When it ends (null: it stays up, as AWARDS does). */
  until: string | null;
  /** For VERDICTS: which scores were released. */
  type?: VerdictType;
}

function candidates(m: TakeoverMoments): Omit<ActiveTakeover, "until">[] {
  const out: Omit<ActiveTakeover, "until">[] = [];
  if (m.drawnAt) out.push({ kind: "DRAW", at: m.drawnAt });
  if (m.crisisAt) out.push({ kind: "CRISIS", at: m.crisisAt });
  for (const v of m.verdicts) out.push({ kind: "VERDICTS", at: v.at, type: v.type });
  if (m.flashAt) out.push({ kind: "FLASH", at: m.flashAt });
  if (m.closedAt) out.push({ kind: "CLOSING_BELL", at: m.closedAt });
  if (m.awardsAt) out.push({ kind: "AWARDS", at: m.awardsAt });
  return out;
}

/**
 * The takeover on screen at `nowMs` (server time): of the moments that have happened and whose takeover has not run
 * out, the latest one (a newer takeover replaces an older one at once). Null: show the ticker board.
 */
export function activeTakeover(m: TakeoverMoments, nowMs: number): ActiveTakeover | null {
  let best: ActiveTakeover | null = null;
  let bestAt = -Infinity;
  for (const c of candidates(m)) {
    const at = Date.parse(c.at);
    if (Number.isNaN(at) || at > nowMs) continue;
    const until = c.kind === "AWARDS" ? null : at + TAKEOVER_SECONDS[c.kind] * 1000;
    if (until !== null && nowMs >= until) continue;
    // Equal times: the later stage of the night wins (candidates are listed in night order).
    if (at >= bestAt) {
      best = { ...c, until: until === null ? null : new Date(until).toISOString() };
      bestAt = at;
    }
  }
  return best;
}

/** Display names of the takeovers (the strip at the top of each). */
export const TAKEOVER_TITLES: Record<TakeoverKind, string> = {
  DRAW: "Squad draw",
  CRISIS: "Crisis",
  VERDICTS: "Verdicts",
  FLASH: "Flash news",
  CLOSING_BELL: "Closing bell",
  AWARDS: "Awards",
};

export const VERDICT_TITLES: Record<VerdictType, string> = {
  PITCH: "Pitch scores: IPO prices are set",
  PLAN: "Rescue plan verdicts",
  FLASH: "Flash verdicts",
};
