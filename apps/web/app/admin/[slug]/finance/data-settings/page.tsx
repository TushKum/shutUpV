import type { Metadata } from "next";
import { Panel } from "@/components/ui/ui";
import { requireRole } from "@/lib/auth/viewer";
import { INITIAL_DESK_STATE } from "@/app/demo/finance/_desk/data/seedData";
import { ApiBridgeScreen } from "./api-bridge-screen";

export const metadata: Metadata = { title: "Finance data settings" };

export default async function FinanceDataSettings({ params }: PageProps<"/admin/[slug]/finance/data-settings">) {
  const { slug } = await params;
  await requireRole(["ORGANISER"], `/admin/${slug}/finance/data-settings`);

  return (
    <Panel title="Finance data settings">
      <ApiBridgeScreen sample={{
        portfolio: {
          cash: INITIAL_DESK_STATE.cash,
          initialCapital: INITIAL_DESK_STATE.initialCapital,
          realizedPnl: INITIAL_DESK_STATE.realizedPnl,
          positionsCount: INITIAL_DESK_STATE.positions.length,
        },
        orders: INITIAL_DESK_STATE.orders.slice(0, 2),
        positions: INITIAL_DESK_STATE.positions.slice(0, 2),
      }} />
    </Panel>
  );
}
