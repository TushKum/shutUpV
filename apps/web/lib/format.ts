// How money, prices, times and changes are shown. Money arrives from the database as integer cents (bigint columns
// come back as strings); nothing here does arithmetic on money beyond converting it for display.

import { formatCents } from "@msim/engine";

const IST = "Asia/Kolkata";

/** "$1,234.56" or "−$1,234.56". Accepts the string form of bigint columns. */
export function money(cents: number | string | bigint | null | undefined): string {
  if (cents === null || cents === undefined || cents === "") return "—";
  const n = typeof cents === "number" ? cents : Number(cents);
  if (!Number.isSafeInteger(n)) return `${String(cents)}¢`;
  return formatCents(n);
}

/** Whole numbers with thousands separators ("12,500"). */
export function count(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  return Number(n).toLocaleString("en-US");
}

/** Basis points as a signed percentage: 2000 → "+20%", -1000 → "−10%", 250 → "+2.5%", 0 → "0%". */
export function bp(basisPoints: number | null | undefined): string {
  if (basisPoints === null || basisPoints === undefined) return "—";
  if (basisPoints === 0) return "0%";
  const sign = basisPoints > 0 ? "+" : "−";
  const pct = Math.abs(basisPoints) / 100;
  return `${sign}${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, "")}%`;
}

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const timeSecFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const toDate = (t: string | Date) => (t instanceof Date ? t : new Date(t));

/** "21:05" (or "21:05:09") in Asia/Kolkata. */
export function clock(t: string | Date | null | undefined, seconds = false): string {
  if (!t) return "—";
  return (seconds ? timeSecFmt : timeFmt).format(toDate(t));
}

/** "8 Oct, 21:05" in Asia/Kolkata. */
export function dateTime(t: string | Date | null | undefined): string {
  if (!t) return "—";
  return dateTimeFmt.format(toDate(t));
}

/** A countdown: "4:05", "1:02:03"; never negative. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** "in 4 min", "2 min ago", "now" (whole minutes; under a minute is "now"). */
export function relative(t: string | Date, now: number): string {
  const diff = toDate(t).getTime() - now;
  const min = Math.round(Math.abs(diff) / 60_000);
  if (min === 0) return "now";
  const span = min >= 120 ? `${Math.round(min / 60)} h` : `${min} min`;
  return diff > 0 ? `in ${span}` : `${span} ago`;
}
