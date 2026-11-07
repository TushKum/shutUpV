import { TradeTabs } from "./tabs";

// Round 3's trading area: orders (the ticket and the open round's orders), portfolio and history.
export default function TradeLayout({ children }: LayoutProps<"/team/trade">) {
  return (
    <div className="space-y-4">
      <TradeTabs />
      {children}
    </div>
  );
}
