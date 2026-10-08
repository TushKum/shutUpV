import { loadAdminEvent } from "@/lib/admin/event";
import { EXPORT_KINDS, EXPORTS, exportFileName } from "@/lib/admin/export";
import { exportCounts } from "@/lib/admin/export-data";
import { supabaseServer } from "@/lib/supabase/server";
import { count } from "@/lib/format";
import { Panel } from "@/components/ui/ui";

// Exports: CSV downloads of the ledger, prices per round, scores and final results (for organisers and the
// fairness officer; the files are written by exports/[kind]/route.ts).
export default async function ExportsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await loadAdminEvent(slug);
  const counts = await exportCounts(await supabaseServer(), event.id);

  return (
    <div className="space-y-6">
      <Panel title="Exports">
        <p className="text-sm text-slate-600">
          CSV files (RFC 4180, UTF-8, one header row) of this event as it stands now. Money and prices are whole cents (12345 = $123.45), tiers and
          returns are basis points (500 = +5%), and times are IST (+05:30). A text cell that starts with = + - @ is written with a leading &apos;
          so a spreadsheet shows it rather than running it as a formula.
        </p>
        <ul className="mt-4 divide-y divide-slate-100">
          {EXPORT_KINDS.map((kind) => {
            const n = counts[kind];
            return (
              <li key={kind} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="max-w-3xl">
                  <h3 className="text-sm font-semibold text-slate-900">{EXPORTS[kind].title}</h3>
                  <p className="text-sm text-slate-600">{EXPORTS[kind].description}</p>
                  <p className="mt-0.5 text-xs text-slate-500" data-testid={`rows-${kind}`}>
                    {n === null ? "Row count unavailable." : `${count(n)} row${n === 1 ? "" : "s"} now.`}
                  </p>
                </div>
                <a
                  href={`/admin/${slug}/exports/${kind}`}
                  download={exportFileName(slug, kind)}
                  className="whitespace-nowrap rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
                >
                  Download {exportFileName(slug, kind)}
                </a>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
