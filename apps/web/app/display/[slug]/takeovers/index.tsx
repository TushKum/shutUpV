// The takeover the server chose, by kind. Each view loads its own data as the display account (public data only;
// team names appear only in the awards).

import type { DisplayEvent } from "@/lib/display/frame";
import type { ActiveTakeover } from "@/lib/display/takeover";
import { DrawTakeover } from "./draw";
import { CrisisTakeover } from "./crisis";
import { VerdictsTakeover } from "./verdicts";
import { FlashTakeover } from "./flash";
import { ClosingBellTakeover } from "./closing-bell";
import { AwardsTakeover } from "./awards";

export interface TakeoverProps {
  event: DisplayEvent;
  takeover: ActiveTakeover;
}

export function TakeoverView(props: TakeoverProps) {
  switch (props.takeover.kind) {
    case "DRAW":
      return <DrawTakeover {...props} />;
    case "CRISIS":
      return <CrisisTakeover {...props} />;
    case "VERDICTS":
      return <VerdictsTakeover {...props} />;
    case "FLASH":
      return <FlashTakeover {...props} />;
    case "CLOSING_BELL":
      return <ClosingBellTakeover {...props} />;
    case "AWARDS":
      return <AwardsTakeover {...props} />;
  }
}
