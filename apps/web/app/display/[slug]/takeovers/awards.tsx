// Placeholder until the takeover workstream fills it in.

import { TAKEOVER_TITLES } from "@/lib/display/takeover";
import type { TakeoverProps } from "./index";
import { TakeoverFrame } from "./frame";

export async function AwardsTakeover({ takeover }: TakeoverProps) {
  return (
    <TakeoverFrame title={TAKEOVER_TITLES.AWARDS} at={takeover.at} until={takeover.until}>
      <p className="text-[48px] font-bold">{TAKEOVER_TITLES.AWARDS}</p>
    </TakeoverFrame>
  );
}
