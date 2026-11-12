"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { TeamSection } from "@/lib/team/sections";
import { SECTION_ICONS } from "@/lib/team/focus";
import { Glyph } from "@/components/ui/matrix/glyph";

// This round's sections only (focus mode), as a row of tabs: first the pages where the team does its work, then, after
// a divider and a little smaller, the pages to look things up (market, Q&A, bulletins…). On a phone the row scrolls
// sideways and keeps the current tab in view (only the row scrolls, never the page).
const LOOK_UP = new Set(["/market", "/qa", "/ledger", "/bulletins", "/judging"]);
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
    <nav ref={nav} className="mx-auto flex max-w-5xl items-stretch gap-px overflow-x-auto bg-line" aria-label="Sections">
      {sections.map((s, i) => {
        const href = `/team${s.path}`;
        const active = s.path === "" ? pathname === "/team" : pathname.startsWith(href);
        const lookUp = LOOK_UP.has(s.path);
        const firstLookUp = lookUp && i > 0 && !LOOK_UP.has(sections[i - 1]!.path);
        return (
          <Link
            key={s.path}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 font-semibold tracking-wide ${lookUp ? "text-xs" : "text-sm"} ${
              firstLookUp ? "ml-2" : ""
            } ${
              active
                ? "bg-[var(--term-amber)] text-black"
                : lookUp
                  ? "bg-ink text-muted hover:bg-raised hover:text-[var(--term-amber)]"
                  : "bg-ink text-paper hover:bg-raised hover:text-[var(--term-amber)]"
            }`}
          >
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
