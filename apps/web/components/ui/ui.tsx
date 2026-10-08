// Small building blocks shared by every area: panels, badges, tables and the result of an action.

import type { ReactNode } from "react";

export function Panel({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title ? <h2 className="text-base font-semibold text-slate-900">{title}</h2> : <span />}
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

const TONES = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

export function Table({ head, children, empty, className = "" }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode; className?: string }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(rows) && rows.length === 0;
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-2 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{rows}</tbody>
      </table>
      {isEmpty ? <p className="px-2 py-4 text-sm text-slate-500">{empty ?? "Nothing yet."}</p> : null}
    </div>
  );
}

export function Td({ children, className = "", mono = false }: { children?: ReactNode; className?: string; mono?: boolean }) {
  return <td className={`whitespace-nowrap px-2 py-1.5 ${mono ? "font-mono tabular-nums" : ""} ${className}`}>{children}</td>;
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</div>
      {hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function Notice({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`rounded-md px-3 py-2 text-sm ring-1 ring-inset ${TONES[tone]}`}>{children}</div>;
}

export const buttonClass = {
  primary: "rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50",
  danger: "rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50",
} as const;

export const inputClass = "block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";
