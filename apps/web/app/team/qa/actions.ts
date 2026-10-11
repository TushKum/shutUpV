"use server";

// The Q&A board: a fund posts a question (post_question), the Product team answers a question about its own company
// (answer_question). Each action is one game function, run as the signed-in team; the database checks the caller,
// the phase, the length and the rate limit, and its refusal is shown as it comes.

import { rpc, type ActionResult } from "@/lib/rpc";
import { answerCheck, questionCheck } from "@/lib/team/qa";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function postQuestion(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const company = String(form.get("company") ?? "");
  const body = String(form.get("body") ?? "").trim();
  if (!UUID.test(company)) return { ok: false, code: "NO_COMPANY", message: "Choose the company you are asking." };
  const check = questionCheck(body);
  if (!check.ok) return { ok: false, code: "BAD_LENGTH", message: check.message };
  const r = await rpc("post_question", { p_company: company, p_body: body });
  return r.ok ? { ...r, message: "Question posted. It is public on the board, shown without your team." } : r;
}

export async function answerQuestion(questionId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const body = String(form.get("body") ?? "").trim();
  if (!UUID.test(questionId)) return { ok: false, code: "NOT_FOUND", message: "No such question." };
  const check = answerCheck(body);
  if (!check.ok) return { ok: false, code: "BAD_LENGTH", message: check.message };
  const r = await rpc("answer_question", { p_question: questionId, p_body: body });
  return r.ok ? { ...r, message: "Answer posted on the board." } : r;
}
