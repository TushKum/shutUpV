import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseCsv } from "@msim/engine";
import { parseStatements } from "../../apps/web/lib/admin/content";
import { buildSectorFiles, readLibrary } from "../sectors";

const library = readLibrary();
const rows = (text: string) => parseCsv(text).slice(1);

describe("the sector library (seed/sectors/all)", () => {
  test("five sectors, each with one problem card, four crisis cards (Operations, Market, Trust, Money) and ten statements", () => {
    const sectors = rows(library.problems).map((r) => r[1]);
    expect(sectors).toEqual(["Luxury", "FMCG", "Energy", "Aviation", "Fintech"]);
    for (const s of sectors) {
      const deck = rows(library.crises).filter((r) => r[0] === s);
      expect(deck.map((r) => [r[1], r[2]]), s).toEqual([["Operations", "1"], ["Market", "2"], ["Trust", "3"], ["Money", "4"]]);
      expect(rows(library.statements).filter((r) => r[0] === s), s).toHaveLength(10);
    }
    // As uploaded: 50 statements, numbered 1–50, five companies each.
    const parsed = parseStatements(library.statements);
    expect(parsed.ok && parsed.value.map((x) => x.number)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(parsed.ok && parsed.value.every((x) => x.cap === 5)).toBe(true);
  });

  test("Luxury, FMCG and Energy give exactly the files in seed/sectors", () => {
    const files = buildSectorFiles(library, ["Luxury", "FMCG", "Energy"]);
    expect(files.problems).toBe(readFileSync("seed/sectors/problem-cards.csv", "utf8"));
    expect(files.crises).toBe(readFileSync("seed/sectors/crisis-cards.csv", "utf8"));
    expect(files.statements).toBe(readFileSync("seed/sectors/statements.csv", "utf8"));
  });

  test("a swap: problem cards and statements are numbered again in the order picked; names are matched without case", () => {
    const files = buildSectorFiles(library, ["luxury", "FMCG", "aviation"]);
    expect(rows(files.problems).map((r) => [r[0], r[1]])).toEqual([["1", "Luxury"], ["2", "FMCG"], ["3", "Aviation"]]);
    expect(rows(files.crises)).toHaveLength(12);
    expect(rows(files.crises).filter((r) => r[0] === "Aviation").map((r) => r[3])).toEqual([
      "Airport IT outage", "A giant builds its own", "A safety incident under investigation", "Jet fuel up 35%",
    ]);
    const statements = rows(files.statements);
    expect(statements.map((r) => r[1])).toEqual(Array.from({ length: 30 }, (_, i) => String(i + 1)));
    expect(statements[20]).toEqual(["Aviation", "21", "Cut airport queue time from check-in to boarding by half",
      "Aviation · Round 3. Cut airport queue time from check-in to boarding by half. Design the solution, how it is delivered and how it is measured.", "5"]);
    expect(rows(buildSectorFiles(library, ["Fintech", "Energy"]).problems).map((r) => r[1])).toEqual(["Fintech", "Energy"]);
  });

  test("a bad pick is refused with the reason", () => {
    expect(() => buildSectorFiles(library, ["Luxury"])).toThrow(/2 to 6 sectors/);
    expect(() => buildSectorFiles(library, ["Luxury", "Telecom"])).toThrow(/no sector "Telecom".*Luxury, FMCG, Energy, Aviation, Fintech/);
    expect(() => buildSectorFiles(library, ["Luxury", "luxury"])).toThrow(/Luxury is picked twice/);
  });
});
