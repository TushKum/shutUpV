import { describe, expect, test } from "vitest";
import { confirmLabel, oversizedFile, safely } from "./action-helpers";

const form = (entries: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

describe("confirmLabel", () => {
  test("puts the typed value in the text", () => {
    expect(confirmLabel("Click again to extend by {minutes} min", form({ minutes: " 7 " }))).toBe("Click again to extend by 7 min");
    expect(confirmLabel("Click again to draw with dice {dice}", form({ dice: "4" }))).toBe("Click again to draw with dice 4");
    expect(confirmLabel("Click again to extend by {minutes} min", form({}))).toBe("Click again to extend by  min");
  });

  test("a code is shown by its label", () => {
    const values = { decision: { CLEARED: "clear the flag", DISQUALIFIED: "disqualify XF01, XF02" } };
    expect(confirmLabel("Click again to {decision}", form({ decision: "DISQUALIFIED" }), values)).toBe("Click again to disqualify XF01, XF02");
    expect(confirmLabel("Click again to {decision}", form({ decision: "CLEARED" }), values)).toBe("Click again to clear the flag");
  });
});

describe("oversizedFile", () => {
  test("refuses a file over the limit before it is sent", () => {
    const big = new File(["x".repeat(600 * 1024)], "big.csv", { type: "text/csv" });
    const small = new File(["number,title\n"], "small.csv", { type: "text/csv" });
    expect(oversizedFile(form({ file: big }), 512 * 1024)).toEqual({ ok: false, code: "BAD_FILE", message: "The file is 600 KB; the limit is 512 KB." });
    expect(oversizedFile(form({ file: small, note: "x" }), 512 * 1024)).toBeNull();
  });
});

describe("safely", () => {
  test("a thrown action becomes a refusal", async () => {
    expect(await safely(async () => ({ ok: true }))).toEqual({ ok: true });
    expect(await safely(async () => Promise.reject(new TypeError("Failed to fetch")))).toMatchObject({ ok: false, code: "NOT_SENT" });
  });
});
