"use client";

// "Do this now": the one open task of this team that closes first, on every team page, with its countdown and a
// button to the place that does it. Nothing to do: no bar.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Countdown } from "@/components/ui/countdown";

export interface BarTask {
  title: string;
  href: string;
  linkLabel: string | null;
  due: string | null;
}

export function ActionBar({ task }: { task: BarTask | null }) {
  const path = usePathname();
  if (!task) return null;
  const here = path === task.href;
  return (
    <div className="sticky top-0 z-30 border-b border-indigo-700 bg-indigo-600 text-white shadow" role="region" aria-label="Do this now" data-testid="action-bar">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <span className="rounded bg-white/20 px-2 py-0.5 text-xs font-bold uppercase tracking-wide">Do this now</span>
        <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{task.title}</span>
        {task.due ? (
          <span className="whitespace-nowrap text-indigo-100">
            closes in <Countdown to={task.due} passed="now" className="font-semibold text-white" />
          </span>
        ) : null}
        {here ? (
          <span className="rounded bg-white/15 px-3 py-1 text-xs font-semibold">You&apos;re on it</span>
        ) : (
          <Link href={task.href} className="rounded bg-white px-3 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-50">
            {task.linkLabel ?? "Open"} →
          </Link>
        )}
      </div>
    </div>
  );
}
