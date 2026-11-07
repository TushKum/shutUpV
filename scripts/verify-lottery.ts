// Anyone can re-run the draw. Once the seed is revealed (23:45), download the lottery record
// (/api/lottery-record?event=<slug>) and run
//
//   pnpm verify-lottery --file lottery-record.json [--commitment <the SHA-256 published before the event>]
//
// It checks the seed against the commitment and recomputes the problem cards, the crisis cards and the rescue circle
// from the seed and the dice (see packages/engine/src/lottery-record.ts for the record's format). Pass --commitment with the
// value you saw published before the event, so the check does not rely on the record's own copy.

import { readFileSync } from "node:fs";
import { parseArgs } from "./lib/args";
import { asRecord, checkLotteryRecord, recordShapeProblems } from "./lib/lottery-record";

const args = parseArgs(process.argv.slice(2));
if (typeof args.file !== "string") {
  console.error("usage: pnpm verify-lottery --file lottery-record.json");
  process.exit(2);
}
let json: unknown;
try {
  json = JSON.parse(readFileSync(args.file, "utf8"));
} catch (e) {
  console.error(`Could not read ${args.file} as JSON: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
const shape = recordShapeProblems(json);
if (shape.length) {
  console.error(`${args.file} is not a lottery record: ${shape.join("; ")}.`);
  process.exit(2);
}
const record = asRecord(json);
const problems = checkLotteryRecord(record, typeof args.commitment === "string" ? args.commitment : undefined);
if (problems.length) {
  console.error(`The record does NOT match the draw (${problems.length} problem${problems.length === 1 ? "" : "s"}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `OK: the seed matches the commitment, and the problem cards, crisis cards and rescue circle of all ${record.teams.length} teams ` +
    "are exactly what the seed and the dice produce.",
);
