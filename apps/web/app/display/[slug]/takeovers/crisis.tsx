// Placeholder until the takeover workstream fills it in.

import { TAKEOVER_TITLES } from "@/lib/display/takeover";
import type { TakeoverProps } from "./index";
import { TakeoverFrame } from "./frame";

export async function CrisisTakeover({ takeover }: TakeoverProps) {
  return (
    <TakeoverFrame title={TAKEOVER_TITLES.CRISIS} at={takeover.at} until={takeover.until}>
      <p className="text-[48px] font-bold">{TAKEOVER_TITLES.CRISIS}</p>
    </TakeoverFrame>
  );
}
