import { loadTeamContext } from "@/lib/team/context";
import { TradeTabs } from "./tabs";
import { tradeGate } from "./gate";

// The fund's trading area: orders (the ticket and the open round's orders), positions, history and the IPO. A
// Product or Consulting team sees a notice instead; every page checks again, because a page renders on its own.
export default async function TradeLayout({ children }: LayoutProps<"/team/trade">) {
  const ctx = await loadTeamContext();
  const gate = tradeGate(ctx);
  if (gate) return gate;
  return (
    <div className="space-y-4">
      <TradeTabs />
      {children}
    </div>
  );
}
