// The squad chat: a private chat for the three teams of a squad, from the squad draw until the awards. Only the
// squad's teams and the staff read it (the page says so). A message is 1 to 500 characters; a team may post 20 a
// minute. These checks are guidance for the form; the database checks again. Pure.

import { TRACK_LABELS, phaseReached, type PhaseCode, type Track } from "@msim/engine";
import { count } from "@/lib/format";
import type { SquadRow } from "./context";
import { chars, type Check } from "./qa";

export const CHAT_MAX_CHARS = 500;
/** How many of the latest messages the page shows. */
export const CHAT_PAGE = 200;

export type ChatState = "NOT_YET" | "OPEN" | "CLOSED";

export function chatState(phase: PhaseCode, drawn: boolean): ChatState {
  if (phaseReached(phase, "AWARDS")) return "CLOSED";
  return drawn ? "OPEN" : "NOT_YET";
}

export function chatCheck(body: string): Check & { chars: number } {
  const n = chars(body);
  if (n === 0) return { ok: false, chars: n, message: "Write a message first." };
  if (n > CHAT_MAX_CHARS) return { ok: false, chars: n, message: `Messages are at most ${count(CHAT_MAX_CHARS)} characters (this one has ${count(n)}).` };
  return { ok: true, chars: n };
}

/** Which of the squad's teams posted: its track, and whether it is the reader's own team. */
export function author(teamId: string, squad: Pick<SquadRow, "product_team_id" | "consulting_team_id" | "finance_team_id">, me: string): { track: Track | null; label: string; mine: boolean } {
  const track: Track | null =
    teamId === squad.product_team_id ? "PRODUCT" : teamId === squad.consulting_team_id ? "CONSULTING" : teamId === squad.finance_team_id ? "FINANCE" : null;
  const mine = teamId === me;
  const label = track ? `${TRACK_LABELS[track]} team` : "Another team";
  return { track, label: mine ? `${label} (you)` : label, mine };
}
