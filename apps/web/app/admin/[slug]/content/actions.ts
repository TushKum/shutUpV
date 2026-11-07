"use server";

// Content upload: each CSV is read and parsed here with the engine's parsers (a mistake is reported with its row and
// nothing is sent), then stored by one game function as the signed-in organiser, which checks the deck again and
// refuses one that is locked.

import { rpc, type ActionResult } from "@/lib/rpc";
import { checkTwist, parseCrisisDeck, parseProblemDeck, parseTwist, readCsvUpload, type Parsed } from "@/lib/admin/content";

async function parseUpload<T>(form: FormData, parse: (text: string) => Parsed<T>): Promise<Parsed<T> & { code?: string }> {
  const file = await readCsvUpload(form.get("file"));
  if (!file.ok) return { ...file, code: "BAD_FILE" };
  const parsed = parse(file.value);
  return parsed.ok ? parsed : { ...parsed, code: "BAD_CSV" };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function uploadProblemDeck(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const deck = await parseUpload(form, parseProblemDeck);
  if (!deck.ok) return { ok: false, code: deck.code, message: deck.message };
  const r = await rpc("upload_problem_deck", { p_event: eventId, p_cards: deck.value });
  return r.ok ? { ...r, message: `Uploaded ${plural(deck.value.length, "problem card")}; the previous deck was replaced.` } : r;
}

export async function uploadCrisisDeck(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const deck = await parseUpload(form, parseCrisisDeck);
  if (!deck.ok) return { ok: false, code: deck.code, message: deck.message };
  const r = await rpc("upload_crisis_deck", { p_event: eventId, p_cards: deck.value });
  return r.ok ? { ...r, message: `Uploaded ${plural(deck.value.length, "crisis card")}; the previous deck was replaced.` } : r;
}

async function saveTwist(eventId: string, title: string, body: string): Promise<ActionResult> {
  const r = await rpc("set_twist", { p_event: eventId, p_title: title, p_body: body });
  return r.ok ? { ...r, message: `Twist saved: “${title}”. It goes out at the twist time set on Event timing (or publish it by hand under Bulletins).` } : r;
}

/** The twist typed into the form. */
export async function setTwist(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const twist = checkTwist(String(form.get("title") ?? ""), String(form.get("body") ?? ""));
  if (!twist.ok) return { ok: false, code: "BAD_TWIST", message: twist.message };
  return saveTwist(eventId, twist.value.title, twist.value.body);
}

/** The twist from a one-row CSV (title, body). */
export async function uploadTwist(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const twist = await parseUpload(form, parseTwist);
  if (!twist.ok) return { ok: false, code: twist.code, message: twist.message };
  return saveTwist(eventId, twist.value.title, twist.value.body);
}
