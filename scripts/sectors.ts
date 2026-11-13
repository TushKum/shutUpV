// Writes the three Content-page files (problem deck, crisis deck, Round 3 statements) for any mix of 2 to 6 sectors,
// taken from the sector library in seed/sectors/all (Luxury, FMCG, Energy, Aviation, Fintech). Each sector brings its
// problem card, its four crisis cards (1 Operations, 2 Market, 3 Trust, 4 Money) and its ten Round 3 statements;
// problem cards and statements are numbered again in the order given. The files are checked with the Content page's
// own parsers before they are written.
//
//   pnpm sectors --pick Luxury,FMCG,Aviation          → out/sectors/luxury-fmcg-aviation/
//   pnpm sectors --pick Luxury,FMCG,Energy --out dir   (the same files as seed/sectors)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "@msim/engine";
import { parseCrisisDeck, parseProblemDeck, parseStatements } from "../apps/web/lib/admin/content";
import { parseArgs } from "./lib/args";

export const LIBRARY = "seed/sectors/all";
const FILES = { problems: "problem-cards.csv", crises: "crisis-cards.csv", statements: "statements.csv" } as const;

export type SectorFiles = Record<keyof typeof FILES, string>;

/** RFC 4180, as the files in seed/sectors are written: a field is quoted only when it needs it; lines end in CRLF. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)).join(",")).join("\r\n") + "\r\n";
}

/** A file's rows as objects keyed by its header (a CSV whose header is not the expected one is refused). */
function rowsOf(text: string, header: readonly string[], file: string): Record<string, string>[] {
  const [head, ...rows] = parseCsv(text);
  if (head?.join(",") !== header.join(",")) throw new Error(`${file}: the header must be ${header.join(",")}`);
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** The upload files for `sectors` (2 to 6 names from the library, in this order). */
export function buildSectorFiles(library: SectorFiles, sectors: readonly string[]): SectorFiles {
  const problems = rowsOf(library.problems, ["number", "sector", "title", "body"], FILES.problems);
  const crises = rowsOf(library.crises, ["sector", "category", "number", "title", "body"], FILES.crises);
  const statements = rowsOf(library.statements, ["sector", "number", "title", "body", "cap"], FILES.statements);
  const known = problems.map((p) => p.sector!);
  const key = (s: string) => s.trim().toLowerCase();

  if (sectors.length < 2 || sectors.length > 6) throw new Error(`pick 2 to 6 sectors (the platform splits the squads between 2 to 6); got ${sectors.length}`);
  const picked = sectors.map((s) => {
    const name = known.find((k) => key(k) === key(s));
    if (!name) throw new Error(`no sector "${s}" in the library; it has ${known.join(", ")}`);
    return name;
  });
  const twice = picked.find((s, i) => picked.indexOf(s) !== i);
  if (twice) throw new Error(`${twice} is picked twice`);

  const out = { problems: [["number", "sector", "title", "body"]], crises: [["sector", "category", "number", "title", "body"]], statements: [["sector", "number", "title", "body", "cap"]] };
  let statementNo = 0;
  for (const [i, sector] of picked.entries()) {
    const own = <T extends { sector?: string }>(rows: T[]) => rows.filter((r) => r.sector === sector);
    const card = own(problems);
    const deck = own(crises);
    const list = own(statements);
    if (card.length !== 1) throw new Error(`${sector} needs exactly one problem card in the library; it has ${card.length}`);
    if (deck.length !== 4 || deck.some((c, k) => c.number !== String(k + 1))) throw new Error(`${sector} needs four crisis cards numbered 1 to 4 in the library`);
    if (list.length === 0) throw new Error(`${sector} has no Round 3 statements in the library`);
    out.problems.push([String(i + 1), sector, card[0]!.title!, card[0]!.body!]);
    for (const c of deck) out.crises.push([sector, c.category!, c.number!, c.title!, c.body!]);
    for (const s of list) out.statements.push([sector, String(++statementNo), s.title!, s.body!, s.cap!]);
  }
  const files: SectorFiles = { problems: toCsv(out.problems), crises: toCsv(out.crises), statements: toCsv(out.statements) };

  // The Content page's own checks, so the files upload as they are.
  for (const [what, parsed] of [
    ["problem deck", parseProblemDeck(files.problems)],
    ["crisis deck", parseCrisisDeck(files.crises)],
    ["statements", parseStatements(files.statements)],
  ] as const) {
    if (!parsed.ok) throw new Error(`the ${what} would be refused: ${parsed.message}`);
  }
  return files;
}

export function readLibrary(dir = LIBRARY): SectorFiles {
  const read = (f: string) => readFileSync(join(dir, f), "utf8");
  return { problems: read(FILES.problems), crises: read(FILES.crises), statements: read(FILES.statements) };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || typeof args.pick !== "string") {
    console.log("pnpm sectors --pick Luxury,FMCG,Aviation [--out <dir>]   (2 to 6 of: " +
      rowsOf(readLibrary().problems, ["number", "sector", "title", "body"], FILES.problems).map((p) => p.sector).join(", ") + ")");
    return args.help ? 0 : 1;
  }
  const sectors = args.pick.split(",").map((s) => s.trim()).filter(Boolean);
  const files = buildSectorFiles(readLibrary(), sectors);
  const dir = typeof args.out === "string" ? args.out : join("out/sectors", sectors.map((s) => s.toLowerCase()).join("-"));
  mkdirSync(dir, { recursive: true });
  for (const [k, f] of Object.entries(FILES)) writeFileSync(join(dir, f), files[k as keyof SectorFiles]);
  const count = (text: string) => parseCsv(text).length - 1;
  console.log(`Wrote ${dir}: ${count(files.problems)} problem cards, ${count(files.crises)} crisis cards, ${count(files.statements)} statements.`);
  console.log("Upload them on the Content page before the squad draw (the statements before Round 3).");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
