import { expect, test } from "vitest";
import { humanColumns, humanJudge, missingRows, parseHumanScores } from "../lib/human-scores";

const header = humanColumns("PRD").join(",");

test("the panel's CSV: three judges per company, each row checked against the rubric", () => {
  const csv = [
    header,
    "CRSP,1,16,19,14,10,7,7,Clear user.",
    "crsp,2,15,18,12,9,6,6,",
    "CRSP,3,17,20,14,10,8,7,Strong maths.",
  ].join("\n");
  const r = parseHumanScores("PRD", csv);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.scores.get("CRSP")!.get(1)!.total).toBe(73);
  expect(r.scores.get("CRSP")!.get(2)!.rationale).toMatch(/human judge 2/);
  expect(missingRows(r.scores, [{ ticker: "CRSP", runNo: 3 }, { ticker: "MNSF", runNo: 1 }])).toEqual({ missing: ["MNSF judge 1"] });
});

test("errors are listed, nothing half-read", () => {
  const r = parseHumanScores("PRD", [header, "CRS,1,1,1,1,1,1,1,x", "CRSP,4,1,1,1,1,1,1,x", "CRSP,1,21,0,0,0,0,0,x"].join("\n"));
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.errors[0]).toMatch(/not 4 letters/);
  expect(r.errors[1]).toMatch(/judge must be 1, 2 or 3/);
  expect(r.errors[2]).toMatch(/CRSP, judge 1/);
  expect(parseHumanScores("SOLUTION", "ticker,judge\n").ok).toBe(false);
});

test("reading N of a company gets judge N's row; a missing row stops the worker", async () => {
  const r = parseHumanScores("PRD", [header, "CRSP,2,16,19,14,10,7,7,Clear user."].join("\n"));
  if (!r.ok) throw new Error("bad csv");
  const judge = humanJudge(r.scores);
  const ask = (runNo: number) => judge({ type: "PRD", model: "m", system: "S", userText: '<submission type="PRD" ticker="CRSP">x</submission>', requestText: "x", runNo });
  expect(await ask(2)).toMatchObject({ ok: true, total: 73 });
  expect(await ask(1)).toMatchObject({ ok: false, fatal: true, error: "no score from judge 1 for CRSP in the CSV" });
});
