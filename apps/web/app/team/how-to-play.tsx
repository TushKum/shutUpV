import type { Track } from "@msim/engine";
import { howToPlay } from "@/lib/team/how-to-play";
import { sectorStyle } from "@/lib/team/sectors";
import { Glyph } from "@/components/ui/matrix/glyph";

// "How to play" on Home: the whole night in three steps for this team's role, and how it wins. Open before the game
// starts, folded (one tap away) once it is under way.
export function HowToPlayCard({ track, format, open, sector }: { track: Track; format: "CLASSIC" | "PRIMUS"; open: boolean; sector: string | null }) {
  const h = howToPlay(track, format);
  const st = sector ? sectorStyle(sector) : null;
  return (
    <details open={open} className="group mx-panel rounded-2xl" data-testid="how-to-play">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3">
        <span className="text-2xl text-phosphor" aria-hidden>
          <Glyph e="🎮" />
        </span>
        <span className="flex-1">
          <span className="block text-lg font-extrabold text-phosphor">How to play</span>
          <span className="block text-sm text-paper">{h.role}</span>
        </span>
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">
          ▸
        </span>
      </summary>
      <div className="border-t border-line px-5 py-4">
        {sector && st ? (
          <p className={`mb-3 text-sm font-semibold ${st.text}`} data-testid="how-to-play-sector">
            <Glyph e={st.icon} /> Your sector is <strong>{sector}</strong>: your startup, your crises and your Round 3 problems all come from it.
          </p>
        ) : null}
        <ol className="grid gap-3 sm:grid-cols-3">
          {h.steps.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-line bg-ink p-3">
              <p className="flex items-center gap-2 font-bold text-phosphor">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-phosphor text-sm font-black text-ink">{i + 1}</span>
                <Glyph e={s.icon} />
                {s.title}
              </p>
              <p className="mt-1.5 text-sm text-paper">{s.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 rounded-lg border border-phosphor-dim px-3 py-2 text-sm font-semibold text-phosphor">
          <Glyph e="🏆" /> How you win: {h.win}
        </p>
      </div>
    </details>
  );
}
