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
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              active
                ? "mx-accent-pill-active border text-white"
                : "border border-white/12 bg-white/[0.045] text-slate-300 hover:border-white/24 hover:bg-white/[0.09] hover:text-white"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
