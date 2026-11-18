import type { Metadata } from "next";
import { phaseReached } from "@msim/engine";
import { loadDisplayFrame } from "@/lib/display/frame";
import { activeTakeover } from "@/lib/display/takeover";
import { ClockProvider } from "@/lib/live/clock";
import { EventChannel } from "@/lib/live/channel";
import { Heartbeat } from "@/lib/live/heartbeat";
import { RefreshAt } from "@/lib/live/refresh-at";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { Stage } from "../../stage";
import { DisplayHeader } from "../header";
import { NewsTicker } from "../ticker";
import { TakeoverView } from "../takeovers";
import { ScreenSwitch } from "../screen-switch";
import { FallbackRefresh } from "../fallback-refresh";
import { DraftBoard, loadLiveDraft } from "../draft-board";
import { MarketWall, PracticeWallSection, WelcomeWall } from "./walls";

export const metadata: Metadata = { title: "Live wall" };

// The all-in-one screen for the event's own big screen (1920×1080, scaled to any screen): the clock, the phase and
// the round at the top; under it, whatever the room should be watching now: before Round 1 the night's plan, in
// Round 1 the Finance teams' practice market moving live, from Reading every company's price and candles with the
// sector race, the movers, a spotlight chart and the news. Crisis reveals, verdicts, the closing bell, the awards and
// the Round 3 draft take the whole screen, as on the projector page. Public data only (the display account).
export default async function LiveWall({ params }: PageProps<"/display/[slug]/live">) {
  const { slug } = await params;
  const { event, status, moments } = await loadDisplayFrame(slug);
  const takeover = activeTakeover(moments, Date.parse(status.server_time), event.clock_speed);
  const draft = status.phase === "SATURATION" ? await loadLiveDraft(event.id) : null;
  const current = draft?.picks.find((p) => p.statement_id === null) ?? null;
  const listed = phaseReached(status.phase, "READING");
  return (
    <ClockProvider serverTime={status.server_time} pausedAt={status.paused ? status.paused_at : null}>
      <EventChannel eventId={event.id}>
        <Heartbeat eventId={event.id} area="display" />
        <FallbackRefresh />
        <RefreshAt at={takeover?.until} afterMs={250} />
        <RefreshAt at={status.open_round?.closes_at} />
        <RefreshAt at={status.next_round?.opens_at} />
        <RefreshAt at={current?.closes_at} afterMs={2500} />
        {/* While a round is open its live candles move with the orders: re-read every 10 s. */}
        <AutoRefresh everyMs={10_000} active={!!status.open_round} />
        <Stage>
          <ScreenSwitch
            until={draft ? null : (takeover?.until ?? null)}
            takeover={draft ? <DraftBoard data={draft} /> : takeover ? <TakeoverView event={event} takeover={takeover} /> : null}
          >
            <DisplayHeader event={event} status={status} />
            {status.paused ? (
              <p className="shrink-0 bg-warn py-2 text-center text-[36px] leading-tight font-black text-ink" data-testid="live-paused">
                The event is paused. Deadlines move later by the length of the pause.
              </p>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col" data-testid="live-wall">
              {listed ? (
                <MarketWall event={event} status={status} />
              ) : status.phase === "BUILD" ? (
                <PracticeWallSection event={event} status={status} />
              ) : (
                <WelcomeWall event={event} status={status} />
              )}
            </div>
            <NewsTicker event={event} status={status} />
          </ScreenSwitch>
        </Stage>
      </EventChannel>
    </ClockProvider>
  );
}
