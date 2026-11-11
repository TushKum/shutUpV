import { BULLETIN_KIND_LABELS, type BulletinKind } from "@/lib/admin/content-bulletins";
import { clock, dateTime } from "@/lib/format";
import { Badge, type Tone } from "@/components/ui/ui";

export interface PublishedBulletin {
  id: string;
  kind: string;
  title: string;
  body: string;
  published_at: string;
}

const TONES: Record<BulletinKind, Tone> = { GENERAL: "slate", CRISIS: "red", FLASH: "violet", FAIRNESS: "amber", SYSTEM: "blue" };

// FLASH and CRISIS bulletins move prices: they stand out with a coloured band.
const FRAMES: Partial<Record<BulletinKind, string>> = {
  CRISIS: "border-l-4 border-danger/70 bg-danger/10 pl-3",
  FLASH: "border-l-4 border-phosphor-dim bg-phosphor-deep/40 pl-3",
};

const kindOf = (k: string): BulletinKind => (k in BULLETIN_KIND_LABELS ? (k as BulletinKind) : "GENERAL");

/** One published bulletin: its kind, when it was published (IST), the title and the body. */
export function BulletinItem({ b, clamp = false }: { b: PublishedBulletin; clamp?: boolean }) {
  const kind = kindOf(b.kind);
  return (
    <article className={`rounded-md py-2 pr-2 ${FRAMES[kind] ?? ""}`} data-kind={kind} aria-label={`${BULLETIN_KIND_LABELS[kind]} bulletin: ${b.title}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={TONES[kind]}>{BULLETIN_KIND_LABELS[kind]}</Badge>
        <time dateTime={b.published_at} title={`${dateTime(b.published_at)} IST`} className="font-mono text-xs tabular-nums text-muted">
          {clock(b.published_at, true)}
        </time>
      </div>
      <h3 className="mt-1 font-semibold text-phosphor">{b.title}</h3>
      {b.body ? <p className={`mt-1 whitespace-pre-wrap text-sm text-paper ${clamp ? "line-clamp-3" : ""}`}>{b.body}</p> : null}
    </article>
  );
}
