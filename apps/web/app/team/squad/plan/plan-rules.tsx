"use client";

// The two rules that decide the plan's score besides the judge, said next to the editor and kept current by the
// server clock: the hard deadline (a late or missing plan scores 0; the notice turns red near it) and the cap at 50
// when the deal is not fully signed by the deal deadline.

import { useServerNow } from "@/lib/live/clock";
import { planCap, planDeadline, type DealRow } from "@/lib/team/squad";
import { Notice } from "@/components/ui/ui";
import { Due } from "../due";

export function PlanRules({
  deadline,
  dealDeadline,
  deal,
  submittedAt,
  paused,
  pausedAt,
  clockSpeed,
}: {
  deadline: string | null;
  dealDeadline: string | null;
  deal: DealRow | null;
  submittedAt: string | null;
  paused: boolean;
  pausedAt: string | null;
  clockSpeed: number;
}) {
  const now = useServerNow(1000);
  const p = { paused, pausedAt };
  const due = planDeadline(submittedAt, deadline, now, p, clockSpeed);
  const cap = planCap(deal, dealDeadline, now, p);
  return (
    <div className="space-y-2" data-testid="plan-rules">
      <Notice tone={due.tone}>
        <span data-testid="plan-deadline-rule">{due.text}</span>{" "}
        <span className="whitespace-nowrap">
          (<Due at={deadline} paused={paused} pausedAt={pausedAt} />)
        </span>
      </Notice>
      <Notice tone={cap.tone}>
        <span data-testid="plan-cap-rule">{cap.text}</span>
      </Notice>
    </div>
  );
}
