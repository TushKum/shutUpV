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
import { NewsTicker } from "./ticker";
import { TakeoverView } from "./takeovers";
import { ScreenSwitch } from "./screen-switch";
import { FallbackRefresh } from "./fallback-refresh";
import { DraftBoard, loadLiveDraft } from "./draft-board";

export const metadata: Metadata = { title: "Big screen" };

// The projector (1920×1080): header, bulletin banner and the ticker board, or a full-screen takeover. Every broadcast
// on the event's channel re-reads this page (within a second); while the channel is down it re-reads every 10 s.
// The display account reads public data only, so no team name or ranking can appear before AWARDS.
export default async function DisplayScreen({ params }: PageProps<"/display/[slug]">) {
  const { slug } = await params;
  const { event, status, bulletin, moments } = await loadDisplayFrame(slug);
  const takeover = activeTakeover(moments, Date.parse(status.server_time), event.clock_speed);
  // A PRIMUS event's Round 3 draft takes the screen while it runs: it comes before a results screen still showing from
  // Round 2 (nothing else can start while companies are picking).
  const draft = status.phase === "SATURATION" ? await loadLiveDraft(event.id) : null;
  const current = draft?.picks.find((p) => p.statement_id === null) ?? null;
  return (
    <ClockProvider serverTime={status.server_time} pausedAt={status.paused ? status.paused_at : null}>
      <EventChannel eventId={event.id}>
        <Heartbeat eventId={event.id} area="display" />
        <FallbackRefresh />
        <RefreshAt at={takeover?.until} afterMs={250} />
        <RefreshAt at={status.open_round?.closes_at} />
        <RefreshAt at={status.next_round?.opens_at} />
        {/* A pick that runs out is given by the heartbeat: look again just after it. */}
        <RefreshAt at={current?.closes_at} afterMs={2500} />
        <Stage>
          <ScreenSwitch
            until={draft ? null : (takeover?.until ?? null)}
            takeover={
              draft ? (
                <DraftBoard data={draft} />
              ) : takeover ? (
                <>
                  <TakeoverView event={event} takeover={takeover} />
                  {/* A pause must show in the hall during a takeover too. */}
                  {status.paused ? <PauseStrip className="absolute inset-x-0 bottom-0 py-1 text-[28px] leading-[1.1]" /> : null}
                </>
              ) : null
            }
          >
            <DisplayHeader event={event} status={status} />
            <BulletinBanner bulletin={bulletin} />
            {status.paused ? <PauseStrip className="shrink-0 py-2 text-[36px] leading-tight" /> : null}
            <Board event={event} status={status} compact={bulletin !== null || status.paused} />
            <NewsTicker event={event} status={status} />
          </ScreenSwitch>
        </Stage>
      </EventChannel>
    </ClockProvider>
  );
}

/** The pause strip: under the banner (36 px), or thinner over a takeover, inside the frame's bottom padding. */
function PauseStrip({ className = "py-2 text-[36px] leading-tight" }: { className?: string }) {
  return (
    <p className={`bg-warn text-center font-black text-ink ${className}`} data-testid="display-paused">
      The event is paused. Deadlines move later by the length of the pause.
    </p>
  );
}
