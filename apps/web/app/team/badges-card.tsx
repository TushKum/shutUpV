import type { Badge } from "@/lib/team/badges";
import { Glyph } from "@/components/ui/matrix";

// The team's badges on Home: earned ones lit up, the rest dimmed with how to earn them. Badges are just for fun:
// nothing in the game depends on them.
export function BadgesCard({ badges }: { badges: Badge[] }) {
  const earned = badges.filter((b) => b.earned).length;
  return (
    <section className="mx-panel p-5 sm:p-6" aria-label="Badges" data-testid="badges">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-3">
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-white">
          <span className="text-amber-300" aria-hidden>
            <Glyph e="🏅" />
          </span>
          Badges
        </h2>
        <p className="font-mono text-xs text-slate-400" data-testid="badges-count">
          {earned} of {badges.length} earned
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" aria-label="Your badges">
        {badges.map((b) => (
          <li
            key={b.key}
            data-testid={`badge-${b.key}`}
            data-earned={b.earned}
            className={`flex items-start gap-2.5 rounded-2xl border p-3 transition ${
              b.earned
                ? "border-[#46f097]/45 bg-[#46f097]/10 shadow-[inset_0_1px_0_rgba(167,255,210,0.28),0_10px_28px_rgba(24,206,114,0.14)]"
                : "border-white/10 bg-white/[0.03] opacity-60"
            }`}
          >
            <span className={`text-2xl ${b.earned ? "text-[#46f097]" : "text-slate-400"}`} aria-hidden>
              <Glyph e={b.icon} />
            </span>
            <span className="min-w-0">
              <span className={`block text-sm font-semibold ${b.earned ? "text-white" : "text-slate-200"}`}>
                {b.name}
                <span className="sr-only">{b.earned ? " (earned)" : " (not earned yet)"}</span>
              </span>
              <span className={`block text-xs ${b.earned ? "text-[#46f097]" : "text-slate-400"}`}>{b.earned ? "Earned!" : b.how}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
