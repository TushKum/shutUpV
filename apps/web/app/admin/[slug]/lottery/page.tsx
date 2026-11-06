import type { Metadata } from "next";
import { PHASE_LABELS, type PhaseCode } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { loadLotteryEvent, loadLotteryRows } from "@/lib/admin/lottery-data";
import { cardSpread, checkDraw, crisisSpread, recordFileName, teamDrawViews, type LotteryRows } from "@/lib/admin/lottery";
import { supabaseServer } from "@/lib/supabase/server";
import { clock, dateTime } from "@/lib/format";
import { Badge, Notice, Panel, Stat, Table, Td, inputClass } from "@/components/ui/ui";
import { ActionForm, ConfirmForm } from "@/components/ui/action";
import { runLottery, setSeedCommitment } from "./actions";

export const metadata: Metadata = { title: "Lottery" };

// Lottery: the seed commitment (published the day before, fixed once the event starts), the 21:15 draw with the seed
// check (problem cards), the 23:45 draw from the same seed (crisis cards and the rescue circle), and the stored draw
// re-done independently by the engine.
export default async function LotteryPage({ params }: PageProps<"/admin/[slug]/lottery">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const sb = await supabaseServer();
  const [status, lotteryEvent] = await Promise.all([loadEventStatus(event.id), loadLotteryEvent(sb, slug)]);
  const organiser = viewer!.role === "ORGANISER";
  const rows = lotteryEvent ? await loadLotteryRows(sb, lotteryEvent) : null;

  return (
    <div className="space-y-6">
      <CommitmentPanel eventId={event.id} commitment={event.seed_commitment} setup={status.phase === "SETUP" && !event.drawn_at} organiser={organiser} />
      {rows && lotteryEvent ? (
        <DrawnPanels slug={slug} rows={rows} drawnAt={lotteryEvent.drawn_at!} revealed={lotteryEvent.seed_revealed} crisisAt={lotteryEvent.crisis_applied_at} />
      ) : (
        <DrawPanel eventId={event.id} phase={status.phase} commitment={event.seed_commitment} organiser={organiser} />
      )}
    </div>
  );
}

function CommitmentPanel({ eventId, commitment, setup, organiser }: { eventId: string; commitment: string | null; setup: boolean; organiser: boolean }) {
  return (
    <Panel title="Seed commitment">
      <p className="text-sm text-slate-600">
        SHA-256 of the secret seed, published the day before the event (<code className="font-mono">pnpm new-seed</code> prints a seed and its
        commitment). The seed itself stays secret until the crisis at 23:45.
      </p>
      <div className="mt-3">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Published commitment</div>
        {commitment ? (
          <p className="mt-1 break-all font-mono text-sm" data-testid="commitment">
            {commitment}
          </p>
        ) : (
          <p className="mt-1 text-sm text-amber-800">Not published yet. The event cannot leave Setup without one.</p>
        )}
      </div>
      {setup ? (
        organiser ? (
          <ActionForm action={setSeedCommitment.bind(null, eventId)} submit={commitment ? "Replace commitment" : "Save commitment"} className="mt-4 max-w-2xl">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Commitment (64 hex characters)</span>
              <input name="commitment" required minLength={64} maxLength={64} pattern="[0-9a-fA-F]{64}" autoComplete="off" spellCheck={false} className={`${inputClass} font-mono`} />
            </label>
            <p className="mt-1 text-xs text-slate-500">It can be replaced while the event is in Setup; it is fixed once the event has started.</p>
          </ActionForm>
        ) : (
          <p className="mt-3 text-sm text-slate-500">An organiser enters the commitment while the event is in Setup.</p>
        )
      ) : (
        <p className="mt-3 text-sm text-slate-600">
          <Badge tone="slate">Read-only</Badge> The commitment is fixed once the event has started.
        </p>
      )}
    </Panel>
  );
}

function DrawPanel({ eventId, phase, commitment, organiser }: { eventId: string; phase: PhaseCode; commitment: string | null; organiser: boolean }) {
  const open = phase === "BRIEFING" || phase === "BUILD";
  return (
    <Panel title="Draw (21:15)">
      {!open ? (
        <Notice tone="slate">The draw is entered on stage at the start of Round 1 (Briefing or Build). The event is in {PHASE_LABELS[phase]}.</Notice>
      ) : !commitment ? (
        <Notice tone="red">No seed commitment was published, so the draw cannot be verified.</Notice>
      ) : organiser ? (
        <>
          <p className="text-sm text-slate-600">
            Enter the secret seed and the dice roll. The database checks SHA-256(seed) against the published commitment before anything is drawn; a
            mismatch changes nothing. The seed and dice deal the problem cards now, and the crisis cards and the rescue circle at 23:45.
          </p>
          <ConfirmForm action={runLottery.bind(null, eventId)} submit="Verify the seed and draw" confirm="Click again to draw with dice {dice}" className="mt-3 grid max-w-2xl gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Secret seed (64 hex characters)</span>
              <input name="seed" type="password" required autoComplete="off" spellCheck={false} className={`${inputClass} font-mono`} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Dice roll</span>
              <input name="dice" required inputMode="numeric" pattern="[0-9]{1,6}" maxLength={6} autoComplete="off" className={`${inputClass} w-40 font-mono`} />
            </label>
          </ConfirmForm>
        </>
      ) : (
        <Notice>Waiting for an organiser to enter the seed and the dice roll.</Notice>
      )}
    </Panel>
  );
}

function DrawnPanels({ slug, rows, drawnAt, revealed, crisisAt }: { slug: string; rows: LotteryRows; drawnAt: string; revealed: string | null; crisisAt: string | null }) {
  const check = checkDraw(rows);
  const teams = teamDrawViews(rows);
  const spread = cardSpread(teams);
  const crises = crisisSpread(teams);
  return (
    <>
      <Panel title="Draw">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Dice" value={<span className="font-mono">{rows.dice}</span>} />
          <Stat label="Problem cards dealt" value={clock(drawnAt, true)} hint={`${dateTime(drawnAt)} IST`} />
          <Stat
            label="Seed"
            value={check.seedMatches ? <Badge tone="green">Seed matches commitment</Badge> : <Badge tone="red">Seed does NOT match commitment</Badge>}
            hint={revealed ? "Published at the crisis" : "Secret until 23:45"}
          />
          <Stat
            label="Crisis and rescue circle"
            value={crisisAt ? clock(crisisAt, true) : "23:45"}
            hint={crisisAt ? "Drawn from the same seed" : "Drawn at the crisis"}
          />
        </div>
        <div className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Commitment</div>
        <p className="break-all font-mono text-sm">{rows.commitment}</p>
        {revealed ? (
          <>
            <div className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Seed (published)</div>
            <p className="break-all font-mono text-sm">{revealed}</p>
          </>
        ) : null}
        <p className="mt-3 text-sm text-slate-600">
          {teams.length} teams, {spread.cards} problem cards used, {spread.min === spread.max ? `${spread.max} teams per card` : `${spread.min}–${spread.max} teams per card`}
          {crises.length ? `; crisis types: ${crises.map((c) => `#${c.number} ×${c.companies}`).join(", ")}` : ""}.
        </p>
      </Panel>

      <Panel
        title="Independent check"
        actions={
          crisisAt ? (
            <a href={`/admin/${slug}/lottery/record`} download={recordFileName(slug)} className="text-sm font-semibold text-slate-900 underline">
              Download the lottery record (JSON)
            </a>
          ) : null
        }
      >
        <p className="text-sm text-slate-600">
          The engine re-does the draw here from the seed, the dice, the team codes and the card numbers, and compares it with what the database stored
          {check.scope === "all" ? ": problem cards, crisis cards and the rescue circle." : ": the problem cards (the crisis draw comes at 23:45)."}
        </p>
        <div className="mt-3">
          {check.problems.length === 0 ? (
            <Notice tone="green">
              <strong>Draw verified.</strong> Every one of the {teams.length} teams&apos;{" "}
              {check.scope === "all" ? "problem card, crisis card and rescue" : "problem card"} is exactly what the seed and the dice produce.
            </Notice>
          ) : (
            <Notice tone="red">
              <strong>The stored draw differs from the engine&apos;s ({check.problems.length}):</strong>
              <ul className="mt-1 list-disc pl-5">
                {check.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
        {crisisAt ? (
          <p className="mt-3 text-xs text-slate-500">
            The record is public from 23:45 (teams can download it too). Anyone can check it with{" "}
            <code className="font-mono">pnpm verify-lottery --file {recordFileName(slug)} --commitment &lt;published commitment&gt;</code>.
          </p>
        ) : null}
      </Panel>

      <Panel title="Teams">
        <Table head={["Team", "Company", "Problem card", "Crisis card", "Rescues", "Rescued by"]} empty="No teams.">
          {teams.map((t) => (
            <tr key={t.code}>
              <Td mono>{t.code}</Td>
              <Td>{t.ticker ? <span><span className="font-mono">{t.ticker}</span> {t.name}</span> : <span className="text-slate-400">Not named yet</span>}</Td>
              <Td>{t.problem ? <span><span className="font-mono">#{t.problem.number}</span> {t.problem.title}</span> : "—"}</Td>
              <Td>{t.crisis ? <span><span className="font-mono">#{t.crisis.number}</span> {t.crisis.category}</span> : "—"}</Td>
              <Td mono>{t.rescues ?? "—"}</Td>
              <Td mono>{t.rescuedBy ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
