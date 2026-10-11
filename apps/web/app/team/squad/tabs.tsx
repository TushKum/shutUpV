"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/team/squad", label: "Overview" },
  { href: "/team/squad/problem", label: "Problem card" },
  { href: "/team/squad/pitch", label: "Pitch" },
  { href: "/team/squad/plan", label: "Plan" },
  { href: "/team/squad/flash", label: "Flash" },
] as const;

// The views of the squad workspace. On a phone the pills wrap onto a second line (never wider than the screen).
export function SquadTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Squad workspace">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              active ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
