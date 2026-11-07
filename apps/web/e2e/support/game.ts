// Moves a seeded E2E event to common states through the real game functions (as the organisers and teams would),
// so a spec can start from, say, the PRD editor open or the starting prices revealed. The clock is moved by editing
// the schedule, as in the database tests.

import { sha256Hex } from "@msim/engine";
import type { E2eEvent } from "./event";

/** The event's secret seed (64 hex characters) and its published commitment, derived from the slug. */
export const seedOf = (ev: E2eEvent) => sha256Hex(`seed:${ev.slug}`);

/** Publishes the commitment (only possible in SETUP). */
export async function commit(ev: E2eEvent) {
  await ev.n.org("set_seed_commitment", ev.n.eventId, sha256Hex(seedOf(ev)));
}

/** SETUP → BUILD with the problem cards dealt (dice "4"): the PRD editor is open. */
export async function building(ev: E2eEvent) {
  await commit(ev);
  await ev.n.advanceTo("BRIEFING");
  await ev.n.org("run_lottery", ev.n.eventId, seedOf(ev), "4");
  await ev.n.advanceTo("BUILD");
}

/** … → REVEAL_1: every team saved a PRD, judged 60/62/64 (median 62 → $11.20), the starting prices are out. */
export async function pricesRevealed(ev: E2eEvent) {
  await building(ev);
  for (const [i, t] of ev.plan.teams.entries()) {
    await ev.n.ok(ev.n.team(t.code), "save_draft", "PRD", {
      company_name: `Company ${i + 1}`,
      ticker: `E${t.code[0]}${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(i / 26)]}${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[i % 26]}`,
      problem: "Snacks go stale in humid towns.",
      target_user: "Kirana shops.",
      must_have: "Sealed jars.",
      per_pack_maths: "Price 640, cost 520.",
    }, 0);
  }
  await ev.n.deadlinePassed("PRD_LOCK");
  await ev.n.ok(ev.n.lead, "tick", ev.n.eventId);
  await ev.n.judgeAll("PRD", [60, 62, 64]);
  await ev.n.advanceTo("REVEAL_1");
}
