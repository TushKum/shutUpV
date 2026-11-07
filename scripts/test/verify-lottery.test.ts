import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { drawLottery, sha256Hex } from "@msim/engine";
import { recordShapeProblems, type LotteryRecord } from "../lib/lottery-record";

const SEED = "5eed".repeat(16);
const teams = ["A101", "A102", "B201", "B202", "C301"];
const problemCards = ["1", "2"];
const crisisCards = ["1", "2", "3"];

function record(): LotteryRecord {
  const d = drawLottery(SEED, "4", teams, problemCards, crisisCards.map((n) => ({ id: n, number: Number(n) })));
  return {
    seed: SEED,
    dice: "4",
    commitment: sha256Hex(SEED),
    teams,
    problemCards,
    crisisCards,
    draws: teams.map((t) => ({ team: t, problem: d.problems.get(t)!, crisis: d.crises.get(t)!, rescues: d.circle.get(t)! })),
  };
}

function verify(json: unknown, ...extra: string[]): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "primus-lottery-"));
  const file = join(dir, "record.json");
  writeFileSync(file, JSON.stringify(json));
  try {
    const out = execFileSync("pnpm", ["exec", "tsx", "scripts/verify-lottery.ts", "--file", file, ...extra], { encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
}

test("a true record checks out, against the commitment published before the event too", () => {
  const r = verify(record(), "--commitment", sha256Hex(SEED));
  expect(r.code).toBe(0);
  expect(r.out).toContain("OK: the seed matches the commitment, and the problem cards, crisis cards and rescue circle of all 5 teams");
}, 30_000);

test("a changed rescue is caught; a file that is not a record is explained", () => {
  const bad = record();
  const [a, b] = [bad.draws[0]!, bad.draws[1]!];
  [a.rescues, b.rescues] = [b.rescues, a.rescues];
  const r = verify(bad);
  expect(r.code).toBe(1);
  expect(r.out).toContain("does NOT match the draw");
  const shape = verify({});
  expect(shape.code).toBe(2);
  expect(shape.out).toContain('is not a lottery record: "seed" is missing');
  expect(recordShapeProblems([])).toEqual(["the file is not a lottery record (expected a JSON object)"]);
}, 30_000);
