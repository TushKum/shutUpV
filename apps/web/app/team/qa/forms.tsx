"use client";

// The board's two forms. Both send with one click: a question or an answer moves no money, price or score, and a
// follow-up can always be posted; a second click would only slow a live conversation. What was typed stays when the
// database refuses (the form is submitted by hand, so React does not reset it); an accepted post clears the form.
// The counters use the database's own rules (characters for questions, the engine's word count for answers), and the
// button stays off while the text is outside the limits; the database checks again.

import { startTransition, useActionState, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/rpc";
import { ANSWER_MAX_WORDS, QUESTION_MAX_CHARS, ANSWER_MAX_CHARS, answerCheck, questionCheck } from "@/lib/team/qa";
import { count } from "@/lib/format";
import { ResultMessage } from "@/components/ui/action";
import { useCarried, useCarrier } from "@/lib/live/feedback";
import { safely } from "@/components/ui/action-helpers";
import { buttonClass, inputClass } from "@/components/ui/ui";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

interface PostState {
  result: ActionResult | null;
  accepted: number;
}

function usePost(action: Action) {
  const router = useRouter();
  const carrier = useCarrier();
  const state = useActionState<PostState, FormData>(
    async (prev, form) => {
      const r = await safely(() => action(prev.result, form));
      carrier.deliver(r);
      router.refresh();
      return { result: r, accepted: prev.accepted + (r.ok ? 1 : 0) };
    },
    { result: null, accepted: 0 },
  );
  useCarried(carrier, state[0].result);
  return state;
}

function PostForm({ action, children, label }: { action: Action; children: (pending: boolean) => ReactNode; label: string }) {
  const [{ result, accepted }, dispatch, pending] = usePost(action);
  return (
    <form
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => dispatch(form));
      }}
    >
      {/* Keyed by accepted posts: only an accepted post clears what was typed. */}
      <div key={accepted}>{children(pending)}</div>
      <ResultMessage result={result} />
    </form>
  );
}

export function AskForm({ action, companies, initial }: { action: Action; companies: { id: string; ticker: string; name: string | null }[]; initial: string | null }) {
  return (
    <PostForm action={action} label="Ask a question">
      {(pending) => <AskFields companies={companies} initial={initial} pending={pending} />}
    </PostForm>
  );
}

function AskFields({ companies, initial, pending }: { companies: { id: string; ticker: string; name: string | null }[]; initial: string | null; pending: boolean }) {
  const [body, setBody] = useState("");
  const check = questionCheck(body);
  return (
    <div className="grid gap-3">
      <label className="block">
        <span className="text-xs font-medium text-slate-600">Company</span>
        <select name="company" required defaultValue={initial ?? ""} className={inputClass}>
          <option value="" disabled>
            Choose a company…
          </option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.ticker}
              {c.name ? ` · ${c.name}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-slate-600">Question</span>
        <textarea name="body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={QUESTION_MAX_CHARS * 2} className={inputClass} />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs tabular-nums ${check.chars > QUESTION_MAX_CHARS ? "font-semibold text-red-700" : "text-slate-500"}`} aria-live="polite">
          {count(check.chars)} / {count(QUESTION_MAX_CHARS)} characters
        </span>
        <button type="submit" disabled={pending || !check.ok} className={buttonClass.primary}>
          {pending ? "Posting…" : "Post question"}
        </button>
      </div>
    </div>
  );
}

export function AnswerForm({ action, label }: { action: Action; label: string }) {
  return <PostForm action={action} label={label}>{(pending) => <AnswerFields pending={pending} />}</PostForm>;
}

function AnswerFields({ pending }: { pending: boolean }) {
  const [body, setBody] = useState("");
  const check = answerCheck(body);
  const over = check.words > ANSWER_MAX_WORDS;
  return (
    <div className="grid gap-2">
      <label className="block">
        <span className="text-xs font-medium text-slate-600">Your answer (up to {ANSWER_MAX_WORDS} words, public)</span>
        <textarea name="body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={ANSWER_MAX_CHARS} className={inputClass} />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs tabular-nums ${over ? "font-semibold text-red-700" : "text-slate-500"}`} aria-live="polite" data-testid="answer-words">
          {count(check.words)} / {ANSWER_MAX_WORDS} words
        </span>
        <button type="submit" disabled={pending || !check.ok} className={buttonClass.primary}>
          {pending ? "Posting…" : "Post answer"}
        </button>
      </div>
      {!check.ok && body.trim() !== "" ? <p className="text-xs text-red-700">{check.message}</p> : null}
    </div>
  );
}
