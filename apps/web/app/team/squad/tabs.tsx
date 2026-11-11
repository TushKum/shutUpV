"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/team/squad", label: "Overview" },
  { href: "/team/squad/problem", label: "Problem card" },
  { href: "/team/squad/pitch", label: "PRD" },
  { href: "/team/squad/memo", label: "Crisis memo" },
  { href: "/team/squad/plan", label: "Plan" },
  { href: "/team/squad/flash", label: "Flash" },
] as const;

// The views of the squad workspace: this round's only (the layout passes which). On a phone the pills wrap onto a
// second line (never wider than the screen).
export function SquadTabs({ show, oneCase = false }: { show: readonly string[]; oneCase?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Squad workspace">
      {TABS.filter((t) => show.includes(t.href)).map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-xl px-4 py-2 text-sm font-bold ${
              active ? "bg-phosphor-deep text-phosphor" : "bg-panel text-paper ring-1 ring-inset ring-line hover:bg-raised"
            }`}
          >
            {oneCase && t.href === "/team/squad/problem" ? "The case" : t.label}
          </Link>
        );
      })}
    </nav>
  );
}
