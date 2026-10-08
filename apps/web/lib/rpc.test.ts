import { describe, expect, test } from "vitest";
import { toResult } from "./rpc";

describe("rpc results", () => {
  test("a game refusal keeps its code and message; extra fields become data", () => {
    expect(toResult({ ok: false, code: "GATE", message: "The lottery has not been drawn." }, null)).toEqual({
      ok: false,
      code: "GATE",
      message: "The lottery has not been drawn.",
      data: {},
    });
    expect(toResult({ ok: true, phase: "BUILD" }, null)).toEqual({ ok: true, code: undefined, message: undefined, data: { phase: "BUILD" } });
  });

  test("database exceptions become refusals; permission errors are labelled", () => {
    expect(toResult(null, { message: "only an organiser can do this", code: "42501" })).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
      message: "Not allowed: only an organiser can do this",
    });
    expect(toResult(null, { message: "extend by 1 to 120 minutes", code: "P0001" })).toMatchObject({ ok: false, code: "ERROR", message: "extend by 1 to 120 minutes" });
  });

  test("plain values are wrapped", () => {
    expect(toResult("2026-11-14T14:30:00Z", null)).toEqual({ ok: true, data: { value: "2026-11-14T14:30:00Z" } });
  });
});
