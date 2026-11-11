import type { Metadata } from "next";
import Link from "next/link";
import { money } from "@/lib/format";
import { loadTeamContext } from "@/lib/team/context";
import { loadCrisisRoom } from "@/lib/team/crisis-data";
import { FIRM_CLIENTS_PER_SUBROUND, currentSubround, hiringOpen, subroundTitle } from "@/lib/team/crisis";
import { FIRM_SORTS, parseSort, profileCompleteness, searchFirms } from "@/lib/team/hire";
import { sectionAllowed } from "@/lib/team/sections";
import { pauseOf } from "@/lib/team/squad-data";
import { Badge, Notice, Panel, buttonClass, inputClass } from "@/components/ui/ui";

export const metadata: Metadata = { title: "Firms" };

// The Consulting firm directory: every firm of the event with its profile, value, clients and rating, searchable and
// sortable. A Product team opens a firm's profile to hire it; a firm sees the field it competes in.
export default async function FirmsPage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string }> }) {
  const ctx = await loadTeamContext();
  if (!sectionAllowed(ctx.team.track, "/firms")) return <Notice>This section is not part of your team&apos;s portal.</Notice>;
  const data = await loadCrisisRoom(ctx);
  if (data.format !== "PRIMUS") return <Notice>Tonight&apos;s event plays the classic format: there is no firm marketplace.</Notice>;
  const { q = "", sort: rawSort } = await searchParams;
  const sort = parseSort(rawSort);
  const query = q.slice(0, 80);
  const k = currentSubround(ctx.status.phase, data.subrounds);
  const nowMs = new Date(ctx.status.server_time).getTime();
  const hiring = hiringOpen(k, ctx.status.phase, data.deadlines, nowMs, pauseOf(ctx));
  const product = ctx.team.track === "PRODUCT";
  const mine = product ? data.companies.find((c) => c.product_team_id === ctx.team.id) ?? null : null;
  const hiredNow = k !== null && mine ? data.engagements.find((e) => e.company_id === mine.id && e.k === k) : undefined;
  const firms = searchFirms(data.firms, data.profiles, query, sort);

  return (
    <div className="space-y-6">
      <Panel title="Consulting firm directory">
        <p className="text-sm text-paper">
          {product
            ? "Every Consulting firm of tonight's event. Open a firm's profile to read its pitch, track record and client ratings, then send it an offer. Once a firm accepts, a private one-on-one chat with it opens under Hire chat."
            : "Every Consulting firm of tonight's event, as Product teams see it when they choose whom to hire. Edit your own profile in the Crisis room."}
        </p>
        {k !== null ? (
          <p className="mt-2 text-sm">
            <span className="text-[var(--term-amber)]">{subroundTitle(k)}</span>
            <span className="text-paper"> · hiring is {hiring ? "open" : "closed"}</span>
            {hiredNow ? (
              <span className="text-paper">
                {" "}· you hired <strong>{data.firms.find((f) => f.team_id === hiredNow.firm_team_id)?.code ?? "a firm"}</strong> this sub-round
              </span>
            ) : null}
          </p>
        ) : null}
        <form method="get" className="mt-3 flex flex-wrap items-end gap-2" role="search" aria-label="Search the firms">
          <label className="min-w-0 flex-1 text-sm">
            <span className="font-semibold text-paper">Search</span>
            <input name="q" defaultValue={query} placeholder="pricing, supply chain, C07…" className={`${inputClass} mt-1`} />
          </label>
          <label className="text-sm">
            <span className="font-semibold text-paper">Sort by</span>
            <select name="sort" defaultValue={sort} className={`${inputClass} mt-1`}>
              {FIRM_SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass.primary}>
            Search
          </button>
          {query || rawSort ? (
            <Link href="/team/firms" className={buttonClass.secondary}>
              Clear
            </Link>
          ) : null}
        </form>
      </Panel>

      {firms.length === 0 ? (
        <Notice>{data.firms.length === 0 ? "No Consulting firm in this event yet." : "No firm matches that search."}</Notice>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Firms">
          {firms.map((f) => {
            const p = data.profiles.get(f.team_id);
            const taken = k === null ? 0 : data.engagements.filter((e) => e.firm_team_id === f.team_id && e.k === k).length;
            const hiredByMe = mine ? data.engagements.some((e) => e.company_id === mine.id && e.firm_team_id === f.team_id) : false;
            const openOffer = mine && k !== null ? data.offers.some((o) => o.company_id === mine.id && o.firm_team_id === f.team_id && o.k === k && o.status === "OPEN") : false;
            const complete = profileCompleteness(p);
            return (
              <li key={f.team_id} className="flex flex-col border border-line bg-panel p-3" data-testid={`directory-${f.code}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-semibold text-[var(--term-amber)]">{f.code}</span>
                  <span className="text-paper">{f.name}</span>
                  {f.team_id === ctx.team.id ? <Badge tone="violet">You</Badge> : null}
                  {hiredByMe ? <Badge tone="green">Hired by you</Badge> : null}
                  {openOffer ? <Badge tone="amber">Offer open</Badge> : null}
                  {k !== null && taken >= FIRM_CLIENTS_PER_SUBROUND ? <Badge tone="red">Full this sub-round</Badge> : null}
                </div>
                <p className="mt-1 text-sm font-semibold text-paper">{p?.headline || <span className="font-normal text-muted">No headline yet.</span>}</p>
                {p?.specialities.length ? <p className="mt-1 text-xs text-[var(--term-cyan)]">{p.specialities.join(" · ")}</p> : null}
                {p?.about ? <p className="mt-1 line-clamp-2 text-xs text-muted">{p.about}</p> : null}
                <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <dt className="text-muted">Value</dt>
                    <dd className="font-mono text-[var(--term-green)]">{money(f.value_cents)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Asking</dt>
                    <dd className="font-mono text-paper">{p && p.asking_cents > 0 ? money(p.asking_cents) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Clients</dt>
                    <dd className="font-mono text-paper">{f.clients}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Rating</dt>
                    <dd className="font-mono text-paper">{f.avg_rating === null ? "—" : `★ ${f.avg_rating.toFixed(1)}`}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex items-center gap-2">
                  <Link href={`/team/firms/${encodeURIComponent(f.code)}`} className={buttonClass.primary}>
                    {product && hiring && !hiredNow && f.team_id !== ctx.team.id ? "View profile & hire" : "View profile"}
                  </Link>
                  <span className="ml-auto text-[11px] text-muted">Profile {complete}/5</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
