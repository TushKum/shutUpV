import type { Metadata } from "next";
import Link from "next/link";
import { DEADLINE_LABELS } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import {
  BODY_MAX,
  BULLETIN_KIND_LABELS,
  COMPOSER_KINDS,
  TITLE_MAX,
  flashState,
  sortBulletins,
  type BulletinKind,
  type BulletinRow,
} from "@/lib/admin/content-bulletins";
import { supabaseServer } from "@/lib/supabase/server";
import { clock, dateTime } from "@/lib/format";
import { Badge, Notice, Panel, inputClass, type Tone } from "@/components/ui/ui";
import { ActionButton, ConfirmForm } from "@/components/ui/action";
import { Countdown } from "@/components/ui/countdown";
import { publishBulletin, publishFlashBulletin } from "./actions";

export const metadata: Metadata = { title: "Bulletins" };

const KIND_TONES: Record<BulletinKind, Tone> = { GENERAL: "slate", CRISIS: "red", FLASH: "violet", FAIRNESS: "amber", SYSTEM: "blue" };

// Bulletins: compose and publish to every screen, every bulletin so far (drafts included), and the flash bulletin
// prepared under Content, published at 04:00.
export default async function BulletinsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const status = await loadEventStatus(event.id);
  const organiser = viewer!.role === "ORGANISER";
  const sb = await supabaseServer();
  const [bulletins, deadlines] = await Promise.all([
    sb.from("bulletins").select("id, kind, title, body, published_at, created_at").eq("event_id", event.id).limit(1000),
    sb.from("deadlines").select("code, at").eq("event_id", event.id).in("code", ["FLASH_BULLETIN", "FLASH"]),
  ]);
  if (bulletins.error) throw new Error(`Could not read the bulletins: ${bulletins.error.message}`);
  const rows = sortBulletins((bulletins.data ?? []) as BulletinRow[]);
  const flash = flashState(rows, status.phase);
  const due = (code: "FLASH_BULLETIN" | "FLASH") => (deadlines.data ?? []).find((d) => d.code === code)?.at as string | undefined;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-6 lg:col-span-2">
        {organiser ? (
          <Panel title="Compose">
            <ConfirmForm
              action={publishBulletin.bind(null, event.id)}
              submit="Publish bulletin"
              confirm="Click again to publish to every screen"
              className="grid gap-3"
              resetOnSuccess
            >
              <label className="block max-w-xs">
                <span className="text-xs font-medium text-slate-600">Kind</span>
                <select name="kind" defaultValue="GENERAL" className={inputClass}>
                  {COMPOSER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {BULLETIN_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Title (up to {TITLE_MAX} characters)</span>
                <input name="title" required maxLength={TITLE_MAX} autoComplete="off" className={inputClass} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Body (up to {BODY_MAX.toLocaleString("en-US")} characters)</span>
                <textarea name="body" rows={5} maxLength={BODY_MAX} className={inputClass} />
              </label>
              <p className="text-xs text-slate-500">
                A bulletin appears at once on every team screen and the big screen, and cannot be withdrawn. The flash bulletin is prepared under{" "}
                <Link href={`/admin/${slug}/content`} className="underline">
                  Content
                </Link>{" "}
                and published from the panel on the right.
              </p>
            </ConfirmForm>
          </Panel>
        ) : (
          <Notice>The fairness officer can read every bulletin here; only organisers publish.</Notice>
        )}

        <Panel title={`All bulletins (${rows.length})`}>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">No bulletins yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100" aria-label="Bulletins">
              {rows.map((b) => (
                <li key={b.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone={KIND_TONES[b.kind]}>{BULLETIN_KIND_LABELS[b.kind]}</Badge>
                    {b.published_at ? (
                      <span className="font-mono tabular-nums text-slate-600" title={`${dateTime(b.published_at)} IST`}>
                        {clock(b.published_at, true)}
                      </span>
                    ) : (
                      <Badge tone="amber">Draft, not published</Badge>
                    )}
                    <span className="font-semibold text-slate-900">{b.title}</span>
                  </div>
                  {b.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{b.body}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="min-w-0 space-y-6">
        <Panel title="Flash bulletin">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt>{DEADLINE_LABELS.FLASH_BULLETIN} due</dt>
              <dd className="font-mono tabular-nums">
                {clock(due("FLASH_BULLETIN"))} · <Countdown to={due("FLASH_BULLETIN")} passed="due now" />
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{DEADLINE_LABELS.FLASH} due</dt>
              <dd className="font-mono tabular-nums">{clock(due("FLASH"))}</dd>
            </div>
          </dl>
          <div className="mt-3" data-testid="flash-state">
            {!flash.bulletin ? (
              <Notice tone="amber">
                Not prepared yet. Upload it under{" "}
                <Link href={`/admin/${slug}/content`} className="underline">
                  Content
                </Link>
                .
              </Notice>
            ) : (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {flash.published ? (
                    <Badge tone="green">Published {clock(flash.bulletin.published_at, true)}</Badge>
                  ) : (
                    <Badge tone="violet">Prepared {clock(flash.bulletin.created_at)}, not published</Badge>
                  )}
                </div>
                <p className="mt-1 font-semibold text-slate-900">{flash.bulletin.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-slate-700">{flash.bulletin.body}</p>
              </div>
            )}
          </div>
          {organiser ? (
            <div className="mt-4">
              {/* Names the draft it publishes: a draft replaced between the two clicks asks again (and the database
                  refuses a stale one). Stays mounted once published, so its result stays visible. */}
              <ActionButton
                action={publishFlashBulletin.bind(null, event.id, flash.bulletin?.id ?? null)}
                confirm={flash.bulletin && !flash.published ? `Click again to publish “${flash.bulletin.title}”` : undefined}
                variant="primary"
                disabled={!!flash.blocked}
                title={flash.blocked ?? undefined}
              >
                Publish the flash bulletin
              </ActionButton>
              {flash.blocked ? <p className="mt-2 text-xs text-slate-500">{flash.blocked}</p> : null}
              <p className="mt-2 text-xs text-slate-500">Publishing opens the flash answers; it is done once, at 04:00.</p>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
