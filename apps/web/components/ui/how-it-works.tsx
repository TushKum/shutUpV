import type { ReactNode } from "react";

// The rules behind a panel, folded away: the panel shows one plain line of what to do, and the full rules open on a
// tap. Nothing is hidden from those who want it, and the screen stays short for those who do not.
export function HowItWorks({ children, label = "How it works", testId }: { children: ReactNode; label?: string; testId?: string }) {
  return (
    <details className="group mt-3 rounded-lg ring-1 ring-line" data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-bold text-phosphor-mid hover:text-phosphor">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
          ▸
        </span>
        ℹ {label}
      </summary>
      <div className="space-y-2 px-3 pb-3 text-sm text-paper [overflow-wrap:anywhere]">{children}</div>
    </details>
  );
}

/** The one plain line at the top of a panel: what to do, by when. */
export function DoThis({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="text-base font-semibold text-phosphor" data-testid={testId}>
      {children}
    </p>
  );
}
