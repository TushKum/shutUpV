// The 04:00 flash news: the published FLASH bulletin, its title very large and its body below, as large as fits.

import { TAKEOVER_TITLES } from "@/lib/display/takeover";
import { clock } from "@/lib/format";
import type { TakeoverProps } from "./index";
import { TakeoverFrame } from "./frame";
import { loadFlashBulletin } from "./data";
import { FlashFit } from "./flash-fit";
import { Neutral } from "./parts";

export async function FlashTakeover({ event, takeover }: TakeoverProps) {
  const bulletin = await loadFlashBulletin(event.id);
  return (
    <TakeoverFrame title={TAKEOVER_TITLES.FLASH} at={takeover.at} until={takeover.until} tone="bg-amber-400 text-black">
      {bulletin ? (
        <FlashFit title={bulletin.title} body={bulletin.body} published={clock(bulletin.published_at)} />
      ) : (
        <Neutral>The flash news will appear here.</Neutral>
      )}
    </TakeoverFrame>
  );
}
