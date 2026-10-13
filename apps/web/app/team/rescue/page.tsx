import type { Metadata } from "next";
import { loadTeamContext } from "@/lib/team/context";
import { loadRescue, pauseOf } from "@/lib/team/rescue-data";
import { dealView, feeView } from "@/lib/team/rescue";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import { Notice } from "@/components/ui/ui";
import { CrisisPanel } from "./crisis";
import { DealPanel } from "./deal-panel";
import { FeePanel } from "./fee-panel";

export const metadata: Metadata = { title: "Rescue" };

// The rescue, for all three teams of a squad: the crisis (before 00:30, what will happen), the advisor's fee (Product
// and Consulting; the fund reads it) and the rescue deal (all three sign). Proposals, confirmations and signatures by
// the partner teams send no realtime message, so the page re-reads itself every 10 s while a window is open (only
// while the tab is visible), and once more as each deadline passes.
export default async function RescuePage() {
  const ctx = await loadTeamContext();
  if (!ctx.squad) {
    return (
      <Notice>
        The squads are formed at the squad draw. After the crisis at 00:30, your squad agrees the advisor&apos;s fee and the rescue deal here.
      </Notice>
    );
  }
  const data = await loadRescue(ctx);
  const pause = pauseOf(ctx);
  const nowMs = Date.parse(ctx.status.server_time);
  const crisisApplied = ctx.event.crisis_applied_at !== null;
  const base = { ...pause, phase: ctx.status.phase, crisisApplied, nowMs, track: ctx.team.track, squad: ctx.squad };
  const fee = feeView({ ...base, deadline: data.deadlines.FEE ?? null, fee: data.fee });
  const deal = dealView({ ...base, deadlines: data.deadlines, deal: data.deal, postCrisis: ctx.company?.post_crisis_price ?? null });
  const live = fee.stage === "OPEN" || fee.stage === "DEFAULT_PENDING" || deal.stage === "OPEN";
  // Only a deadline still ahead needs a re-read when it passes (RefreshAt re-reads at once for one already passed).
  const ahead = (at: string | undefined) => (at && Date.parse(at) > nowMs ? at : null);

  return (
    <div className="space-y-4">
      <AutoRefresh everyMs={10_000} active={live} />
      <RefreshAt at={ahead(data.deadlines.FEE)} />
      <RefreshAt at={ahead(data.deadlines.DEAL_BONUS)} />
      <RefreshAt at={ahead(data.deadlines.DEAL)} />
      <CrisisPanel
        applied={crisisApplied}
        startsAt={data.crisisStartsAt}
        card={data.crisisCard}
        move={data.crisisMove}
        company={ctx.company}
        deadlines={data.deadlines}
        pause={pause}
      />
      <FeePanel
        fee={fee}
        track={ctx.team.track}
        deadline={data.deadlines.FEE ?? null}
        pause={pause}
        ipoPrice={ctx.company?.ipo_price ?? null}
        companyCash={ctx.team.track === "PRODUCT" ? ctx.team.cash : null}
        retained={data.retained}
      />
      <DealPanel
        deal={deal}
        track={ctx.team.track}
        deadlines={data.deadlines}
        pause={pause}
        postCrisis={ctx.company?.post_crisis_price ?? null}
        fundAvailable={data.fundAvailable}
        retained={data.retained}
      />
    </div>
  );
}
