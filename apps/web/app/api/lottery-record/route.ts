// GET /api/lottery-record?event=<slug> — the public lottery record (the JSON `pnpm verify-lottery` checks), for anyone,
// signed in or not, once the seed has been revealed at the crisis draw (00:30). Before that the seed is secret and
// the answer is 404. The rows come from public.lottery_record_rows, which reads the stored draw on the server side
// and refuses until `seed_revealed` is set, so no service key is needed here. After the reveal the draw cannot
// change, so the answer may be cached for a minute.

import { buildLotteryRecord, recordFileName, type LotteryRows } from "@/lib/admin/lottery";
import { supabaseServer } from "@/lib/supabase/server";

const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;

function reply(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("event");
  if (!slug || !SLUG.test(slug)) return reply(400, "Say which event: ?event=<slug>.");
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("lottery_record_rows", { p_slug: slug });
  if (error) return reply(500, "Could not read the lottery record.");
  if (!data) return reply(404, "There is no lottery record for that event yet: it is published when the seed is revealed at the crisis draw.");
  return new Response(`${JSON.stringify(buildLotteryRecord(data as LotteryRows), null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `inline; filename="${recordFileName(slug)}"`,
      "Cache-Control": "public, max-age=60",
    },
  });
}
