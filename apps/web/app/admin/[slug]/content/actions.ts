"use server";

// Content upload: each CSV is read and parsed here with the engine's parsers (a mistake is reported with its row and
// nothing is sent), then stored by one game function as the signed-in organiser, which checks the deck again and
// refuses one that is locked.

import { rpc, type ActionResult } from "@/lib/rpc";
import { parseCrisisDeck, parseFlashBulletin, parseProblemDeck, readCsvUpload, type Parsed } from "@/lib/admin/content";

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
  if (!r.ok) return r;
  const categories = Number(r.data?.categories ?? 0);
  return { ...r, message: `Uploaded ${plural(deck.value.length, "crisis card")} in ${plural(categories, "category", "categories")}; the previous deck was replaced.` };
}

export async function prepareFlashBulletin(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const flash = await parseUpload(form, parseFlashBulletin);
  if (!flash.ok) return { ok: false, code: flash.code, message: flash.message };
  const r = await rpc("prepare_flash_bulletin", { p_event: eventId, p_title: flash.value.title, p_body: flash.value.body });
  return r.ok ? { ...r, message: `Flash bulletin prepared: “${flash.value.title}”. Publish it under Bulletins at 04:00.` } : r;
}
