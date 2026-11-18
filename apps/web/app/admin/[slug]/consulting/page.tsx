import type { Metadata } from "next";
import { loadAdminEvent } from "@/lib/admin/event";
import { loadSquads, loadSubmissions, mark } from "@/lib/admin/tracks-data";
import { supabaseServer } from "@/lib/supabase/server";
import { clock, money } from "@/lib/format";
import { Panel, Stat, Table, Td } from "@/components/ui/ui";

export const metadata: Metadata = { title: "Consulting" };

interface Engagement {
  k: number;
  company_id: string;
  firm_team_id: string;
  escrow: string;
  rating: number | null;
  bonus_cents: number | string | null;
}

// The Consulting track: each firm's Round 1 memo, its clients in every crisis and in Round 3, the advice memos it
// handed in, its ratings and bonuses; and each crisis sub-round's hiring, escrow and ratings.
export default async function ConsultingTrack({ params }: PageProps<"/admin/[slug]/consulting">) {
  const { slug } = await params;
  const event = await loadAdminEvent(slug);
  const [{ teams, squads }, subs] = await Promise.all([loadSquads(event.id), loadSubmissions(event.id)]);
  const sb = await supabaseServer();
  const [engagementsQ, subroundsQ] = await Promise.all([
    sb.from("engagements").select("k, company_id, firm_team_id, escrow, rating, bonus_cents").eq("event_id", event.id),
    sb.from("subrounds").select("k, revealed_at, hiring_closed_at, due_closed_at, rated_at").eq("event_id", event.id).order("k"),
  ]);
  const engagements = (engagementsQ.data ?? []) as Engagement[];
  const subrounds = (subroundsQ.data ?? []) as { k: number; revealed_at: string | null; hiring_closed_at: string | null; due_closed_at: string | null; rated_at: string | null }[];
  const firms = teams.filter((t) => t.track === "CONSULTING");
  const squadOf = new Map(squads.map((s) => [s.consulting.id, s]));
  const memo = (firm: string) => subs.find((s) => s.type === "MEMO" && s.squad_id === squadOf.get(firm)?.id);
  const advice = (firm: string, k: number) =>
    subs.filter((s) => s.submitted_by_team === firm && s.type === (k === 5 ? "ADVICE_5" : `ADVICE_${k}`) && s.submitted_at).length;
  const hired = (firm: string, k: number) => engagements.filter((e) => e.firm_team_id === firm && e.k === k).length;
  const ratings = (firm: string) => engagements.filter((e) => e.firm_team_id === firm && e.rating !== null).map((e) => e.rating!);
  const memos = firms.filter((f) => memo(f.id)?.submitted_at).length;
  const hires = engagements.length;
  const allRatings = engagements.filter((e) => e.rating !== null).map((e) => e.rating!);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Firms" value={firms.length} />
        <Stat label="Round 1 memos" value={`${memos} / ${firms.length}`} hint="the ElevenLabs case" />
        <Stat label="Hires" value={hires} hint="all crises and Round 3" />
        <Stat label="Average stars" value={allRatings.length ? (allRatings.reduce((a, b) => a + b, 0) / allRatings.length).toFixed(1) : "—"} hint={`${allRatings.length} ratings`} />
      </div>

      <Panel title="Firms">
        <Table head={["Firm", "Squad", "Memo", "Crisis 1", "Crisis 2", "Crisis 3", "Crisis 4", "Round 3", "Stars", "Bonus"]} label="Firms" empty="No firms.">
          {firms.map((f) => {
            const r = ratings(f.id);
            const bonus = engagements.filter((e) => e.firm_team_id === f.id).reduce((t, e) => t + Number(e.bonus_cents ?? 0), 0);
            return (
              <tr key={f.id} data-testid={`firm-${f.code}`}>
                <Td mono>{f.code}</Td>
                <Td mono>{squadOf.get(f.id)?.number ?? "—"}</Td>
                <Td>{mark(memo(f.id))}</Td>
                {[1, 2, 3, 4, 5].map((k) => {
                  const n = hired(f.id, k);
                  return (
                    <Td key={k} mono>
                      {n ? `${n} hired · ${advice(f.id, k)} memo${advice(f.id, k) === 1 ? "" : "s"}` : "—"}
                    </Td>
                  );
                })}
                <Td mono>{r.length ? `${(r.reduce((a, b) => a + b, 0) / r.length).toFixed(1)} (${r.length})` : "—"}</Td>
                <Td mono>{bonus ? money(bonus) : "—"}</Td>
              </tr>
            );
          })}
        </Table>
        <p className="mt-2 text-xs text-muted">Per crisis: how many companies hired the firm, and how many advice memos it handed in.</p>
      </Panel>

      {event.format === "PRIMUS" ? (
        <Panel title="Crisis sub-rounds">
          <Table head={["Sub-round", "Revealed", "Hiring closed", "Escrow settled", "Ratings closed", "Firms hired", "Rated"]} empty="No sub-round has started." label="Sub-rounds">
            {subrounds.map((s) => {
              const h = engagements.filter((e) => e.k === s.k);
              return (
                <tr key={s.k} data-testid={`subround-${s.k}`}>
                  <Td>{s.k === 5 ? "Round 3" : `Crisis ${s.k}`}</Td>
                  <Td mono>{clock(s.revealed_at)}</Td>
                  <Td mono>{clock(s.hiring_closed_at)}</Td>
                  <Td mono>{clock(s.due_closed_at)}</Td>
                  <Td mono>{clock(s.rated_at)}</Td>
                  <Td mono>{h.length}</Td>
                  <Td mono>{h.filter((e) => e.rating !== null).length}</Td>
                </tr>
              );
            })}
          </Table>
          <p className="mt-2 text-xs text-muted">
            The heartbeat reveals each crisis at its time, closes hiring, settles escrow at the due time and fills missing ratings with 3.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}
