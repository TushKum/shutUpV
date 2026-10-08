// Content files: a minimal CSV reader and the deck formats (shared by the seed script and the control panel's
// content upload). The database checks the decks again when they are stored.


export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (quoted) throw new Error("CSV ends inside a quoted field");
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/** Rows as objects keyed by the (trimmed, lower-cased) header row. */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export interface ProblemCard {
  number: number;
  sector: string;
  title: string;
  body: string;
}

export interface CrisisCard {
  category: string;
  number: number;
  title: string;
  body: string;
}

/** Columns: number, sector, title, body. */
export function problemCardsFromCsv(text: string): ProblemCard[] {
  const cards = parseCsvObjects(text).map((r, i) => {
    const number = Number(r.number);
    if (!Number.isInteger(number) || number < 1) throw new Error(`problem CSV row ${i + 2}: bad number`);
    if (!r.title || !r.body) throw new Error(`problem CSV row ${i + 2}: title and body are required`);
    return { number, sector: r.sector ?? "", title: r.title, body: r.body };
  });
  const numbers = new Set(cards.map((c) => c.number));
  if (numbers.size !== cards.length) throw new Error("problem CSV: card numbers must be unique");
  return cards;
}

/** Columns: category, number, title, body. */
export function crisisCardsFromCsv(text: string): CrisisCard[] {
  return parseCsvObjects(text).map((r, i) => {
    if (!r.category || !r.title || !r.body) throw new Error(`crisis CSV row ${i + 2}: category, title and body are required`);
    return { category: r.category, number: Number(r.number || 1), title: r.title, body: r.body };
  });
}

export interface FlashBulletin {
  title: string;
  body: string;
}

/** Columns: title, body; exactly one row. */
export function flashBulletinFromCsv(text: string): FlashBulletin {
  const rows = parseCsvObjects(text);
  if (rows.length !== 1) throw new Error(`flash bulletin CSV: exactly one row after the header (found ${rows.length})`);
  const { title, body } = rows[0]!;
  if (!title || !body) throw new Error("flash bulletin CSV: title and body are required");
  if (title.length > 140) throw new Error("flash bulletin CSV: the title is at most 140 characters");
  return { title, body };
}
