import { describe, expect, test } from "vitest";
import { USE_FLASH, bulletinFromForm, flashState, sortBulletins, type BulletinRow } from "./content-bulletins";

describe("the composer", () => {
  test("publishes GENERAL, CRISIS, FAIRNESS and SYSTEM bulletins, trimmed", () => {
    for (const kind of ["GENERAL", "CRISIS", "FAIRNESS", "SYSTEM"]) {
      expect(bulletinFromForm({ kind, title: "  Round 5 opens  ", body: " Trade now.\r\nGood luck. " })).toEqual({
        ok: true,
        value: { kind, title: "Round 5 opens", body: "Trade now.\nGood luck." },
      });
    }
    expect(bulletinFromForm({ kind: "SYSTEM", title: "Wi-Fi back", body: null })).toEqual({ ok: true, value: { kind: "SYSTEM", title: "Wi-Fi back", body: "" } });
  });

  test("refuses FLASH (it has its own path) and unknown kinds", () => {
    expect(bulletinFromForm({ kind: "FLASH", title: "Rates rise", body: "x" })).toEqual({ ok: false, message: USE_FLASH });
    expect(bulletinFromForm({ kind: "PROMO", title: "t", body: "" })).toEqual({ ok: false, message: "Choose a kind: General, Crisis, Fairness, System." });
    expect(bulletinFromForm({ kind: null, title: "t", body: "" }).ok).toBe(false);
  });

  test("needs a title of up to 140 characters and a body of up to 4,000", () => {
    expect(bulletinFromForm({ kind: "GENERAL", title: "   ", body: "b" })).toEqual({ ok: false, message: "A bulletin needs a title." });
    expect(bulletinFromForm({ kind: "GENERAL", title: "t".repeat(141), body: "" })).toEqual({ ok: false, message: "The title is at most 140 characters." });
    expect(bulletinFromForm({ kind: "GENERAL", title: "📈".repeat(140), body: "" }).ok).toBe(true);
    expect(bulletinFromForm({ kind: "GENERAL", title: "t", body: "b".repeat(4001) })).toEqual({ ok: false, message: "The body is at most 4,000 characters." });
  });
});

const row = (id: string, kind: BulletinRow["kind"], created: string, published: string | null): BulletinRow => ({
  id,
  kind,
  title: id,
  body: "",
  created_at: `2026-10-08T${created}:00Z`,
  published_at: published ? `2026-10-08T${published}:00Z` : null,
});

describe("the list", () => {
  test("newest first: published bulletins by publication time, drafts by when they were prepared", () => {
    const rows = [row("a", "GENERAL", "14:00", "14:00"), row("flash", "FLASH", "14:30", null), row("b", "CRISIS", "15:00", "19:00"), row("c", "SYSTEM", "16:00", "16:00")];
    expect(sortBulletins(rows).map((r) => r.id)).toEqual(["b", "c", "flash", "a"]);
  });
});

describe("the flash bulletin", () => {
  test("not prepared, prepared (publishable only in rounds 13–21), published", () => {
    expect(flashState([row("a", "GENERAL", "14:00", "14:00")], "ROUNDS_13_21")).toEqual({
      bulletin: null,
      published: false,
      blocked: "No flash bulletin has been prepared: upload it under Content.",
    });
    const draft = row("flash", "FLASH", "14:30", null);
    expect(flashState([draft], "RESCUE_2")).toEqual({ bulletin: draft, published: false, blocked: "The flash bulletin is published during rounds 13–21 (04:00)." });
    expect(flashState([draft], "ROUNDS_13_21")).toEqual({ bulletin: draft, published: false, blocked: null });
    const done = row("flash", "FLASH", "14:30", "22:30");
    expect(flashState([done], "ROUNDS_13_21")).toEqual({ bulletin: done, published: true, blocked: "The flash bulletin has already been published." });
  });
});
