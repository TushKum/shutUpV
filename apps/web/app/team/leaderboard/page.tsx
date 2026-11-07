import type { Metadata } from "next";
import { AWARD_LABELS, phaseReached } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { boardView, rankText, type BoardRow } from "@/lib/team/leaderboard";
import { awardLines, type AwardRow } from "@/lib/awards";
import { rpc } from "@/lib/rpc";
import { supabaseServer } from "@/lib/supabase/server";
import { bp, count } from "@/lib/format";
import { Badge, Notice, Panel, Stat, Table, Td } from "@/components/ui/ui";

export const metadata: Metadata = { title: "Leaderboard" };

// The leaderboard: live until 03:30 (Round 1 points from 23:30, Round 2 from 02:45, Round 3 at current market prices
// from 02:15), then frozen and hidden until the awards; at AWARDS the final results and the awards. Scores, clearings,
// the freeze and the phase change broadcast, so the page re-reads itself then.
export default async function LeaderboardPage() {
  const { event, status, team } = await loadTeamContext();
  const view = boardView(await rpc("leaderboard", { p_event: event.id }), status.phase, team.id);

  if (view.state === "FROZEN") {
    return (
      <Panel title="Leaderboard" actions={<Badge tone="amber">Frozen</Badge>}>
        <p className="text-sm text-slate-700" data-testid="leaderboard-frozen">
          The leaderboard has frozen and stays hidden until the awards. Trading carries on until the closing bell: your Round 3 points come from your
          portfolio at closing prices.
        </p>
      </Panel>
    );
  }
  if (view.state === "ERROR") return <Notice tone="red">{view.message}</Notice>;

  const final = view.state === "FINAL";
  const ranked = view.rows.filter((r) => r.rank !== null).length;
  const awards = final ? await loadAwards(event.id, view.rows) : [];

  return (
    <div className="space-y-4">
      <Panel title={final ? "Final results" : "Leaderboard"} actions={final ? <Badge tone="green">Final</Badge> : <Badge tone="blue">Live until the freeze</Badge>}>
        {view.mine ? (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Your rank" value={<span data-testid="my-rank">{rankText(view.mine, ranked)}</span>} />
            <Stat label="Round 1 (PRD)" value={count(view.mine.r1)} />
            <Stat label="Round 2 (solution)" value={count(view.mine.r2)} />
            <Stat label="Round 3 (portfolio)" value={count(view.mine.r3)} />
            <Stat label="Total (of 300)" value={<span data-testid="my-total">{count(view.mine.total)}</span>} />
          </div>
        ) : null}
        <p className="text-sm text-slate-600">
          {final
            ? "Total = Round 1 + Round 2 + Round 3 points. Ties: the higher Round 2, then the higher Round 1, then the higher exact return. Disqualified teams are not ranked."
            : liveText(view.parts)}
        </p>
        <div className="mt-3 max-h-[40rem] overflow-y-auto">
          <Table head={["Rank", "Team", "R1", "R2", "R3", "Total", ...(final ? ["Return"] : [])]} label="Leaderboard" empty="No teams yet.">
            {view.rows.map((r) => (
              <Row key={r.team_id} r={r} mine={r.team_id === team.id} final={final} />
            ))}
          </Table>
        </div>
      </Panel>

      {final ? (
        <Panel title="Awards">
          {awards.length === 0 ? (
            <p className="text-sm text-slate-500">The awards are revealed on the big screen.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {awards.map((a) => (
                <li key={a.code} className="flex flex-wrap items-baseline gap-3 py-2 text-sm" data-testid={`award-${a.code}`}>
                  <span className="w-48 font-semibold text-slate-900">{AWARD_LABELS[a.code]}</span>
                  <span className="font-mono">{a.winners.join(", ")}</span>
                  <span className="text-slate-500">{a.metric}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : !phaseReached(status.phase, "REVEAL_1") ? (
        <Notice>Nothing is scored yet: Round 1 points appear at the PRD reveal.</Notice>
      ) : null}
    </div>
  );
}

function liveText(parts: { r1: boolean; r2: boolean; r3: boolean }): string {
  const waiting = [!parts.r1 ? "Round 1 points appear at the PRD reveal" : null, !parts.r3 ? "Round 3 points (at current market prices) once trading starts" : null, !parts.r2 ? "Round 2 points at the score reveal" : null].filter(
    Boolean,
  );
  return `The total so far.${waiting.length ? ` ${waiting.join("; ")}.` : " Round 3 counts at current market prices."} The leaderboard freezes during the market and the final ranking is revealed at the awards.`;
}

function Row({ r, mine, final }: { r: BoardRow; mine: boolean; final: boolean }) {
  return (
    <tr className={mine ? "bg-amber-50" : r.eligible === false ? "opacity-60" : ""} data-testid={mine ? "my-row" : undefined}>
      <Td mono>{r.rank ?? "—"}</Td>
      <Td mono className="font-semibold">
        {r.code}
        {mine ? <span className="ml-1 font-sans text-xs font-normal text-slate-600">(you)</span> : null}
        {r.name ? <span className="ml-1 font-sans font-normal text-slate-600">{r.name}</span> : null}
        {r.eligible === false ? (
          <span className="ml-1">
            <Badge tone="red">Disqualified</Badge>
          </span>
        ) : null}
      </Td>
      <Td mono>{r.r1}</Td>
      <Td mono>{r.r2}</Td>
      <Td mono>{r.r3}</Td>
      <Td mono className="font-semibold">
        {r.total}
      </Td>
      {final ? <Td mono>{r.return_bp === undefined ? "—" : bp(r.return_bp)}</Td> : null}
    </tr>
  );
}

/** The awards (readable from AWARDS); team codes from the final rows, tickers from the public companies. */
async function loadAwards(eventId: string, rows: readonly BoardRow[]) {
  const sb = await supabaseServer();
  const [awards, companies] = await Promise.all([
    sb.from("awards").select("code, team_id, company_id, metric").eq("event_id", eventId),
    sb.from("companies").select("id, ticker").eq("event_id", eventId),
  ]);
  if (awards.error) throw new Error(`Could not read the awards: ${awards.error.message}`);
  const codes = new Map(rows.map((r) => [r.team_id, r.code]));
  const tickers = new Map((companies.data ?? []).map((c) => [c.id as string, c.ticker as string | null]));
  return awardLines((awards.data ?? []) as AwardRow[], codes, tickers);
}
