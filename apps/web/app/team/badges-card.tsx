import type { Badge } from "@/lib/team/badges";
import { Glyph } from "@/components/ui/matrix";

// The team's badges on Home: earned ones lit up, the rest dimmed with how to earn them. Badges are just for fun:
// nothing in the game depends on them.
export function BadgesCard({ badges }: { badges: Badge[] }) {
  const earned = badges.filter((b) => b.earned).length;
  return (
    <section className="mx-panel rounded-2xl p-4" aria-label="Badges" data-testid="badges">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-phosphor glow">
          <span aria-hidden>
            <Glyph e="🏅" />
          </span>
          Badges
        </h2>
        <p className="font-mono text-sm text-muted" data-testid="badges-count">
          {earned} of {badges.length} earned
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" aria-label="Your badges">
        {badges.map((b) => (
          <li
            key={b.key}
            data-testid={`badge-${b.key}`}
            data-earned={b.earned}
            className={`flex items-start gap-2 rounded-xl p-2.5 ring-1 ${b.earned ? "bg-panel ring-phosphor glow-box" : "ring-phosphor-dim opacity-60"}`}
          >
            <span className={`text-2xl ${b.earned ? "text-phosphor glow" : "text-muted"}`} aria-hidden>
              <Glyph e={b.icon} />
            </span>
            <span className="min-w-0">
              <span className={`block text-sm font-bold ${b.earned ? "text-phosphor" : "text-paper"}`}>
                {b.name}
                <span className="sr-only">{b.earned ? " (earned)" : " (not earned yet)"}</span>
              </span>
              <span className="block text-xs text-muted">{b.earned ? "Earned!" : b.how}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
