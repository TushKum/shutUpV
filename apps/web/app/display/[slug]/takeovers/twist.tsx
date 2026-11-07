// 22:15 the twist: the one twist every team must answer in its PRD, its title very large and its body below, as large
// as fits. Published to every team at the same moment.

import { TAKEOVER_TITLES } from "@/lib/display/takeover";
import { loadTwist } from "@/lib/display/frame";
import { clock } from "@/lib/format";
import type { TakeoverProps } from "./index";
import { TakeoverFrame } from "./frame";
import { FitText } from "./fit-text";
import { Neutral } from "./parts";

export async function TwistTakeover({ event, takeover }: TakeoverProps) {
  const twist = await loadTwist(event.id);
  return (
    <TakeoverFrame title={TAKEOVER_TITLES.TWIST} at={takeover.at} until={takeover.until} tone="bg-violet-400 text-black">
      {twist ? (
        <FitText
          title={twist.title}
          body={twist.body}
          label={`Published ${clock(twist.published_at)} · every PRD must answer it by 23:00`}
          tone="text-violet-300"
          testId="twist"
        />
      ) : (
        <Neutral>The twist will appear here.</Neutral>
      )}
    </TakeoverFrame>
  );
}
