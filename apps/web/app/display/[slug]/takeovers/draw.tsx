// Placeholder until the takeover workstream fills it in.

import { TAKEOVER_TITLES } from "@/lib/display/takeover";
import type { TakeoverProps } from "./index";
import { TakeoverFrame } from "./frame";

export async function DrawTakeover({ takeover }: TakeoverProps) {
  return (
    <TakeoverFrame title={TAKEOVER_TITLES.DRAW} at={takeover.at} until={takeover.until}>
      <p className="text-[48px] font-bold">{TAKEOVER_TITLES.DRAW}</p>
    </TakeoverFrame>
  );
}
