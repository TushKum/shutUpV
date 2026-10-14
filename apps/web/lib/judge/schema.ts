// The JSON schema the model's answer must follow (structured outputs: output_config.format), one per submission type:
// `breakdown` with exactly the rubric's lines as integers, `total` an integer, `rationale` a string, nothing else.
// Ranges are not put in the schema (minimum/maximum may not be enforced); validateJudgeOutput (engine) checks them
// and that the total equals the sum. Pure.

import { RUBRICS, type SubmissionType } from "@msim/engine";

export function outputSchema(type: SubmissionType): Record<string, unknown> {
  const rubric = RUBRICS[type];
  return {
    type: "object",
    properties: {
      breakdown: {
        type: "object",
        description: "Points for each rubric line, a whole number from 0 to the line's maximum.",
        properties: Object.fromEntries(
          rubric.map((l) => [l.key, { type: "integer", description: `${l.label}: 0 to ${l.max}` }]),
        ),
        required: rubric.map((l) => l.key),
        additionalProperties: false,
      },
      total: { type: "integer", description: "The sum of the breakdown, 0 to 100." },
      rationale: { type: "string", description: "Three sentences explaining the score." },
    },
    required: ["breakdown", "total", "rationale"],
    additionalProperties: false,
  };
}
