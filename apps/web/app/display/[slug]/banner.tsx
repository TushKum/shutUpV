// The bulletin banner: the latest published bulletin, under the header.

import type { DisplayBulletin } from "@/lib/display/frame";
import { clock } from "@/lib/format";

const KIND: Record<string, string> = {
  CRISIS: "bg-red-600 text-white",
  FLASH: "bg-amber-400 text-black",
  FAIRNESS: "bg-sky-400 text-black",
  SYSTEM: "bg-slate-300 text-black",
  GENERAL: "bg-white text-black",
};

export function BulletinBanner({ bulletin }: { bulletin: DisplayBulletin | null }) {
  if (!bulletin) return <div className="h-[110px] shrink-0 border-b-4 border-white/20" data-testid="display-bulletin" />;
  return (
    <div className="flex h-[110px] shrink-0 items-center gap-6 border-b-4 border-white/20 bg-white/5 px-12" data-testid="display-bulletin">
      <span className={`shrink-0 rounded-lg px-4 py-1 text-[26px] font-black tracking-wide ${KIND[bulletin.kind] ?? KIND.GENERAL}`}>{bulletin.kind}</span>
      <span className="shrink-0 font-mono text-[30px] text-slate-300 tabular-nums">{clock(bulletin.published_at)}</span>
      <div className="min-w-0">
        <p className="truncate text-[38px] leading-tight font-bold">{bulletin.title}</p>
        {bulletin.body ? <p className="truncate text-[26px] leading-tight text-slate-300">{bulletin.body}</p> : null}
      </div>
    </div>
  );
}
