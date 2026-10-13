import type { Metadata } from "next";
import { loadDisplayFrame } from "@/lib/display/frame";
import { activeTakeover } from "@/lib/display/takeover";
import { ClockProvider } from "@/lib/live/clock";
import { EventChannel } from "@/lib/live/channel";
import { Heartbeat } from "@/lib/live/heartbeat";
import { RefreshAt } from "@/lib/live/refresh-at";
import { Stage } from "../stage";
import { DisplayHeader } from "./header";
import { BulletinBanner } from "./banner";
import { Board } from "./board/board";
import { TakeoverView } from "./takeovers";
import { ScreenSwitch } from "./screen-switch";
import { FallbackRefresh } from "./fallback-refresh";

export const metadata: Metadata = { title: "Big screen" };

// The projector (1920×1080): header, bulletin banner and the ticker board, or a full-screen takeover. Every broadcast
// on the event's channel re-reads this page (within a second); while the channel is down it re-reads every 10 s.
// The display account reads public data only, so no team name or ranking can appear before AWARDS.
export default async function DisplayScreen({ params }: PageProps<"/display/[slug]">) {
  const { slug } = await params;
  const { event, status, bulletin, moments } = await loadDisplayFrame(slug);
  const takeover = activeTakeover(moments, Date.parse(status.server_time));
  return (
    <ClockProvider serverTime={status.server_time}>
      <EventChannel eventId={event.id}>
        <Heartbeat eventId={event.id} area="display" />
        <FallbackRefresh />
        <RefreshAt at={takeover?.until} afterMs={250} />
        <RefreshAt at={status.open_round?.closes_at} />
        <RefreshAt at={status.next_round?.opens_at} />
        <Stage>
          <ScreenSwitch until={takeover?.until ?? null} takeover={takeover ? <TakeoverView event={event} takeover={takeover} /> : null}>
            <DisplayHeader event={event} status={status} />
            <BulletinBanner bulletin={bulletin} />
            {status.paused ? (
              <p className="shrink-0 bg-amber-400 py-3 text-center text-[36px] font-black text-black" data-testid="display-paused">
                The event is paused. Deadlines move later by the length of the pause.
              </p>
            ) : null}
            <Board event={event} status={status} />
          </ScreenSwitch>
        </Stage>
      </EventChannel>
    </ClockProvider>
  );
}
