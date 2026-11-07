// The main screen under the header and the bulletin banner. Before the 23:30 reveal: a large countdown to the next
// moment of the evening, the schedule, and the twist once it is out. From 23:30: the price board, every company's
// ticker, name, price, change since the starting price and the last cleared round's move, 25 tiles to a page; until
// the 03:30 freeze the leaderboard takes a turn too. A clearing broadcasts on the event channel and the page re-reads
// itself, so the board is always the latest clearing.

import type { DeadlineCode, PhaseCode } from "@msim/engine";
import type { EventStatus } from "@/lib/event-status";
import { loadTwist, type DisplayEvent } from "@/lib/display/frame";
import { boardTiles, highlightUntil } from "@/lib/display/board";
import { eveningMoments, nextMoment } from "@/lib/display/countdown";
import { clock } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { Countdown } from "@/components/ui/countdown";
import { RefreshAt } from "@/lib/live/refresh-at";
import { loadBoard, loadLiveLeaderboard } from "./data";
import { BoardPages } from "./pages";
import { LeaderboardPage } from "./leaderboard";

export async function Board({ event, status, compact = false }: { event: DisplayEvent; status: EventStatus; compact?: boolean }) {
  if (!event.prices_started_at) return <Evening event={event} status={status} />;

  const [{ companies, round }, leaderboard] = await Promise.all([loadBoard(event.id), event.leaderboard_frozen_at ? Promise.resolve(null) : loadLiveLeaderboard(event.id)]);
  const tiles = boardTiles(companies, round?.round_prices ?? [], event.market_closed_at !== null);
  if (tiles.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center" data-testid="board">
        <p className="text-[48px] font-bold text-slate-300">No companies are listed.</p>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="board">
      <BoardPages
        tiles={tiles}
        round={round?.number ?? null}
        closed={tiles.some((t) => t.closing)}
        serverTime={status.server_time}
        highlightUntil={highlightUntil(round?.cleared_at)}
        compact={compact}
        extra={leaderboard ? <LeaderboardPage rows={leaderboard} /> : null}
      />
    </div>
  );
}

async function Evening({ event, status }: { event: DisplayEvent; status: EventStatus }) {
  const sb = await supabaseServer();
  const [deadlines, phases, twist] = await Promise.all([
    sb.from("deadlines").select("code, at").eq("event_id", event.id),
    sb.from("phases").select("code, starts_at").eq("event_id", event.id),
    loadTwist(event.id),
  ]);
  for (const r of [deadlines, phases]) if (r.error) throw new Error(`Could not read the schedule: ${r.error.message}`);
  const moments = eveningMoments(
    Object.fromEntries(((deadlines.data ?? []) as { code: DeadlineCode; at: string }[]).map((d) => [d.code, d.at])),
    Object.fromEntries(((phases.data ?? []) as { code: PhaseCode; starts_at: string }[]).map((p) => [p.code, p.starts_at])),
  );
  const nowMs = Date.parse(status.server_time);
  const next = nextMoment(moments, nowMs);
  return (
    <div className="flex min-h-0 flex-1 gap-12 px-16 py-10" data-testid="board">
      <RefreshAt at={next?.at ?? null} />
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        {next ? (
          <>
            <p className="text-[56px] leading-tight font-bold text-slate-300" data-testid="evening-next">
              {next.label}
            </p>
            <p className="font-mono text-[220px] leading-none font-black tabular-nums" data-testid="evening-countdown">
              {status.paused ? <span className="text-amber-300">paused</span> : <Countdown to={next.at} passed="now" />}
            </p>
            <p className="mt-4 text-[44px] text-slate-300">
              at <span className="font-mono font-bold text-white tabular-nums">{clock(next.at)}</span>
            </p>
          </>
        ) : (
          <p className="text-[72px] leading-tight font-black" data-testid="evening-next">
            {status.phase === "SETUP" || status.phase === "CHECKIN"
              ? "Welcome to PRIMUS. The night begins shortly."
              : status.phase === "BRIEFING"
                ? "The briefing is on. The problem cards come next."
                : status.phase === "BUILD"
                  ? "Build your company. The organisers will close the PRD form."
                  : "The PRDs are being judged. Scores and starting prices in a moment."}
          </p>
        )}
        {twist ? (
          <div className="mt-10 rounded-2xl border-4 border-violet-400 bg-violet-950/40 px-8 py-5" data-testid="evening-twist">
            <p className="text-[28px] font-bold tracking-wide text-violet-300 uppercase">The twist · {clock(twist.published_at)}</p>
            <p className="line-clamp-2 text-[48px] leading-tight font-black">{twist.title}</p>
            {twist.body ? <p className="line-clamp-3 text-[30px] leading-snug text-slate-200">{twist.body}</p> : null}
          </div>
        ) : null}
      </div>
      <ol className="flex w-[640px] shrink-0 flex-col justify-center gap-4" aria-label="Tonight" data-testid="evening-schedule">
        <li className="text-[32px] font-bold tracking-wide text-slate-400 uppercase">Tonight</li>
        {moments.map((m) => {
          const past = Date.parse(m.at) <= nowMs;
          return (
            <li key={m.key} className={`flex items-baseline justify-between gap-6 text-[38px] ${past ? "text-slate-500 line-through" : m.key === next?.key ? "font-black text-white" : "text-slate-200"}`}>
              <span className="min-w-0">{m.label}</span>
              <span className="font-mono tabular-nums">{clock(m.at)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
