"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { TeamSection } from "@/lib/team/sections";
import { SECTION_ICONS } from "@/lib/team/focus";
import { Glyph } from "@/components/ui/matrix/glyph";

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
    <nav ref={nav} className="mx-team-command-nav" aria-label="Competition workspace">
      <div className="mx-team-command-brand">
        <span className="mx-team-command-mark">P</span>
        <span><strong>PRIMUS</strong><small>COMMAND CENTRE</small></span>
      </div>
      <div className="mx-team-command-links">
        <p className="mx-team-command-label">WORKSPACE</p>
        {sections.filter(s => !LOOK_UP.has(s.path)).map(s => {
          const href = `/team${s.path}`;
          const active = s.path === "" ? pathname === "/team" : pathname.startsWith(href);
          return <Link key={s.path} href={href} aria-current={active ? "page" : undefined} className={active ? "is-active" : ""}>
            <span aria-hidden><Glyph e={SECTION_ICONS[s.path] ?? "•"} /></span>{s.label}
          </Link>;
        })}
        <p className="mx-team-command-label mx-team-command-label-secondary">INTELLIGENCE</p>
        {sections.filter(s => LOOK_UP.has(s.path)).map(s => {
          const href = `/team${s.path}`;
          const active = pathname.startsWith(href);
          return <Link key={s.path} href={href} aria-current={active ? "page" : undefined} className={active ? "is-active" : ""}>
            <span aria-hidden><Glyph e={SECTION_ICONS[s.path] ?? "•"} /></span>{s.label}
          </Link>;
        })}
      </div>
      <div className="mx-team-command-footer">
        <span className="mx-team-command-live"><i /> SYSTEM LIVE</span>
        <span>PRIMUS / 2026</span>
      </div>
    </nav>
  );
}
