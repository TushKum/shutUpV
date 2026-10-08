// GET /admin/<slug>/lottery/record — the lottery record JSON that `pnpm verify-lottery` checks. It contains the
// secret seed, so only organisers and the fairness officer may download it (the admin layout does not run for a
// route handler, so the role is checked here; RLS also keeps event_secrets to staff).

import { getViewer } from "@/lib/auth/viewer";
import { buildLotteryRecord, recordFileName } from "@/lib/admin/lottery";
import { loadLotteryEvent, loadLotteryRows } from "@/lib/admin/lottery-data";
import { supabaseServer } from "@/lib/supabase/server";

function reply(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await supabaseServer();
  const viewer = await getViewer(sb);
  if (!viewer) return reply(401, "Sign in to download the lottery record.");
  if (viewer.role !== "ORGANISER" && viewer.role !== "FAIRNESS") {
    return reply(403, "Only organisers and the fairness officer can download the lottery record (it contains the secret seed).");
  }
  const event = await loadLotteryEvent(sb, slug);
  if (!event) return reply(404, "No such event.");
  const rows = await loadLotteryRows(sb, event);
  if (!rows) return reply(409, "The lottery has not been drawn yet.");
  return new Response(`${JSON.stringify(buildLotteryRecord(rows), null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${recordFileName(event.slug)}"`,
      "Cache-Control": "no-store",
    },
  });
}
