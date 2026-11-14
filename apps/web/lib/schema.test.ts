import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { EXPECTED_SCHEMA, schemaState } from "./schema";

const dir = join(__dirname, "../../../supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const newest = files.at(-1)!;

describe("the schema version", () => {
  test("the app expects the newest migration", () => {
    expect(newest.slice(0, 14)).toBe(EXPECTED_SCHEMA);
  });
  test("the newest migration sets public.schema_version() to its own version", () => {
    const sql = readFileSync(join(dir, newest), "utf8");
    expect(sql).toMatch(/create or replace function public\.schema_version\(\)/);
    expect(sql).toContain(`select '${EXPECTED_SCHEMA}'::text`);
  });
  test("compares the database's version with the app's", () => {
    expect(schemaState(EXPECTED_SCHEMA)).toBe("ok");
    expect(schemaState("20261117000049")).toBe("behind");
    expect(schemaState("20991231000000")).toBe("ahead");
    expect(schemaState(null)).toBe("unknown");
    expect(schemaState("junk")).toBe("unknown");
  });
});
