// Team logins. Each team has one account: a printed team code and password.
// Supabase Auth needs an email, so the code maps to a synthetic address that nobody receives mail at.

import type { Track } from "./types";

const TRACK_LETTER: Record<Track, string> = { PRODUCT: "P", CONSULTING: "C", FINANCE: "F" };

/** Live codes: P01–P50, C01–C50, F01–F50. Rehearsal codes carry a prefix, e.g. XP01. */
export const TEAM_CODE_RE = /^[A-Z]{1,3}[0-9]{2,3}$/;

export function teamCode(track: Track, index: number, prefix = ""): string {
  if (!Number.isInteger(index) || index < 1 || index > 999) throw new Error(`bad team index ${index}`);
  if (!/^[A-Z]?$/.test(prefix)) throw new Error(`bad prefix ${prefix}`);
  return `${prefix}${TRACK_LETTER[track]}${String(index).padStart(2, "0")}`;
}

export function trackOfCode(code: string): Track | null {
  const letter = code.replace(/[0-9]/g, "").slice(-1);
  const entry = Object.entries(TRACK_LETTER).find(([, l]) => l === letter);
  return entry ? (entry[0] as Track) : null;
}

/** Accepts what people type on a phone: lower case, spaces, a missing leading zero ("p7" → "P07"). */
export function normalizeTeamCode(input: string): string {
  const raw = input.trim().toUpperCase().replace(/[\s_-]+/g, "");
  const m = /^([A-Z]{1,3})([0-9]{1,3})$/.exec(raw);
  if (!m) return raw;
  return `${m[1]}${m[2]!.padStart(2, "0")}`;
}

export function teamEmail(code: string, domain: string): string {
  const normalized = normalizeTeamCode(code);
  if (!TEAM_CODE_RE.test(normalized)) throw new Error(`not a team code: ${code}`);
  return `${normalized.toLowerCase()}@${domain.toLowerCase()}`;
}

/** Password alphabet without look-alikes (no 0/O, 1/I/L). */
export const PASSWORD_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Canonical form XXXX-XXXX-XXXX; tolerant of case, spaces and missing dashes. */
export function normalizePassword(input: string): string {
  const raw = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (raw.length !== 12) return input.trim();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}
