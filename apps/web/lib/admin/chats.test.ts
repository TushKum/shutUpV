import { describe, expect, test } from "vitest";
import { chatHref, likePattern, parseChatQuery, sortChatSquads, type ChatSquad } from "./chats";

describe("parseChatQuery", () => {
  test("a squad number 1–50 and a trimmed search; anything else is ignored", () => {
    expect(parseChatQuery({ squad: "7", q: "  fee  " })).toEqual({ squad: 7, q: "fee" });
    expect(parseChatQuery({ squad: "0" })).toEqual({ squad: null, q: "" });
    expect(parseChatQuery({ squad: "x", q: ["a", "b"] })).toEqual({ squad: null, q: "a" });
    expect(parseChatQuery({ q: "y".repeat(300) }).q).toHaveLength(100);
  });
});

describe("sortChatSquads", () => {
  test("active squads by latest message, then quiet squads by number", () => {
    const s = (number: number, lastAt: string | null): ChatSquad => ({ id: `s${number}`, number, ticker: null, messages: lastAt ? 1 : 0, lastAt });
    const out = sortChatSquads([s(3, null), s(1, null), s(2, "2026-11-14T19:00:00Z"), s(4, "2026-11-14T19:05:00Z"), s(5, "2026-11-14T19:00:00Z")]);
    expect(out.map((x) => x.number)).toEqual([4, 2, 5, 1, 3]);
  });
});

test("likePattern escapes wildcards", () => {
  expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
});

test("chatHref", () => {
  expect(chatHref("night", {})).toBe("/admin/night/chats");
  expect(chatHref("night", { squad: 3, q: "fee 4%" })).toBe("/admin/night/chats?squad=3&q=fee+4%25");
});
