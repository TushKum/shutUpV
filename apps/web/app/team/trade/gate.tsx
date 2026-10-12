import Link from "next/link";
import type { TeamContext } from "@/lib/team/context";
import { sectionAllowed } from "@/lib/team/sections";
import { Notice } from "@/components/ui/ui";

/** The notice a trading page shows instead of itself to a Product or Consulting team (they never trade). */
export function tradeGate(ctx: TeamContext) {
  if (sectionAllowed(ctx.team.track, "/trade")) return null;
  return (
    <Notice tone="blue">
      Trading is for the Finance teams: Product and Consulting teams never trade (the insider rules). Every company&apos;s price is on the{" "}
      <Link href="/team/market" className="font-semibold underline">
        Market
      </Link>{" "}
      page.
    </Notice>
  );
}
