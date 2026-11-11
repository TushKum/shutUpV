"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { TeamSection } from "@/lib/team/sections";
import { SECTION_ICONS } from "@/lib/team/focus";
import { Glyph } from "@/components/ui/matrix/glyph";

// This round's sections only (focus mode), as a terminal's function-key row (F1, F2…). On a phone the row scrolls sideways and keeps
// the current button in view (only the row scrolls, never the page).
export function TeamNav({ sections }: { sections: readonly TeamSection[] }) {
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const row = nav.current;
    const tab = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !tab) return;
    const r = row.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (t.left < r.left || t.right > r.right) row.scrollLeft += t.left - r.left - (r.width - t.width) / 2;
  }, [pathname]);
  return (
    <nav ref={nav} className="mx-auto flex max-w-5xl gap-px overflow-x-auto bg-line" aria-label="Sections">
      {sections.map((s, i) => {
        const href = `/team${s.path}`;
        const active = s.path === "" ? pathname === "/team" : pathname.startsWith(href);
        return (
          <Link
            key={s.path}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap px-2.5 py-2 text-xs font-semibold uppercase tracking-wide ${
              active ? "bg-[var(--term-amber)] text-black" : "bg-ink text-paper hover:bg-raised hover:text-[var(--term-amber)]"
            }`}
          >
            {/* A key number, like the function keys of a trading terminal. */}
            <span className={`px-1 text-[10px] ${active ? "bg-black text-[var(--term-amber)]" : "bg-raised text-muted"}`} aria-hidden>
              F{i + 1}
            </span>
            <span aria-hidden>
              <Glyph e={SECTION_ICONS[s.path] ?? "•"} />
            </span>
            <span>{s.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
