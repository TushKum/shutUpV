import Link from "next/link";
import { Badge } from "@/components/ui/ui";

// The two views of the Ledger section: the ledger itself and the corrections (with the number waiting for a decision).
export function LedgerTabs({ slug, current, pending }: { slug: string; current: "ledger" | "corrections"; pending: number }) {
  const tab = (href: string, active: boolean, label: React.ReactNode) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${
        active ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Ledger views">
      {tab(`/admin/${slug}/ledger`, current === "ledger", "Ledger")}
      {tab(
        `/admin/${slug}/ledger/corrections`,
        current === "corrections",
        <>
          Corrections
          {pending > 0 ? <Badge tone="amber">{pending} pending</Badge> : null}
        </>,
      )}
    </nav>
  );
}
