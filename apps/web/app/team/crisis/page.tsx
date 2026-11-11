import type { Metadata } from "next";
import { loadTeamContext } from "@/lib/team/context";
import { loadCrisisRoom } from "@/lib/team/crisis-data";
import { currentSubround, subroundTimeline } from "@/lib/team/crisis";
import { sectionAllowed } from "@/lib/team/sections";
import { pauseOf } from "@/lib/team/squad-data";
import { RefreshAt } from "@/lib/live/refresh-at";
import { Notice } from "@/components/ui/ui";
import { ProductRoom } from "./product";
import { ConsultingRoom } from "./consulting";
import { FinanceRoom } from "./finance";
import { Timeline } from "./parts";

export const metadata: Metadata = { title: "Crisis room" };

// PRIMUS Rounds 2 and 3 for each track: Product teams hire firms, write response plans, rate their firm and draft a
// statement; Consulting firms sell their advice and write memos (and the solution with their Round 3 client); funds
// read the cards, the hires and the draft. The page re-reads at each step of the sub-round's timeline.
export default async function CrisisRoomPage() {
  const ctx = await loadTeamContext();
  if (!sectionAllowed(ctx.team.track, "/crisis")) return <Notice>This section is not part of your team&apos;s portal.</Notice>;
  const data = await loadCrisisRoom(ctx);
  if (data.format !== "PRIMUS") return <Notice>Tonight&apos;s event plays the classic format: there is no crisis room. See Squad and Rescue.</Notice>;
  const k = currentSubround(ctx.status.phase, data.subrounds);
  const nowMs = new Date(ctx.status.server_time).getTime();
  const steps = k === null ? [] : subroundTimeline(k, data.deadlines, nowMs, pauseOf(ctx));
  const nextAt = steps.find((s) => !s.passed && s.at)?.at ?? null;
  return (
    <div className="space-y-6">
      <RefreshAt at={nextAt} />
      {k === null ? (
        <Notice>
          {ctx.status.phase === "PRESSURE"
            ? "Round 2 is under way: the first crisis card is revealed soon. This page updates by itself."
            : "The crisis room opens in Round 2, after the IPO."}
        </Notice>
      ) : (
        <Timeline k={k} steps={steps} />
      )}
      {ctx.team.track === "PRODUCT" ? (
        <ProductRoom ctx={ctx} data={data} k={k} nowMs={nowMs} />
      ) : ctx.team.track === "CONSULTING" ? (
        <ConsultingRoom ctx={ctx} data={data} k={k} nowMs={nowMs} />
      ) : (
        <FinanceRoom ctx={ctx} data={data} k={k} />
      )}
    </div>
  );
}
