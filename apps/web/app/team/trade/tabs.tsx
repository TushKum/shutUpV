"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/team/trade", label: "Orders" },
  { href: "/team/trade/positions", label: "Positions" },
  { href: "/team/trade/history", label: "History" },
  { href: "/team/trade/ipo", label: "IPO" },
] as const;

// The fund's trading views. On a phone the pills wrap onto a second line (never wider than the screen).
export function TradeTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Trading views">
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
