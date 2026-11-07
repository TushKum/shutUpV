// The takeover the server chose, by kind. Each view loads its own data as the display account (public data only;
// team names appear only in the awards).

import type { DisplayEvent } from "@/lib/display/frame";
import type { ActiveTakeover } from "@/lib/display/takeover";
import { TwistTakeover } from "./twist";
import { PricesTakeover } from "./prices";
import { CrisisTakeover } from "./crisis";
import { RevealTakeover } from "./reveal";
import { ClosingBellTakeover } from "./closing-bell";
import { AwardsTakeover } from "./awards";

export interface TakeoverProps {
  event: DisplayEvent;
  takeover: ActiveTakeover;
}

export function TakeoverView(props: TakeoverProps) {
  switch (props.takeover.kind) {
    case "TWIST":
      return <TwistTakeover {...props} />;
    case "PRICES":
      return <PricesTakeover {...props} />;
    case "CRISIS":
      return <CrisisTakeover {...props} />;
    case "REVEAL":
      return <RevealTakeover {...props} />;
    case "CLOSING_BELL":
      return <ClosingBellTakeover {...props} />;
    case "AWARDS":
      return <AwardsTakeover {...props} />;
  }
}
