import { describe, expect, test } from "vitest";
import { author, chatCheck, chatState } from "./chat";

describe("chatState", () => {
  test("opens at the draw and closes at the awards", () => {
    expect(chatState("BRIEFING", false)).toBe("NOT_YET");
    expect(chatState("SQUAD_DRAW", false)).toBe("NOT_YET");
    expect(chatState("SQUAD_DRAW", true)).toBe("OPEN");
    expect(chatState("SETTLEMENT", true)).toBe("OPEN");
    expect(chatState("AWARDS", true)).toBe("CLOSED");
  });
});

describe("chatCheck", () => {
  test("1 to 500 characters after trimming, counted as the database counts them", () => {
    expect(chatCheck("   ")).toMatchObject({ ok: false, message: "Write a message first." });
    expect(chatCheck(` ${"x".repeat(500)} `)).toEqual({ ok: true, chars: 500 });
    expect(chatCheck("😀".repeat(500))).toEqual({ ok: true, chars: 500 });
    expect(chatCheck("x".repeat(501))).toMatchObject({ ok: false, message: "Messages are at most 500 characters (this one has 501)." });
  });
});

describe("author", () => {
  const squad = { product_team_id: "p", consulting_team_id: "c", finance_team_id: "f" };
  test("names the track, and marks the reader's own team", () => {
    expect(author("p", squad, "c")).toEqual({ track: "PRODUCT", label: "Product team", mine: false });
    expect(author("c", squad, "c")).toEqual({ track: "CONSULTING", label: "Consulting team (you)", mine: true });
    expect(author("f", squad, "c").label).toBe("Finance team");
    expect(author("x", squad, "c")).toEqual({ track: null, label: "Another team", mine: false });
  });
});
