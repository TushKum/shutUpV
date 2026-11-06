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
import { setTwist, uploadCrisisDeck, uploadProblemDeck, uploadTwist } from "./actions";
import type { ActionResult } from "@/lib/rpc";

export const metadata: Metadata = { title: "Content" };

const short = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Content: the problem deck and the crisis deck (uploaded as CSV) and the twist (typed in or uploaded). Both decks lock
// at the draw (from then on organisers know the seed); the twist when it is published at 22:15.
export default async function ContentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const organiser = viewer!.role === "ORGANISER";
  const sb = await supabaseServer();
  const [problems, crises, twists, teams] = await Promise.all([
    sb.from("problem_cards").select("number, sector, title, body").eq("event_id", event.id).order("number").limit(1000),
    sb.from("crisis_cards").select("category, number, title, body").eq("event_id", event.id).order("number").limit(1000),
    sb.from("bulletins").select("title, body, published_at, created_at").eq("event_id", event.id).eq("kind", "TWIST").limit(1),
    sb.from("teams").select("id", { count: "exact", head: true }).eq("event_id", event.id),
  ]);
  for (const r of [problems, crises, twists, teams]) if (r.error) throw new Error(`Could not read the content: ${r.error.message}`);
  const twist = twists.data?.[0] ?? null;
  const locks = contentLocks({ drawnAt: event.drawn_at, twistPublishedAt: twist?.published_at ?? null });
  const teamCount = teams.count ?? 0;
  const needed = minProblemCards(teamCount);
  const problemRows = problems.data ?? [];
  const crisisRows = crises.data ?? [];
  const perCrisis = crisisRows.length ? Math.floor(teamCount / crisisRows.length) : 0;
  const crisisEven = crisisRows.length > 0 && teamCount % crisisRows.length === 0;

  return (
    <div className="space-y-6">
      {!organiser ? <Notice>The fairness officer can read the content here; only organisers upload it.</Notice> : null}

      <Panel title="Problem deck" actions={<LockBadge lock={locks.problem} />}>
        <Summary>
          {problemRows.length} cards. At 21:15 the draw deals one card to each of the {teamCount} teams and gives no card to more than 3 teams,
          so the deck needs at least {needed} cards.
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
          {crisisRows.length} cards, one per crisis type. At 23:45 the companies are dealt round the deck, so every type goes to the same number of
          companies{crisisRows.length ? (crisisEven ? ` (${perCrisis} each)` : ` (${perCrisis} or ${perCrisis + 1} each)`) : ""}. The guide has 10 types × 15
          companies.
        </Summary>
        <Upload kind="crisis" lock={locks.crisis} organiser={organiser} action={uploadCrisisDeck.bind(null, event.id)} label="Upload the crisis deck" />
        {crisisRows.length > 0 && crisisRows.length !== 10 ? (
          <div className="mt-3">
            <Notice tone="amber">The guide has 10 crisis types; this deck has {crisisRows.length}.</Notice>
          </div>
        ) : null}
        <Table head={["#", "Type", "Title", "Body"]} empty="No crisis cards yet." className="mt-4">
          {crisisRows.map((c) => (
            <tr key={c.number}>
              <Td mono>{c.number}</Td>
              <Td>{c.category}</Td>
              <Td>{c.title}</Td>
              <Td className="text-slate-600">
                <span title={c.body}>{short(c.body)}</span>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="The twist" actions={<LockBadge lock={locks.twist} />}>
        <Summary>
          Shown to every team at the same moment at 22:15, as a takeover on every screen; PRDs are expected to deal with it. Hidden from teams and the big
          screen until then. The phase clock publishes it at 22:15 (or publish it by hand under{" "}
          <Link href={`/admin/${slug}/bulletins`} className="underline">
            Bulletins
          </Link>
          ).
        </Summary>
        <div className="mt-4" data-testid="twist">
          {twist ? (
            <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
              {twist.published_at ? <Badge tone="green">Published {clock(twist.published_at, true)}</Badge> : <Badge tone="violet">Written, not published</Badge>}
              <p className="mt-1 font-semibold text-slate-900">{twist.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-slate-700">{twist.body}</p>
            </div>
          ) : (
            <Notice tone="amber">No twist written yet. The event cannot leave Setup without one.</Notice>
          )}
        </div>
        {locks.twist ? (
          <p className="mt-3 text-sm text-slate-600">{locks.twist}</p>
        ) : organiser ? (
          <>
            <ActionForm action={setTwist.bind(null, event.id)} submit={twist ? "Replace the twist" : "Save the twist"} className="mt-4 grid max-w-2xl gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Title (up to 140 characters)</span>
                <input name="title" required maxLength={140} defaultValue={twist?.title ?? ""} className={inputClass} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">What the twist says</span>
                <textarea name="body" required rows={4} maxLength={4000} defaultValue={twist?.body ?? ""} className={inputClass} />
              </label>
            </ActionForm>
            <Upload kind="twist" lock={null} organiser={organiser} action={uploadTwist.bind(null, event.id)} label="Or upload it as CSV" />
          </>
        ) : null}
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
          (a header row, then {kind === "twist" ? "exactly one row" : "one row per card"}; {format.optional.length ? `${format.optional.join(", ")} may be left out; ` : ""}
          quote a field that contains a comma or a line break)
        </span>
      </p>
      {lock ? (
        <p className="mt-2 text-sm text-slate-600">{lock}</p>
      ) : organiser ? (
        <ActionForm action={action} submit={label} className="mt-2" maxFileBytes={MAX_CSV_BYTES} resetOnSuccess>
          <label className="block max-w-md">
            <span className="text-xs font-medium text-slate-600">CSV file (up to {MAX_CSV_BYTES / 1024} KB)</span>
            <input name="file" type="file" accept=".csv,text/csv" required className={inputClass} />
          </label>
        </ActionForm>
      ) : null}
    </div>
  );
}
