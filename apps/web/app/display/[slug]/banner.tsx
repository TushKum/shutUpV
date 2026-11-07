// The bulletin banner: the latest published bulletin, under the header. The projector is the hall's only view of
// most bulletins, so the title and the body each get up to two lines (a title may be 140 characters); the board
// below takes whatever height is left. With no bulletin yet there is no banner.

import type { DisplayBulletin } from "@/lib/display/frame";
import { clock } from "@/lib/format";
import { BULLETIN_KIND_LABELS, type BulletinKind } from "@/lib/admin/content-bulletins";

const KIND: Record<string, string> = {
  TWIST: "bg-violet-400 text-black",
  CRISIS: "bg-red-600 text-white",
  RUMOUR: "bg-amber-400 text-black",
  FAIRNESS: "bg-sky-400 text-black",
  SYSTEM: "bg-slate-300 text-black",
  GENERAL: "bg-white text-black",
};

export function BulletinBanner({ bulletin }: { bulletin: DisplayBulletin | null }) {
  if (!bulletin) return null;
  return (
    <div className="flex max-h-[200px] min-h-[110px] shrink-0 items-center gap-6 border-b-4 border-white/20 bg-white/5 px-12 py-3" data-testid="display-bulletin">
      <span className={`shrink-0 rounded-lg px-4 py-1 text-[26px] font-black tracking-wide ${KIND[bulletin.kind] ?? KIND.GENERAL}`}>{BULLETIN_KIND_LABELS[bulletin.kind as BulletinKind] ?? bulletin.kind}</span>
      <span className="shrink-0 font-mono text-[30px] text-slate-300 tabular-nums">{clock(bulletin.published_at)}</span>
      <div className="min-w-0">
        <p className={`line-clamp-2 leading-tight font-bold ${bulletin.title.length > 70 ? "text-[34px]" : "text-[38px]"}`}>{bulletin.title}</p>
        {bulletin.body ? <p className="line-clamp-2 text-[26px] leading-snug text-slate-300">{bulletin.body}</p> : null}
        {bulletin.kind === "RUMOUR" ? <p className="text-[22px] text-amber-300">A rumour may or may not be true. Rumours never change a price.</p> : null}
      </div>
    </div>
  );
}
