import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { sha256Hex, type LotteryRecord } from "@msim/engine";
import { seedE2eEvent, type E2eEvent } from "./support/event";
import { seedOf, trading } from "./support/game";

// The public lottery record (GET /api/lottery-record?event=<slug>), fetched without signing in: refused (404) until
// the seed is revealed at the crisis, then the JSON that the repository's own verifier (pnpm verify-lottery) accepts.

test.describe.configure({ mode: "serial" });

const SLUG = "e2e-lottery-record";
const ROOT = join(__dirname, "..", "..", "..");
const url = (slug: string) => `/api/lottery-record?event=${encodeURIComponent(slug)}`;
let ev: E2eEvent;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  ev = await seedE2eEvent({ slug: SLUG, prefix: "W" });
});

/** Runs `pnpm verify-lottery` from the repository root; returns its exit code and output. */
function verify(file: string, ...extra: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("pnpm", ["--silent", "verify-lottery", "--file", file, ...extra], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number | null; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

test("a bad or missing slug is a 400; errors are never cached", async ({ request }) => {
  for (const bad of ["Bad Slug!", "x", "../etc", ""]) {
    const r = await request.get(url(bad));
    expect(r.status(), bad).toBe(400);
    expect(r.headers()["cache-control"]).toBe("no-store");
    expect(await r.json()).toEqual({ error: "Say which event: ?event=<slug>." });
  }
  const none = await request.get("/api/lottery-record");
  expect(none.status()).toBe(400);
  expect(none.headers()["cache-control"]).toBe("no-store");
});

test("before the draw, and after it until the crisis, there is no record (404, not cached)", async ({ request }) => {
  const before = await request.get(url(SLUG));
  expect(before.status()).toBe(404);
  expect(before.headers()["cache-control"]).toBe("no-store");
  expect((await before.json()).error).toMatch(/published when the seed is revealed/);
  // An event that does not exist answers the same way.
  const unknown = await request.get(url("no-such-event-here"));
  expect(unknown.status()).toBe(404);

  await trading(ev); // the draw, the pitches, the IPO: round 1 next
  expect((await ev.n.one("select seed_revealed from events where id = $1", [ev.n.eventId])).seed_revealed).toBeNull();
  const drawnOnly = await request.get(url(SLUG));
  expect(drawnOnly.status()).toBe(404);
  expect(drawnOnly.headers()["cache-control"]).toBe("no-store");
});

test("after the crisis (the seed revealed): the record, cached for a minute, that pnpm verify-lottery accepts", async ({ request }, info) => {
  test.setTimeout(120_000);
  await ev.n.advanceTo("CRISIS"); // leaving Rounds 1–4 clears its rounds; the crisis draw reveals the seed
  expect((await ev.n.one("select seed_revealed from events where id = $1", [ev.n.eventId])).seed_revealed).toBe(seedOf(ev));

  const r = await request.get(url(SLUG));
  expect(r.status()).toBe(200);
  expect(r.headers()["cache-control"]).toBe("public, max-age=60");
  expect(r.headers()["content-type"]).toMatch(/^application\/json/);
  const record = (await r.json()) as LotteryRecord;
  expect(record.seed).toBe(seedOf(ev));
  expect(sha256Hex(record.seed)).toBe(record.commitment);
  const stored = await ev.n.one("select seed_commitment, dice from events where id = $1", [ev.n.eventId]);
  expect(record.commitment).toBe(stored.seed_commitment);
  expect(record.dice).toBe("4");
  expect(record.squads).toHaveLength(3);
  expect(record.crises).toHaveLength(3);
  // Only codes and card numbers: no team names.
  const text = JSON.stringify(record);
  for (const t of ev.plan.teams) expect(text).not.toContain(t.name);

  const file = info.outputPath("lottery-record.json");
  writeFileSync(file, await r.text());
  const ok = verify(file, "--commitment", sha256Hex(seedOf(ev)));
  expect(ok.out).toContain("OK: the seed matches the commitment, and all 3 squads and crisis cards are exactly what the seed and the dice produce.");
  expect(ok.code).toBe(0);

  // The verifier really checks: a record with two squads' Product teams swapped is refused.
  const tampered = structuredClone(record);
  [tampered.squads[0]!.product, tampered.squads[1]!.product] = [tampered.squads[1]!.product, tampered.squads[0]!.product];
  const bad = info.outputPath("tampered.json");
  writeFileSync(bad, JSON.stringify(tampered));
  const refused = verify(bad);
  expect(refused.code).toBe(1);
  expect(refused.out).toContain("The record does NOT match the draw");
});
