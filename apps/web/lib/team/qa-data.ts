// Reads the Q&A board as the signed-in team: questions are readable without their asker (a column grant hides it;
// only the granted columns are selected), answers in full, companies from Reading. Questions newest first, a page at
// a time; the answers of the questions on the page.

import { supabaseServer } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { pageOf, type Paging } from "./public-ledger";
import { QUESTIONS_PER_PAGE, threads, unanswered, type AnswerRow, type QuestionRow, type Thread } from "./qa";

const Q_COLUMNS = "id, company_id, body, created_at";
const A_COLUMNS = "id, question_id, company_id, body, word_count, created_at";

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  return r.data as T;
}

export interface QaCompany {
  id: string;
  ticker: string;
  name: string | null;
}

export async function loadQaCompanies(eventId: string): Promise<QaCompany[]> {
  const sb = await supabaseServer();
  return must(await sb.from("companies").select("id, ticker, name").eq("event_id", eventId).not("ticker", "is", null).order("ticker"), "the companies") as QaCompany[];
}

export interface QaPage {
  threads: Thread[];
  paging: Paging;
}

/** One page of questions (newest first), optionally for one company, with their answers. */
export async function loadQaPage(eventId: string, companyId: string | null, page: number): Promise<QaPage> {
  const sb = await supabaseServer();
  let counted = sb.from("qa_questions").select("id", { count: "exact", head: true }).eq("event_id", eventId);
  let rows = sb.from("qa_questions").select(Q_COLUMNS).eq("event_id", eventId);
  if (companyId) {
    counted = counted.eq("company_id", companyId);
    rows = rows.eq("company_id", companyId);
  }
  const c = await counted;
  if (c.error) throw new Error(`Could not count the questions: ${c.error.message}`);
  const paging = pageOf(c.count ?? 0, page, QUESTIONS_PER_PAGE, "Questions");
  if (!c.count) return { threads: [], paging };
  const qs = must(
    await rows.order("created_at", { ascending: false }).order("id", { ascending: false }).range(paging.from, paging.to),
    "the questions",
  ) as QuestionRow[];
  const as = qs.length
    ? (must(await sb.from("qa_answers").select(A_COLUMNS).in("question_id", qs.map((q) => q.id)), "the answers") as AnswerRow[])
    : [];
  return { threads: threads(qs, as), paging };
}

/** The questions to one company that have no answer yet, oldest first (the Product team's queue). */
export async function loadUnanswered(companyId: string): Promise<QuestionRow[]> {
  const sb = await supabaseServer();
  const [qs, as] = await Promise.all([
    fetchAll<QuestionRow>((from, to) => sb.from("qa_questions").select(Q_COLUMNS).eq("company_id", companyId).order("created_at").order("id").range(from, to)),
    fetchAll<Pick<AnswerRow, "question_id">>((from, to) => sb.from("qa_answers").select("question_id").eq("company_id", companyId).order("id").range(from, to)),
  ]);
  return unanswered(qs, as);
}
