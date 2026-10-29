// The staff's chat viewer: every squad's chat, busiest-recent first, one squad's messages at a time, and a search
// across all of them. Staff read every squad's chat (RLS); teams read only their own. Pure.

export interface ChatSquad {
  id: string;
  number: number;
  ticker: string | null;
  messages: number;
  lastAt: string | null;
}

export interface ChatQuery {
  squad: number | null;
  q: string;
}

export const SEARCH_LIMIT = 100;
export const SQUAD_LIMIT = 500;

export function parseChatQuery(sp: Record<string, string | string[] | undefined>): ChatQuery {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const n = Number(one(sp.squad));
  return { squad: Number.isInteger(n) && n >= 1 && n <= 50 ? n : null, q: one(sp.q).trim().slice(0, 100) };
}

/** Squads with messages first, the latest activity first; then the quiet squads by number. */
export function sortChatSquads(squads: ChatSquad[]): ChatSquad[] {
  return [...squads].sort((a, b) => {
    if (a.lastAt && b.lastAt) return b.lastAt.localeCompare(a.lastAt) || a.number - b.number;
    if (a.lastAt) return -1;
    if (b.lastAt) return 1;
    return a.number - b.number;
  });
}

/** A search term as an ILIKE pattern that matches it literally (% and _ are not wildcards). */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function chatHref(slug: string, q: Partial<ChatQuery>): string {
  const p = new URLSearchParams();
  if (q.squad) p.set("squad", String(q.squad));
  if (q.q) p.set("q", q.q);
  const s = p.toString();
  return `/admin/${slug}/chats${s ? `?${s}` : ""}`;
}
