// Which full-screen takeover the big screen shows, worked out from moments the database stores (the twist, the
// starting prices, the crisis, the score reveal, the closing bell, the awards) and the server clock. Nothing is kept
// in the browser: a projector that is reloaded, or reconnects, in the middle of a takeover shows the rest of it, and
// one that comes back after it ended shows the main screen. Pure, so the timing is unit-tested.

export type TakeoverKind = "TWIST" | "PRICES" | "CRISIS" | "REVEAL" | "CLOSING_BELL" | "AWARDS";

export interface TakeoverMoments {
  /** published_at of the TWIST bulletin (22:15). */
  twistAt: string | null;
  /** events.prices_started_at: the 23:30 PRD reveal and starting prices. */
  pricesAt: string | null;
  /** events.crisis_applied_at: the 23:45 crisis, rescue lottery and seed reveal. */
  crisisAt: string | null;
  /** events.scores_revealed_at: the 02:45 crisis-solution reveal. */
  revealAt: string | null;
  /** events.market_closed_at: the 04:30 close. */
  closedAt: string | null;
  /** When AWARDS began; set only while the event is in AWARDS (the last phase). */
  awardsAt: string | null;
}

/**
 * How long each takeover stays up, in seconds at the night's real speed. A rehearsal's faster clock shortens them in
 * proportion (never below TAKEOVER_MIN_SECONDS), so they do not hide the board for most of its short rounds. AWARDS
 * stays up.
 */
export const TAKEOVER_SECONDS: Record<Exclude<TakeoverKind, "AWARDS">, number> = {
  TWIST: 180,
  PRICES: 180,
  CRISIS: 180,
  REVEAL: 150,
  CLOSING_BELL: 120,
};
export const TAKEOVER_MIN_SECONDS = 30;

/** How long a takeover stays up at the event's clock speed, in ms (null: it stays up). */
export function takeoverMs(kind: TakeoverKind, clockSpeed = 1): number | null {
  if (kind === "AWARDS") return null;
  const speed = Number.isFinite(clockSpeed) && clockSpeed > 1 ? clockSpeed : 1;
  return Math.max(TAKEOVER_MIN_SECONDS, TAKEOVER_SECONDS[kind] / speed) * 1000;
}

export interface ActiveTakeover {
  kind: TakeoverKind;
  /** When it began (the stored moment). */
  at: string;
  /** When it ends (null: it stays up, as AWARDS does). */
  until: string | null;
}

function candidates(m: TakeoverMoments): Omit<ActiveTakeover, "until">[] {
  const out: Omit<ActiveTakeover, "until">[] = [];
  if (m.twistAt) out.push({ kind: "TWIST", at: m.twistAt });
  if (m.pricesAt) out.push({ kind: "PRICES", at: m.pricesAt });
  if (m.crisisAt) out.push({ kind: "CRISIS", at: m.crisisAt });
  if (m.revealAt) out.push({ kind: "REVEAL", at: m.revealAt });
  if (m.closedAt) out.push({ kind: "CLOSING_BELL", at: m.closedAt });
  if (m.awardsAt) out.push({ kind: "AWARDS", at: m.awardsAt });
  return out;
}

/**
 * The takeover on screen at `nowMs` (server time): the latest moment that has happened, while its takeover lasts.
 * A newer takeover replaces an older one at once, and once the newest has run out the main screen comes back: an
 * older takeover that would still have time left never returns. Null: show the main screen.
 */
export function activeTakeover(m: TakeoverMoments, nowMs: number, clockSpeed = 1): ActiveTakeover | null {
  let latest: Omit<ActiveTakeover, "until"> | null = null;
  let latestAt = -Infinity;
  for (const c of candidates(m)) {
    const at = Date.parse(c.at);
    if (Number.isNaN(at) || at > nowMs) continue;
    // Equal times: the later stage of the night wins (candidates are listed in night order).
    if (at >= latestAt) {
      latest = c;
      latestAt = at;
    }
  }
  if (!latest) return null;
  const ms = takeoverMs(latest.kind, clockSpeed);
  if (ms !== null && nowMs >= latestAt + ms) return null;
  return { ...latest, until: ms === null ? null : new Date(latestAt + ms).toISOString() };
}

/** Display names of the takeovers (the strip at the top of each). */
export const TAKEOVER_TITLES: Record<TakeoverKind, string> = {
  TWIST: "The twist",
  PRICES: "PRD scores: starting prices",
  CRISIS: "Crisis",
  REVEAL: "Crisis-solution scores",
  CLOSING_BELL: "Closing bell",
  AWARDS: "Awards",
};
