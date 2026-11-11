"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Track } from "@msim/engine";
import { TEAM_SECTIONS } from "@/lib/team/sections";

// The sections of this team's track. On a phone the row scrolls sideways and keeps the current tab in view (only the
// row scrolls, never the page).
export function TeamNav({ track }: { track: Track }) {
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
    <nav ref={nav} className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4" aria-label="Sections">
      {TEAM_SECTIONS[track].map((s) => {
        const href = `/team${s.path}`;
        const active = s.path === "" ? pathname === "/team" : pathname.startsWith(href);
        return (
          <Link
            key={s.path}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              active ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
