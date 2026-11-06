// Content upload for the control panel: a CSV file from a form is read, checked and parsed with the engine's deck
// parsers, so a mistake is reported with its row before anything is sent. The game functions check the decks again
// (and refuse a deck that is locked). Pure apart from reading the uploaded file.

import { bulletinFromCsv, crisisCardsFromCsv, parseCsv, problemCardsFromCsv, type CrisisCard, type PreparedBulletin, type ProblemCard } from "@msim/engine";

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** The columns of each file: required ones first; optional ones may be left out. */
export const CSV_FORMATS = {
  problem: { required: ["number", "title", "body"], optional: ["sector"], columns: ["number", "sector", "title", "body"] },
  crisis: { required: ["number", "category", "title", "body"], optional: [], columns: ["number", "category", "title", "body"] },
  twist: { required: ["title", "body"], optional: [], columns: ["title", "body"] },
} as const;
export type CsvKind = keyof typeof CSV_FORMATS;

/** The database's limits on card and bulletin text (upload_problem_deck, upload_crisis_deck, set_twist). */
export const LIMITS = { number: 999, crisisNumber: 99, sector: 100, category: 100, title: 200, bulletinTitle: 140, body: 4000 } as const;

export const MAX_CSV_BYTES = 512 * 1024;

interface UploadedFile {
  name: string;
  size: number;
  type: string;
  text(): Promise<string>;
}

const isFile = (v: unknown): v is UploadedFile =>
  typeof v === "object" && v !== null && typeof (v as UploadedFile).text === "function" && typeof (v as UploadedFile).size === "number";

/** The text of the CSV file chosen in a form's file input. */
export async function readCsvUpload(entry: unknown): Promise<Parsed<string>> {
  if (!isFile(entry) || entry.size === 0) return { ok: false, message: "Choose a CSV file to upload." };
  if (!/\.csv$/i.test(entry.name) && !/csv/i.test(entry.type)) return { ok: false, message: `“${entry.name}” is not a .csv file.` };
  if (entry.size > MAX_CSV_BYTES) {
    return { ok: false, message: `The file is ${Math.ceil(entry.size / 1024)} KB; the limit is ${MAX_CSV_BYTES / 1024} KB.` };
  }
  const text = await entry.text();
  if (text.includes("\u0000")) return { ok: false, message: "The file is not a text CSV (save it as “CSV UTF-8”)." };
  return { ok: true, value: text };
}

const expected = (kind: CsvKind) => `Expected columns: ${CSV_FORMATS[kind].columns.join(", ")}.`;

/** Checks the header row before the engine parses the rows, so a missing or misspelt column is named. */
export function checkHeader(text: string, kind: CsvKind): string | null {
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (err) {
    return `${message(err)}. ${expected(kind)}`;
  }
  const header = rows[0];
  if (!header) return `The file is empty. ${expected(kind)}`;
  const keys = header.map((h) => h.trim().toLowerCase());
  const dup = keys.find((k, i) => k !== "" && keys.indexOf(k) !== i);
  if (dup) return `The column “${dup}” appears twice. ${expected(kind)}`;
  const missing = CSV_FORMATS[kind].required.filter((c) => !keys.includes(c));
  if (missing.length) return `Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. ${expected(kind)}`;
  if (rows.length < 2) return `The file has a header row but no ${kind === "twist" ? "twist" : "cards"}.`;
  return null;
}

const message = (err: unknown) => {
  const m = err instanceof Error ? err.message : String(err);
  return m.charAt(0).toUpperCase() + m.slice(1);
};

const tooLong = (value: string, max: number) => [...value].length > max;

export function parseProblemDeck(text: string): Parsed<ProblemCard[]> {
  const header = checkHeader(text, "problem");
  if (header) return { ok: false, message: header };
  let cards: ProblemCard[];
  try {
    cards = problemCardsFromCsv(text);
  } catch (err) {
    return { ok: false, message: message(err) };
  }
  for (const [i, c] of cards.entries()) {
    const row = `Row ${i + 2} (card ${c.number})`;
    if (c.number > LIMITS.number) return { ok: false, message: `${row}: the card number must be from 1 to ${LIMITS.number}.` };
    if (tooLong(c.sector, LIMITS.sector)) return { ok: false, message: `${row}: the sector is longer than ${LIMITS.sector} characters.` };
    if (tooLong(c.title, LIMITS.title)) return { ok: false, message: `${row}: the title is longer than ${LIMITS.title} characters.` };
    if (tooLong(c.body, LIMITS.body)) return { ok: false, message: `${row}: the body is longer than ${LIMITS.body} characters.` };
  }
  return { ok: true, value: cards };
}

export function parseCrisisDeck(text: string): Parsed<CrisisCard[]> {
  const header = checkHeader(text, "crisis");
  if (header) return { ok: false, message: header };
  let cards: CrisisCard[];
  try {
    cards = crisisCardsFromCsv(text);
  } catch (err) {
    return { ok: false, message: message(err) };
  }
  for (const [i, c] of cards.entries()) {
    const row = `Row ${i + 2} (card ${c.number})`;
    if (c.number > LIMITS.crisisNumber) return { ok: false, message: `${row}: the number must be from 1 to ${LIMITS.crisisNumber}.` };
    if (tooLong(c.category, LIMITS.category)) return { ok: false, message: `${row}: the type is longer than ${LIMITS.category} characters.` };
    if (tooLong(c.title, LIMITS.title)) return { ok: false, message: `${row}: the title is longer than ${LIMITS.title} characters.` };
    if (tooLong(c.body, LIMITS.body)) return { ok: false, message: `${row}: the body is longer than ${LIMITS.body} characters.` };
  }
  return { ok: true, value: cards };
}

export function parseTwist(text: string): Parsed<PreparedBulletin> {
  const header = checkHeader(text, "twist");
  if (header) return { ok: false, message: header };
  let twist: PreparedBulletin;
  try {
    twist = bulletinFromCsv(text, "twist");
  } catch (err) {
    return { ok: false, message: message(err) };
  }
  if (tooLong(twist.body, LIMITS.body)) return { ok: false, message: `The body is longer than ${LIMITS.body} characters.` };
  return { ok: true, value: twist };
}

/** Checks the twist typed into the form (title 1–140 characters, body up to 4,000). */
export function checkTwist(title: string, body: string): Parsed<PreparedBulletin> {
  const t = title.trim();
  const b = body.trim();
  if (!t) return { ok: false, message: "Give the twist a title." };
  if (tooLong(t, LIMITS.bulletinTitle)) return { ok: false, message: `The title is at most ${LIMITS.bulletinTitle} characters.` };
  if (!b) return { ok: false, message: "Write what the twist says." };
  if (tooLong(b, LIMITS.body)) return { ok: false, message: `The body is at most ${LIMITS.body} characters.` };
  return { ok: true, value: { title: t, body: b } };
}

/**
 * Why each piece of content can no longer be replaced (null: it can). Both decks lock at the draw: from then on
 * organisers know the seed, and with it which crisis card each company would get. The twist locks when published.
 */
export function contentLocks(state: { drawnAt: string | null; twistPublishedAt: string | null }) {
  return {
    problem: state.drawnAt ? "Locked: the problem deck is fixed once the lottery has been drawn." : null,
    crisis: state.drawnAt ? "Locked: the crisis deck is fixed once the lottery has been drawn." : null,
    twist: state.twistPublishedAt ? "Locked: the twist has been published." : null,
  };
}

/** The deck size the draw needs: each card goes to at most 3 teams. */
export const minProblemCards = (teams: number) => Math.ceil(teams / 3);
