// GET /admin/<slug>/exports/<kind> — a CSV download (ledger, prices, scores or results) for organisers and the
// fairness officer. The admin layout does not run for a route handler, so the role is checked here (401 signed out,
// 403 for any other role); RLS also limits every table read to what the signed-in account may see.

import { getViewer } from "@/lib/auth/viewer";
import { EXPORT_KINDS, exportFileName, isExportKind } from "@/lib/admin/export";
import { buildExport } from "@/lib/admin/export-data";
import { supabaseServer } from "@/lib/supabase/server";

function reply(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug, kind } = await params;
  const sb = await supabaseServer();
  const viewer = await getViewer(sb);
  if (!viewer) return reply(401, "Sign in to download exports.");
  if (viewer.role !== "ORGANISER" && viewer.role !== "FAIRNESS") {
    return reply(403, "Only organisers and the fairness officer can download exports.");
  }
  if (!isExportKind(kind)) return reply(404, `No such export: choose ${EXPORT_KINDS.join(", ")}.`);
  const { data: event, error } = await sb.from("events").select("id, slug").eq("slug", slug).maybeSingle<{ id: string; slug: string }>();
  if (error) return reply(500, `Could not read the event: ${error.message}`);
  if (!event) return reply(404, "No such event.");
  let csv: string;
  try {
    csv = await buildExport(sb, event.id, kind);
  } catch (e) {
    return reply(500, e instanceof Error ? e.message : "The export failed.");
  }
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8; header=present",
      "Content-Disposition": `attachment; filename="${exportFileName(event.slug, kind)}"`,
      "Cache-Control": "no-store",
    },
  });
}
