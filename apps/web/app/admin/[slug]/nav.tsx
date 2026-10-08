"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEventChannel } from "@/lib/live/channel";

export const SECTIONS = [
  { path: "", label: "Phase" },
  { path: "/lottery", label: "Lottery" },
  { path: "/rounds", label: "Rounds" },
  { path: "/judge", label: "Judge" },
  { path: "/bulletins", label: "Bulletins" },
  { path: "/content", label: "Content" },
  { path: "/ledger", label: "Ledger" },
  { path: "/fairness", label: "Fairness" },
  { path: "/exports", label: "Exports" },
  { path: "/health", label: "Health" },
] as const;

export function AdminNav({ slug, fairness }: { slug: string; fairness: boolean }) {
  const pathname = usePathname();
  const base = `/admin/${slug}`;
  return (
    <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4" aria-label="Sections">
      {SECTIONS.map((s) => {
        const href = `${base}${s.path}`;
        const active = s.path === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={s.path}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              active ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-900"
            } ${s.path === "/fairness" && fairness ? "font-semibold" : ""}`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function RealtimeDot() {
  const { status } = useEventChannel();
  const ok = status === "SUBSCRIBED";
  return (
    <span className="flex items-center gap-1 text-xs text-slate-500" title={`Realtime: ${status}`} data-realtime={status}>
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : status === "CONNECTING" ? "bg-amber-400" : "bg-red-500"}`} />
      {ok ? "Live" : status === "CONNECTING" ? "Connecting" : "Offline"}
    </span>
  );
}
