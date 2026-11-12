// An event split across sectors (for example Luxury, FMCG and Energy): a problem deck of 2 to 6 cards deals the squads
// equally between the sectors by lottery (as the engine does, so the public record proves it); in each crisis every
// company gets its own sector's card; in Round 3 a company drafts only its own sector's statements.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drawLottery, sha256Hex } from "@msim/engine";
import { createTestDb } from "./pg";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const SEED = sha256Hex("sectors");
const SECTORS = ["Luxury", "FMCG", "Energy"];
const PROBLEMS = SECTORS.map((sector, i) => ({ number: i + 1, sector, title: `${sector} brief`, body: `Build a ${sector} startup.` }));
const TYPES = ["OPERATIONS", "MARKET", "TRUST", "MONEY"];
const CRISES = SECTORS.flatMap((sector) => TYPES.map((category, i) => ({ sector, category, number: i + 1, title: `${sector} ${category}`, body: `${sector} crisis ${i + 1}.` })));

describe("three sectors", () => {
  test("the draw splits the squads equally, each company gets its own sector's crises, and the draft keeps to the sector", async () => {
    const n = await Night.create(db.pool, 6, "PRIMUS");
    await n.org("upload_problem_deck", n.eventId, JSON.stringify(PROBLEMS));
    await n.org("upload_crisis_deck", n.eventId, JSON.stringify(CRISES));
    expect(await n.call(n.lead, "upload_crisis_deck", n.eventId, JSON.stringify([...CRISES, CRISES[0]]))).toMatchObject({ ok: false, code: "BAD_DECK" });
    await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, SEED, "3");

    // Two squads per sector, each with its card already chosen, exactly as the engine draws it.
    const rows = await n.q(
      `select s.number, p.code, s.dealt_card_ids, s.chosen_card_id, pc.sector from squads s
         join teams p on p.id = s.product_team_id join problem_cards pc on pc.id = s.chosen_card_id
        where s.event_id = $1 order by s.number`,
      [n.eventId],
    );
    expect(rows).toHaveLength(6);
    const per = new Map<string, number>();
    for (const r of rows) {
      expect(r.dealt_card_ids).toEqual([r.chosen_card_id]);
      per.set(r.sector, (per.get(r.sector) ?? 0) + 1);
    }
    expect([...per.values()]).toEqual([2, 2, 2]);
    const cards = await n.q("select id, sector from problem_cards where event_id = $1 order by number", [n.eventId]);
    const codes = (track: string) => n.ev.plan.teams.filter((t) => t.track === track).map((t) => t.code);
    const expected = drawLottery(SEED, "3", { product: codes("PRODUCT"), consulting: codes("CONSULTING"), finance: codes("FINANCE") },
      cards.map((c) => c.id));
    for (const s of expected.squads) {
      expect(rows.find((r) => r.number === s.number)).toMatchObject({ code: s.product, chosen_card_id: s.cards[0] });
    }

    // Through the IPO with every pitch in.
    await n.advanceTo("BUILD");
    const companies = await n.q(
      `select c.id, t.code, pc.sector from companies c join squads s on s.id = c.squad_id join teams t on t.id = c.product_team_id
         join problem_cards pc on pc.id = s.chosen_card_id where c.event_id = $1 order by s.number`,
      [n.eventId],
    );
    for (const [i, c] of companies.entries()) {
      await n.ok(n.team(c.code), "save_draft", "PITCH", { company_name: `Sector Co ${i}`, ticker: `SC${"ABCDEF"[i]}`, problem: "A real problem." }, 0);
      await n.ok(n.team(c.code), "submit_submission", "PITCH");
    }
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    for (const [i, c] of companies.entries()) await n.judge(c.id, "PITCH", [50 + i, 50 + i, 50 + i]);
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");
    await n.advanceTo("PRESSURE");

    // Crises 1 and 2: every company gets its own sector's card numbered 1, then 2.
    for (const k of [1, 2]) {
      await n.deadlinePassed(`REVEAL_${k}`);
      await n.ok(n.lead, "tick", n.eventId);
      const dealt = await n.q(
        "select x.company_id, k.sector, k.number from subround_crises x join crisis_cards k on k.id = x.crisis_card_id where x.event_id = $1 and x.k = $2",
        [n.eventId, k],
      );
      expect(dealt).toHaveLength(6);
      for (const d of dealt) {
        const c = companies.find((x) => x.id === d.company_id)!;
        expect({ sector: d.sector, number: d.number }).toEqual({ sector: c.sector, number: k });
      }
    }

    // Round 3: statements per sector; too little room in one sector is refused with the numbers.
    const statements = (capLuxury: number) =>
      JSON.stringify(SECTORS.flatMap((sector, i) => [1, 2].map((j) => ({ number: i * 2 + j, sector, title: `${sector} problem ${j}`, body: "A problem.", cap: sector === "Luxury" ? capLuxury : 5 }))));
    expect(await n.call(n.lead, "set_problem_statements", n.eventId, JSON.stringify([{ number: 1, sector: "Luxury", title: "Only one", body: "x", cap: 1 }]))).toMatchObject({
      ok: false,
      code: "NOT_ENOUGH_ROOM",
    });
    await n.org("set_problem_statements", n.eventId, statements(1));
    await n.advanceTo("SATURATION");
    expect((await n.one("select count(*)::int as c from draft_picks where event_id = $1", [n.eventId])).c).toBe(6);

    // The first company to pick may not take another sector's statement.
    const first = await n.one(
      `select t.code, pc.sector from draft_picks d join companies c on c.id = d.company_id join teams t on t.id = c.product_team_id
         join squads s on s.id = c.squad_id join problem_cards pc on pc.id = s.chosen_card_id where d.event_id = $1 and d.pick_no = 1`,
      [n.eventId],
    );
    const other = await n.one("select id from problem_statements where event_id = $1 and sector <> $2 limit 1", [n.eventId, first.sector]);
    expect(await n.call(n.team(first.code), "pick_statement", other.id)).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    const own = await n.one("select id from problem_statements where event_id = $1 and sector = $2 order by number limit 1", [n.eventId, first.sector]);
    await n.ok(n.team(first.code), "pick_statement", own.id);

    // Nobody else picks: the draft's time runs out and everyone gets a statement of their own sector.
    await n.deadlinePassed("DRAFT");
    await n.ok(n.lead, "tick", n.eventId);
    const picks = await n.q(
      `select pc.sector as company_sector, st.sector as statement_sector from draft_picks d join problem_statements st on st.id = d.statement_id
         join companies c on c.id = d.company_id join squads s on s.id = c.squad_id join problem_cards pc on pc.id = s.chosen_card_id
        where d.event_id = $1`,
      [n.eventId],
    );
    expect(picks).toHaveLength(6);
    for (const p of picks) expect(p.statement_sector).toBe(p.company_sector);
    await n.checkInvariants();
  }, 120_000);
});
