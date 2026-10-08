import Link from "next/link";
import type { ReactNode } from "react";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent } from "@/lib/admin/event";
import { CSV_FORMATS, MAX_CSV_BYTES, contentLocks, minProblemCards, type CsvKind } from "@/lib/admin/content";
import { supabaseServer } from "@/lib/supabase/server";
import { clock } from "@/lib/format";
import { Badge, Notice, Panel, Table, Td, inputClass } from "@/components/ui/ui";
import { ActionForm } from "@/components/ui/action";
import { prepareFlashBulletin, uploadCrisisDeck, uploadProblemDeck } from "./actions";
import type { ActionResult } from "@/lib/rpc";

const short = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Content: the problem deck, the crisis deck and the flash bulletin, uploaded as CSV. Both decks lock at the draw
// (from then on organisers know the seed); the flash bulletin when it is published at 04:00.
export default async function ContentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const organiser = viewer!.role === "ORGANISER";
  const sb = await supabaseServer();
  const [problems, crises, flashes, products] = await Promise.all([
    sb.from("problem_cards").select("number, sector, title, body").eq("event_id", event.id).order("number").limit(1000),
    sb.from("crisis_cards").select("category, number, title, body").eq("event_id", event.id).order("category").order("number").limit(1000),
    sb.from("bulletins").select("title, body, published_at, created_at").eq("event_id", event.id).eq("kind", "FLASH").order("created_at", { ascending: false }),
    sb.from("teams").select("id", { count: "exact", head: true }).eq("event_id", event.id).eq("track", "PRODUCT"),
  ]);
  for (const r of [problems, crises, flashes, products]) if (r.error) throw new Error(`Could not read the content: ${r.error.message}`);
  const flash = (flashes.data ?? []).find((b) => b.published_at) ?? flashes.data?.[0] ?? null;
  const locks = contentLocks({ drawnAt: event.drawn_at, flashPublishedAt: flash?.published_at ?? null });
  const needed = minProblemCards(products.count ?? 0);
  const problemRows = problems.data ?? [];
  const crisisRows = crises.data ?? [];
  const categories = new Set(crisisRows.map((c) => c.category)).size;

  return (
    <div className="space-y-6">
      {!organiser ? <Notice>The fairness officer can read the content here; only organisers upload it.</Notice> : null}

      <Panel title="Problem deck" actions={<LockBadge lock={locks.problem} />}>
        <Summary>
          {problemRows.length} cards. The draw deals 3 distinct cards to each squad and uses no card more than 3 times, so the deck needs at least{" "}
          {needed} (squads + 2).
        </Summary>
        <Upload kind="problem" lock={locks.problem} organiser={organiser} action={uploadProblemDeck.bind(null, event.id)} label="Upload the problem deck" />
        <Table head={["#", "Sector", "Title", "Body"]} empty="No problem cards yet." className="mt-4">
          {problemRows.map((c) => (
            <tr key={c.number}>
              <Td mono>{c.number}</Td>
              <Td>{c.sector}</Td>
              <Td>{c.title}</Td>
              <Td className="text-slate-600">
                <span title={c.body}>{short(c.body)}</span>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Crisis deck" actions={<LockBadge lock={locks.crisis} />}>
        <Summary>
          {crisisRows.length} cards in {categories} categories. At 00:30 the companies are dealt round the categories (10 categories × 5 companies
          for 50 squads); in a category with several cards, the same generator picks one for each company.
        </Summary>
        <Upload kind="crisis" lock={locks.crisis} organiser={organiser} action={uploadCrisisDeck.bind(null, event.id)} label="Upload the crisis deck" />
        <Table head={["Category", "#", "Title", "Body"]} empty="No crisis cards yet." className="mt-4">
          {crisisRows.map((c) => (
            <tr key={`${c.category}#${c.number}`}>
              <Td>{c.category}</Td>
              <Td mono>{c.number}</Td>
              <Td>{c.title}</Td>
              <Td className="text-slate-600">
                <span title={c.body}>{short(c.body)}</span>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Flash bulletin" actions={<LockBadge lock={locks.flash} />}>
        <Summary>
          Prepared in advance and hidden from teams and the big screen until an organiser publishes it at 04:00 (
          <Link href={`/admin/${slug}/bulletins`} className="underline">
            Bulletins
          </Link>
          ). Uploading again replaces the prepared one.
        </Summary>
        <Upload kind="flash" lock={locks.flash} organiser={organiser} action={prepareFlashBulletin.bind(null, event.id)} label="Upload the flash bulletin" />
        <div className="mt-4" data-testid="flash-bulletin">
          {flash ? (
            <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
              {flash.published_at ? (
                <Badge tone="green">Published {clock(flash.published_at, true)}</Badge>
              ) : (
                <Badge tone="violet">Prepared {clock(flash.created_at)}, not published</Badge>
              )}
              <p className="mt-1 font-semibold text-slate-900">{flash.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-slate-700">{flash.body}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No flash bulletin prepared yet.</p>
          )}
        </div>
      </Panel>
    </div>
  );
}

function Summary({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-600">{children}</p>;
}

function LockBadge({ lock }: { lock: string | null }) {
  return lock ? <Badge tone="slate">Locked</Badge> : <Badge tone="green">Can be replaced</Badge>;
}

function Upload({
  kind,
  lock,
  organiser,
  action,
  label,
}: {
  kind: CsvKind;
  lock: string | null;
  organiser: boolean;
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  label: string;
}) {
  const format = CSV_FORMATS[kind];
  return (
    <div className="mt-3 rounded-md border border-slate-100 p-3">
      <p className="text-sm">
        <span className="font-medium text-slate-700">Expected columns: </span>
        <code className="font-mono">{format.columns.join(",")}</code>
        <span className="text-slate-500">
          {" "}
          (a header row, then {kind === "flash" ? "exactly one row" : "one row per card"}; {format.optional.length ? `${format.optional.join(", ")} may be left out; ` : ""}
          quote a field that contains a comma or a line break)
        </span>
      </p>
      {lock ? (
        <p className="mt-2 text-sm text-slate-600">{lock}</p>
      ) : organiser ? (
        <ActionForm action={action} submit={label} className="mt-2" resetOnSuccess>
          <label className="block max-w-md">
            <span className="text-xs font-medium text-slate-600">CSV file (up to {MAX_CSV_BYTES / 1024} KB)</span>
            <input name="file" type="file" accept=".csv,text/csv" required className={inputClass} />
          </label>
        </ActionForm>
      ) : null}
    </div>
  );
}
