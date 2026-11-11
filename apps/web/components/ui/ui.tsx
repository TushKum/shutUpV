// Small building blocks shared by every area: panels, badges, tables and the result of an action.

import type { ReactNode } from "react";
import { CipherText } from "./matrix/cipher-text";
import { DitherLayer } from "./matrix/dither-layer";

export function Panel({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mx-panel min-w-0 rounded-lg ${className}`}>
      {title || actions ? (
        <>
          <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            {title ? (
              <h2 className="min-w-0 text-base font-semibold text-phosphor glow [overflow-wrap:anywhere]">
                {typeof title === "string" ? <CipherText text={title} duration={450} /> : title}
              </h2>
            ) : (
              <span />
            )}
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </header>
          {/* The rule under the title is a dithered strip (decoration: no text sits on it). */}
          <div className="relative h-1.5 border-t border-line">
            <DitherLayer from="top" opacity={0.55} />
          </div>
        </>
      ) : null}
      {/* Text typed by organisers (a URL in a bulletin, a long reason) wraps instead of widening the page. Table cells
          do not wrap (Td), so tables are unaffected. */}
      <div className="p-4 [overflow-wrap:anywhere]">{children}</div>
    </section>
  );
}

// Tones are text colours on black: green for good and neutral news, amber for warnings, red for errors.
const TONES = {
  slate: "text-muted ring-line",
  green: "text-phosphor ring-phosphor-dim",
  amber: "text-warn ring-warn/60",
  red: "text-danger-soft ring-danger/70",
  blue: "text-phosphor-mid ring-phosphor-dim",
  violet: "text-paper ring-phosphor-dim",
} as const;
export type Tone = keyof typeof TONES;

/** A badge, drawn as a [ BRACKETED ] tag (the brackets and the capitals are CSS: the text is unchanged). */
export function Badge({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`mx-tag text-xs ring-0 ${TONES[tone]}`}>{children}</span>;
}

/**
 * A table that scrolls sideways inside its panel on a narrow screen. The scroller can take keyboard focus (arrow
 * keys scroll it) and is named after `label`.
 */
export function Table({
  head,
  children,
  empty,
  className = "",
  label,
}: {
  head: ReactNode[];
  children: ReactNode;
  empty?: ReactNode;
  className?: string;
  label?: string;
}) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(rows) && rows.length === 0;
  const name = label ?? "Table";
  return (
    <div
      role="region"
      aria-label={name}
      tabIndex={0}
      className={`overflow-x-auto rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor ${className}`}
    >
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-2 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{rows}</tbody>
      </table>
      {isEmpty ? <p className="px-2 py-4 text-sm text-muted">{empty ?? "Nothing yet."}</p> : null}
    </div>
  );
}

export function Td({ children, className = "", mono = false }: { children?: ReactNode; className?: string; mono?: boolean }) {
  return <td className={`whitespace-nowrap px-2 py-1.5 ${mono ? "font-mono tabular-nums" : ""} ${className}`}>{children}</td>;
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-md bg-raised px-3 py-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-phosphor">{value}</div>
      {hint ? <div className="text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function Notice({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  // A red notice keeps bg-red-50 (a test hook, themed in globals.css as a faint red on black).
  return <div className={`rounded-md ${tone === "red" ? "bg-red-50" : "bg-panel"} px-3 py-2 text-sm ring-1 ring-inset ${TONES[tone]}`}>{children}</div>;
}

// Buttons are terminal keys: an outlined, glowing key (primary), a quiet outline (secondary) and a red key (danger).
export const buttonClass = {
  primary: "mx-key rounded-md px-3 py-2 text-sm",
  secondary: "mx-key mx-key-quiet rounded-md px-3 py-2 text-sm",
  danger: "mx-key mx-key-danger rounded-md px-3 py-2 text-sm",
} as const;

export const inputClass = "block w-full rounded-md border border-phosphor-dim px-3 py-2 text-sm focus:border-phosphor focus:outline-none";
