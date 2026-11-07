import Link from "next/link";

const tab = (active: boolean) =>
  `whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${
    active ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
  }`;

/** The market's views: the prices, and the crisis solutions once they are public (02:15). */
export function MarketTabs({ current, solutions }: { current: "PRICES" | "SOLUTIONS"; solutions: boolean }) {
  return (
    <nav aria-label="Market views" className="flex flex-wrap gap-2">
      <Link href="/team/market" aria-current={current === "PRICES" ? "page" : undefined} className={tab(current === "PRICES")}>
        Prices
      </Link>
      {solutions ? (
        <Link href="/team/market/solutions" aria-current={current === "SOLUTIONS" ? "page" : undefined} className={tab(current === "SOLUTIONS")}>
          Crisis solutions
        </Link>
      ) : null}
    </nav>
  );
}
