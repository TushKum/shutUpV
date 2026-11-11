"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { TeamSection } from "@/lib/team/sections";
import { SECTION_ICONS } from "@/lib/team/focus";

// This round's sections only (focus mode), as big buttons with an icon. On a phone the row scrolls sideways and keeps
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
    <nav ref={nav} className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 py-2" aria-label="Sections">
      {sections.map((s) => {
        const href = `/team${s.path}`;
        const active = s.path === "" ? pathname === "/team" : pathname.startsWith(href);
        return (
          <Link
            key={s.path}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-bold transition ${
              active ? "bg-slate-900 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <span aria-hidden>{SECTION_ICONS[s.path] ?? "•"}</span>
            <span>{s.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
