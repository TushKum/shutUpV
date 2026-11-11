// Moves a seeded E2E event to common states through the real game functions (as the organisers and teams would),
// so a spec can start from, say, an open round. The clock is moved by editing the schedule, as in the database tests.

import { sha256Hex } from "@msim/engine";
import type { E2eEvent } from "./event";

/** The event's secret seed (64 hex characters) and its published commitment, derived from the slug. */
export const seedOf = (ev: E2eEvent) => sha256Hex(`seed:${ev.slug}`);

/** Publishes the commitment (only possible in SETUP). */
export async function commit(ev: E2eEvent) {
  await ev.n.org("set_seed_commitment", ev.n.eventId, sha256Hex(seedOf(ev)));
}

export async function squads(ev: E2eEvent) {
  const out = [];
  for (let i = 1; i <= ev.plan.teams.length / 3; i++) out.push(await ev.n.squad(i));
  return out;
}

/** SETUP → SQUAD_DRAW with the lottery drawn (dice "4"). */
export async function drawn(ev: E2eEvent) {
  await commit(ev);
  await ev.n.advanceTo("SQUAD_DRAW");
  await ev.n.org("run_lottery", ev.n.eventId, seedOf(ev), "4");
  return squads(ev);
}

/** … → READING with every pitch submitted, judged (60 → +5%, IPO $10.50) and released. */
export async function pitchesReleased(ev: E2eEvent) {
  const s = await drawn(ev);
  await ev.n.advanceTo("BUILD");
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  for (const [i, x] of s.entries()) {
    const p = ev.n.team(x.p_code);
    await ev.n.ok(p, "save_draft", "PITCH", {
      company_name: `Company ${i + 1}`,
      ticker: `E${ev.plan.teams[0]!.code[0]}${letters[i]}`,
      problem: "Unsafe water in small towns.",
      solution: "Sensors in every tank.",
      customers: "Town councils.",
      business_model: "Yearly subscription.",
      advantage: "Cheaper than lab tests.",
      use_of_seed: "First 100 sensors.",
    }, 0);
    await ev.n.ok(p, "submit_submission", "PITCH");
  }
  await ev.n.deadlinePassed("PITCH");
  await ev.n.advanceTo("READING");
  for (const x of s) await ev.n.judge(x.company_id, "PITCH", [60, 60, 60]);
  await ev.n.deadlinePassed("CALL_1");
  await ev.n.org("release_scores", ev.n.eventId, "PITCH");
  return s;
}

/** … → ROUNDS_1_4 (the IPO allocated with no bids), round 1 not yet open. */
export async function trading(ev: E2eEvent) {
  const s = await pitchesReleased(ev);
  await ev.n.advanceTo("IPO");
  await ev.n.advanceTo("ROUNDS_1_4");
  return s;
}
