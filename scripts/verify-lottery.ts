// Anyone can re-run the draw. Once the seed is revealed (00:30), download the lottery record and run
//
//   pnpm verify-lottery --file lottery-record.json
//
// It checks the seed against the commitment shown at 21:00 and recomputes the squads, problem cards, coverage and
// crisis cards from the seed and the dice (see scripts/lib/lottery-record.ts for the record's format).

import { readFileSync } from "node:fs";
import { parseArgs } from "./lib/args";
import { checkLotteryRecord, type LotteryRecord } from "./lib/lottery-record";

const args = parseArgs(process.argv.slice(2));
if (typeof args.file !== "string") {
  console.error("usage: pnpm verify-lottery --file lottery-record.json");
  process.exit(2);
}
const record = JSON.parse(readFileSync(args.file, "utf8")) as LotteryRecord;
const problems = checkLotteryRecord(record);
if (problems.length) {
  console.error(`The record does NOT match the draw (${problems.length} problem${problems.length === 1 ? "" : "s"}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `OK: the seed matches the commitment, and all ${record.squads.length} squads` +
    `${record.crises ? " and crisis cards" : ""} are exactly what the seed and the dice produce.`,
);
