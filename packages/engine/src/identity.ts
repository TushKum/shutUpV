// Team logins. Each team has one account: a printed team code and password.
// Supabase Auth needs an email, so the code maps to a synthetic address that nobody receives mail at.

/** Live codes: T001–T150. Rehearsal codes use another letter, e.g. X001. */
export const TEAM_CODE_RE = /^[A-Z][0-9]{3}$/;

export function teamCode(index: number, letter = "T"): string {
  if (!Number.isInteger(index) || index < 1 || index > 999) throw new Error(`bad team index ${index}`);
  if (!/^[A-Z]$/.test(letter)) throw new Error(`bad code letter ${letter}`);
  return `${letter}${String(index).padStart(3, "0")}`;
}

/** Accepts what people type on a phone: lower case, spaces, missing leading zeros ("t7" → "T007"). */
export function normalizeTeamCode(input: string): string {
  const raw = input.trim().toUpperCase().replace(/[\s_-]+/g, "");
  const m = /^([A-Z])([0-9]{1,3})$/.exec(raw);
  if (!m) return raw;
  return `${m[1]}${m[2]!.padStart(3, "0")}`;
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
