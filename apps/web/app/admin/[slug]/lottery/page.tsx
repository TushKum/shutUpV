import { PHASE_LABELS } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { loadLotteryEvent, loadLotteryRows } from "@/lib/admin/lottery-data";
import { buildLotteryRecord, checkDraw, recordFileName, squadViews, type SquadView } from "@/lib/admin/lottery";
import { supabaseServer } from "@/lib/supabase/server";
import { clock, dateTime } from "@/lib/format";
import { Badge, Notice, Panel, Stat, Table, Td, inputClass } from "@/components/ui/ui";
import { ActionForm } from "@/components/ui/action";
import { ConfirmForm } from "../content/confirm-form";
import { runLottery, setSeedCommitment } from "./actions";

// Lottery: the seed commitment (published the day before, fixed once the event starts), the 21:00 draw with the
// seed check, and the stored draw re-done independently by the engine.
export default async function LotteryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const sb = await supabaseServer();
  const [status, lotteryEvent] = await Promise.all([loadEventStatus(event.id), loadLotteryEvent(sb, slug)]);
  const organiser = viewer!.role === "ORGANISER";
  const drawn = !!event.drawn_at;
  const rows = lotteryEvent ? await loadLotteryRows(sb, lotteryEvent) : null;

  return (
    <div className="space-y-6">
      <CommitmentPanel eventId={event.id} commitment={event.seed_commitment} setup={status.phase === "SETUP" && !drawn} organiser={organiser} />
      {drawn && rows ? (
        <DrawnPanels slug={slug} rows={rows} drawnAt={event.drawn_at!} revealed={event.seed_revealed} />
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
        commitment). The seed itself stays secret until the crisis.
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

function DrawPanel({ eventId, phase, commitment, organiser }: { eventId: string; phase: string; commitment: string | null; organiser: boolean }) {
  const open = phase === "SQUAD_DRAW";
  return (
    <Panel title="Draw">
      {!open ? (
        <Notice tone="slate">
          The draw is entered in the Squad draw phase (21:00). The event is in {PHASE_LABELS[phase as keyof typeof PHASE_LABELS] ?? phase}.
        </Notice>
      ) : !commitment ? (
        <Notice tone="red">No seed commitment was published, so the draw cannot be verified.</Notice>
      ) : organiser ? (
        <>
          <p className="text-sm text-slate-600">
            Enter the secret seed and the dice roll. The database checks SHA-256(seed) against the published commitment before anything is drawn;
            a mismatch changes nothing.
          </p>
          <ConfirmForm
            action={runLottery.bind(null, eventId)}
            submit="Verify the seed and draw"
            confirm="Click again to draw the squads"
            className="mt-3 grid max-w-2xl gap-3"
          >
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

function DrawnPanels({ slug, rows, drawnAt, revealed }: { slug: string; rows: NonNullable<Awaited<ReturnType<typeof loadLotteryRows>>>; drawnAt: string; revealed: string | null }) {
  const record = buildLotteryRecord(rows);
  const check = checkDraw(record);
  const squads = squadViews(rows);
  return (
    <>
      <Panel title="Draw">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Dice" value={<span className="font-mono">{rows.dice}</span>} />
          <Stat label="Drawn at" value={clock(drawnAt, true)} hint={`${dateTime(drawnAt)} IST`} />
          <Stat
            label="Seed"
            value={check.seedMatches ? <Badge tone="green">Seed matches commitment</Badge> : <Badge tone="red">Seed does NOT match commitment</Badge>}
            hint={revealed ? "Revealed at the crisis" : "Secret until the crisis"}
          />
          <Stat label="Squads" value={squads.length} />
        </div>
        <div className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Commitment</div>
        <p className="break-all font-mono text-sm">{rows.commitment}</p>
        {revealed ? (
          <>
            <div className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Seed (revealed)</div>
            <p className="break-all font-mono text-sm">{revealed}</p>
          </>
        ) : null}
      </Panel>

      <Panel
        title="Independent check"
        actions={
          <a href={`/admin/${slug}/lottery/record`} download={recordFileName(slug)} className="text-sm font-semibold text-slate-900 underline">
            Download the lottery record (JSON)
          </a>
        }
      >
        <p className="text-sm text-slate-600">
          The engine&apos;s drawLottery re-does the draw here from the stored seed, the dice, the team codes of each track and the problem-card numbers,
          and compares it with what the database stored{record.crises ? ", including each company's crisis card" : ""}.
        </p>
        <div className="mt-3">
          {check.problems.length === 0 ? (
            <Notice tone="green">
              <strong>Draw verified.</strong> All {squads.length} squads, their dealt problem cards and the coverage
              {record.crises ? " and the crisis cards" : ""} are exactly what the seed and the dice produce.
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
        <p className="mt-3 text-xs text-slate-500">
          The record contains the secret seed (staff only until the crisis). Anyone can check it with{" "}
          <code className="font-mono">pnpm verify-lottery --file {recordFileName(slug)} --commitment &lt;published commitment&gt;</code>.
        </p>
      </Panel>

      <Panel title="Squads">
        <SquadTable squads={squads} />
      </Panel>
    </>
  );
}

function card(c: { number: number | null; title: string }) {
  return c.number === null ? "?" : `#${c.number}`;
}

function SquadTable({ squads }: { squads: SquadView[] }) {
  return (
    <Table head={["Squad", "Product", "Consulting", "Finance", "Dealt cards", "Chosen card", "Consultant covers"]} empty="No squads.">
      {squads.map((s) => (
        <tr key={s.number}>
          <Td mono>{s.number}</Td>
          <Td mono>{s.product}</Td>
          <Td mono>{s.consulting}</Td>
          <Td mono>{s.finance}</Td>
          <Td mono>
            <span title={s.dealt.map((c) => `${card(c)} ${c.title}`).join("\n")}>{s.dealt.map(card).join(" · ")}</span>
          </Td>
          <Td>
            {s.chosen ? (
              <span className="flex items-center gap-2">
                <span className="font-mono">{card(s.chosen)}</span>
                <span className="text-slate-600">{s.chosen.title}</span>
                {s.chosenByDefault ? <Badge tone="amber">Default</Badge> : <Badge tone="green">Picked</Badge>}
              </span>
            ) : (
              <span className="text-slate-500">Not picked yet</span>
            )}
          </Td>
          <Td mono>{s.covers.map((c) => (c.ticker ? `${c.product} (${c.ticker})` : c.product)).join(", ")}</Td>
        </tr>
      ))}
    </Table>
  );
}
