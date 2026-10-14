import { describe, expect, test } from "vitest";
import { RUBRICS, SUBMISSION_TYPES, validateJudgeOutput } from "@msim/engine";
import { outputSchema } from "./schema";

type Schema = {
  type: string;
  properties: Record<string, { type: string; properties?: Record<string, { type: string }>; required?: string[]; additionalProperties?: boolean }>;
  required: string[];
  additionalProperties: boolean;
};

describe("outputSchema", () => {
  test.each(SUBMISSION_TYPES)("%s: breakdown has exactly the rubric's lines as integers, all required, nothing extra", (type) => {
    const s = outputSchema(type) as Schema;
    const keys = RUBRICS[type].map((l) => l.key);
    expect(s.type).toBe("object");
    expect(s.required).toEqual(["breakdown", "total", "rationale"]);
    expect(s.additionalProperties).toBe(false);
    expect(Object.keys(s.properties)).toEqual(["breakdown", "total", "rationale"]);
    const b = s.properties.breakdown!;
    expect(b.type).toBe("object");
    expect(Object.keys(b.properties!)).toEqual(keys);
    for (const k of keys) expect(b.properties![k]!.type).toBe("integer");
    expect(b.required).toEqual(keys);
    expect(b.additionalProperties).toBe(false);
    expect(s.properties.total!.type).toBe("integer");
    expect(s.properties.rationale!.type).toBe("string");
  });

  test("ranges are left to validateJudgeOutput, not the schema", () => {
    for (const type of SUBMISSION_TYPES) {
      const json = JSON.stringify(outputSchema(type));
      expect(json).not.toMatch(/"(minimum|maximum|exclusiveMinimum|exclusiveMaximum)"/);
    }
    // A schema-shaped answer with a line over its maximum is still caught.
    expect(validateJudgeOutput("FLASH", { breakdown: { responds_to_news: 51, realistic: 0, clear: 0 }, total: 51, rationale: "x" }).ok).toBe(false);
  });
});
