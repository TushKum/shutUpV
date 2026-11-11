// The bulletin banner: the latest published bulletin, under the header. The projector is the hall's only view of
// most bulletins, so the title and the body each get up to two lines (a title may be 140 characters); the board
// below takes whatever height is left. With no bulletin yet there is no banner.

import type { DisplayBulletin } from "@/lib/display/frame";
import { clock } from "@/lib/format";

const KIND: Record<string, string> = {
  CRISIS: "bg-danger text-ink",
  FLASH: "bg-warn text-ink",
  FAIRNESS: "bg-phosphor-mid text-ink",
  SYSTEM: "bg-phosphor-deep text-phosphor",
  GENERAL: "border-2 border-phosphor-dim text-phosphor",
};

export function BulletinBanner({ bulletin }: { bulletin: DisplayBulletin | null }) {
  if (!bulletin) return null;
  return (
    <div className="flex max-h-[200px] min-h-[110px] shrink-0 items-center gap-6 border-b-4 border-phosphor-dim bg-ink px-12 py-3" data-testid="display-bulletin">
      <span className={`shrink-0 rounded-lg px-4 py-1 text-[26px] font-black tracking-wide ${KIND[bulletin.kind] ?? KIND.GENERAL}`}>{bulletin.kind}</span>
      <span className="shrink-0 font-mono text-[30px] text-muted tabular-nums">{clock(bulletin.published_at)}</span>
      <div className="min-w-0">
        <p className={`line-clamp-2 leading-tight font-bold ${bulletin.title.length > 70 ? "text-[34px]" : "text-[38px]"}`}>{bulletin.title}</p>
        {bulletin.body ? <p className="line-clamp-2 text-[26px] leading-snug text-muted">{bulletin.body}</p> : null}
      </div>
    </div>
  );
}
