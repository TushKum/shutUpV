// Bulletins in the control panel: the composer's kinds and checks (the flash bulletin has its own path: prepared
// under Content, published at 04:00), the list order and the state of the flash bulletin. Pure.

import type { PhaseCode } from "@msim/engine";
import type { Parsed } from "./content";

export type BulletinKind = "GENERAL" | "CRISIS" | "FLASH" | "FAIRNESS" | "SYSTEM";

export const BULLETIN_KIND_LABELS: Record<BulletinKind, string> = {
  GENERAL: "General",
  CRISIS: "Crisis",
  FLASH: "Flash",
  FAIRNESS: "Fairness",
  SYSTEM: "System",
};

/** What the general composer can publish. FLASH is not one of them. */
export const COMPOSER_KINDS = ["GENERAL", "CRISIS", "FAIRNESS", "SYSTEM"] as const satisfies readonly BulletinKind[];
export type ComposerKind = (typeof COMPOSER_KINDS)[number];

export const TITLE_MAX = 140;
export const BODY_MAX = 4000;

/** The same refusal as publish_bulletin's, before anything is sent. */
export const USE_FLASH = "Prepare the flash bulletin under Content and publish it at 04:00.";

export function bulletinFromForm(input: { kind: unknown; title: unknown; body: unknown }): Parsed<{ kind: ComposerKind; title: string; body: string }> {
  const kind = typeof input.kind === "string" ? input.kind : "";
  if (kind === "FLASH") return { ok: false, message: USE_FLASH };
  if (!(COMPOSER_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, message: `Choose a kind: ${COMPOSER_KINDS.map((k) => BULLETIN_KIND_LABELS[k]).join(", ")}.` };
  }
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.replace(/\r\n/g, "\n").trim() : "";
  if (!title) return { ok: false, message: "A bulletin needs a title." };
  if ([...title].length > TITLE_MAX) return { ok: false, message: `The title is at most ${TITLE_MAX} characters.` };
  if ([...body].length > BODY_MAX) return { ok: false, message: `The body is at most ${BODY_MAX.toLocaleString("en-US")} characters.` };
  return { ok: true, value: { kind: kind as ComposerKind, title, body } };
}

export interface BulletinRow {
  id: string;
  kind: BulletinKind;
  title: string;
  body: string;
  published_at: string | null;
  created_at: string;
}

/** Newest first: a published bulletin by its publication time, a draft by when it was prepared. */
export function sortBulletins<T extends BulletinRow>(rows: readonly T[]): T[] {
  const at = (b: BulletinRow) => new Date(b.published_at ?? b.created_at).getTime();
  return [...rows].sort((a, b) => at(b) - at(a) || (a.id < b.id ? 1 : -1));
}

export interface FlashState {
  /** The flash bulletin (prepared or published), if any. */
  bulletin: BulletinRow | null;
  published: boolean;
  /** Why the organiser cannot publish it now (null: the button is live). */
  blocked: string | null;
}

/** The flash bulletin's state: at most one is prepared (drafts are replaced) and it is published once. */
export function flashState(rows: readonly BulletinRow[], phase: PhaseCode): FlashState {
  const flashes = rows.filter((b) => b.kind === "FLASH");
  const published = flashes.find((b) => b.published_at) ?? null;
  if (published) return { bulletin: published, published: true, blocked: "The flash bulletin has already been published." };
  const draft = sortBulletins(flashes)[0] ?? null;
  if (!draft) return { bulletin: null, published: false, blocked: "No flash bulletin has been prepared: upload it under Content." };
  if (phase !== "ROUNDS_13_21") return { bulletin: draft, published: false, blocked: "The flash bulletin is published during rounds 13–21 (04:00)." };
  return { bulletin: draft, published: false, blocked: null };
}
