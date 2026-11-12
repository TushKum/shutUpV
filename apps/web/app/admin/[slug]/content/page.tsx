import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent } from "@/lib/admin/event";
import { CSV_FORMATS, MAX_CSV_BYTES, contentLocks, minProblemCards, type CsvKind } from "@/lib/admin/content";
import { supabaseServer } from "@/lib/supabase/server";
import { clock } from "@/lib/format";
import { Badge, Notice, Panel, Table, Td, inputClass } from "@/components/ui/ui";
import { ActionForm } from "@/components/ui/action";
import { prepareFlashBulletin, uploadCrisisDeck, uploadProblemDeck, uploadStatements } from "./actions";
import type { ActionResult } from "@/lib/rpc";

export const metadata: Metadata = { title: "Content" };

const short = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Content: the problem deck, the crisis deck and the flash bulletin, uploaded as CSV. Both decks lock at the draw
// (from then on organisers know the seed); the flash bulletin when it is published at 04:00.
export default async function ContentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const organiser = viewer!.role === "ORGANISER";
  const sb = await supabaseServer();
  const [problems, crises, flashes, products, statements, picks] = await Promise.all([
    sb.from("problem_cards").select("number, sector, title, body").eq("event_id", event.id).order("number").limit(1000),
    sb.from("crisis_cards").select("sector, category, number, title, body").eq("event_id", event.id).order("sector").order("number").order("category").limit(1000),
    sb.from("bulletins").select("title, body, published_at, created_at").eq("event_id", event.id).eq("kind", "FLASH").order("created_at", { ascending: false }),
    sb.from("teams").select("id", { count: "exact", head: true }).eq("event_id", event.id).eq("track", "PRODUCT"),
    sb.from("problem_statements").select("number, title, body, cap, sector").eq("event_id", event.id).order("number"),
    // The statements can be replaced until the first company has picked one.
    sb.from("draft_picks").select("company_id", { count: "exact", head: true }).eq("event_id", event.id).not("statement_id", "is", null),
  ]);
  for (const r of [problems, crises, flashes, products, statements, picks]) if (r.error) throw new Error(`Could not read the content: ${r.error.message}`);
  const flash = (flashes.data ?? []).find((b) => b.published_at) ?? flashes.data?.[0] ?? null;
  const locks = contentLocks({ drawnAt: event.drawn_at, flashPublishedAt: flash?.published_at ?? null });
  const needed = minProblemCards(products.count ?? 0);
  const problemRows = problems.data ?? [];
  const crisisRows = crises.data ?? [];
  const categories = new Set(crisisRows.map((c) => c.category)).size;
  const statementLock = (picks.count ?? 0) > 0 ? "A company has picked in the Round 3 draft: the statements can no longer change." : null;

  return (
    <div className="space-y-6">
      {!organiser ? <Notice>The fairness officer can read the content here; only organisers upload it.</Notice> : null}

      <Panel title="Problem deck" actions={<LockBadge lock={locks.problem} />}>
        <Summary>
          {problemRows.length} {problemRows.length === 1 ? "card: every squad plays this same case (nothing to pick)." : "cards."} Upload exactly
          one card to give every squad the same case, or 2 to 6 cards (one per sector) to split the squads equally between the sectors by lottery.
          Otherwise the draw deals 3 distinct cards to each squad and uses no card more than 3 times, so the deck needs at least {needed} (squads + 2).
        </Summary>
        <Upload kind="problem" lock={locks.problem} organiser={organiser} action={uploadProblemDeck.bind(null, event.id)} label="Upload the problem deck" />
        <Table head={["#", "Sector", "Title", "Body"]} empty="No problem cards yet." className="mt-4">
          {problemRows.map((c) => (
            <tr key={c.number}>
              <Td mono>{c.number}</Td>
              <Td>{c.sector}</Td>
              <Td>{c.title}</Td>
              <Td className="text-paper">
                <span title={c.body}>{short(c.body)}</span>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Crisis deck" actions={<LockBadge lock={locks.crisis} />}>
        <Summary>
          {crisisRows.length} cards in {categories} categories. With a sector on a card, every company of that sector gets it in the crisis its
          number names (1 to 4). Cards without a sector are dealt round the categories by the lottery (10 categories × 5 companies for 50 squads).
        </Summary>
        <Upload kind="crisis" lock={locks.crisis} organiser={organiser} action={uploadCrisisDeck.bind(null, event.id)} label="Upload the crisis deck" />
        <Table head={["Sector", "Category", "#", "Title", "Body"]} empty="No crisis cards yet." className="mt-4">
          {crisisRows.map((c) => (
            <tr key={`${c.sector ?? ""}${c.category}#${c.number}`}>
              <Td>{c.sector ?? "—"}</Td>
              <Td>{c.category}</Td>
              <Td mono>{c.number}</Td>
              <Td>{c.title}</Td>
              <Td className="text-paper">
                <span title={c.body}>{short(c.body)}</span>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      {event.format === "PRIMUS" ? (
        <Panel title="Round 3 problem statements" actions={<LockBadge lock={statementLock} />}>
          <Summary>
            {(statements.data ?? []).length} statements. At the start of Round 3 the Product teams pick one each, lowest score so far first, 20 seconds a
            pick; each statement takes at most its cap of companies (5 if left empty), and together they must have room for every company. The draft
            starts with Round 3, or the moment they are uploaded if Round 3 has already started. They lock at the first pick. With a sector on each
            statement, a company drafts only its own sector&apos;s statements, and each sector needs room for its companies.
          </Summary>
          <Upload kind="statements" lock={statementLock} organiser={organiser} action={uploadStatements.bind(null, event.id)} label="Upload the statements" />
          <Table head={["#", "Sector", "Title", "Cap", "Body"]} empty="No problem statements yet." className="mt-4">
            {(statements.data ?? []).map((st) => (
              <tr key={st.number}>
                <Td mono>{st.number}</Td>
                <Td>{st.sector ?? "—"}</Td>
                <Td>{st.title}</Td>
                <Td mono>{st.cap}</Td>
                <Td className="text-paper">
                  <span title={st.body}>{short(st.body)}</span>
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : null}

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
            <div className="rounded-md bg-raised px-3 py-2 text-sm">
              {flash.published_at ? (
                <Badge tone="green">Published {clock(flash.published_at, true)}</Badge>
              ) : (
                <Badge tone="violet">Prepared {clock(flash.created_at)}, not published</Badge>
              )}
              <p className="mt-1 font-semibold text-phosphor">{flash.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-paper">{flash.body}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">No flash bulletin prepared yet.</p>
          )}
        </div>
      </Panel>
    </div>
  );
}

function Summary({ children }: { children: ReactNode }) {
  return <p className="text-sm text-paper">{children}</p>;
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
    <div className="mt-3 rounded-md border border-line p-3">
      <p className="text-sm">
        <span className="font-medium text-paper">Expected columns: </span>
        <code className="font-mono">{format.columns.join(",")}</code>
        <span className="text-muted">
          {" "}
          (a header row, then {kind === "flash" ? "exactly one row" : kind === "statements" ? "one row per statement" : "one row per card"}; {format.optional.length ? `${format.optional.join(", ")} may be left out; ` : ""}
          quote a field that contains a comma or a line break)
        </span>
      </p>
      {lock ? (
        <p className="mt-2 text-sm text-paper">{lock}</p>
      ) : organiser ? (
        <ActionForm action={action} submit={label} className="mt-2" maxFileBytes={MAX_CSV_BYTES} resetOnSuccess>
          <label className="block max-w-md">
            <span className="text-xs font-medium text-paper">CSV file (up to {MAX_CSV_BYTES / 1024} KB)</span>
            <input name="file" type="file" accept=".csv,text/csv" required className={inputClass} />
          </label>
        </ActionForm>
      ) : null}
    </div>
  );
}
