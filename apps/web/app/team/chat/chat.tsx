"use client";

// The chat's form: it sends with one click or Enter (Shift+Enter for a new line), as a chat message moves no money,
// price or score. What was typed stays when the database refuses; a sent message clears the box. The counter uses the database's rule (characters after trimming); the database checks again.

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/rpc";
import { CHAT_MAX_CHARS, chatCheck } from "@/lib/team/chat";
import { count } from "@/lib/format";
import { ResultMessage } from "@/components/ui/result-message";
import { safely } from "@/components/ui/action-helpers";
import { buttonClass, inputClass } from "@/components/ui/ui";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export function ChatForm({ action }: { action: Action }) {
  const router = useRouter();
  const [{ result, sent }, dispatch, pending] = useActionState<{ result: ActionResult | null; sent: number }, FormData>(
    async (prev, form) => {
      const r = await safely(() => action(prev.result, form));
      router.refresh();
      return { result: r.ok ? null : r, sent: prev.sent + (r.ok ? 1 : 0) };
    },
    { result: null, sent: 0 },
  );
  const [body, setBody] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const seen = useRef(0);
  useEffect(() => {
    if (sent === seen.current) return;
    seen.current = sent;
    setBody("");
    box.current?.focus();
  }, [sent]);
  const check = chatCheck(body);
  const send = (form: HTMLFormElement) => {
    if (!check.ok || pending) return;
    const data = new FormData(form);
    startTransition(() => dispatch(data));
  };
  return (
    <form
      aria-label="Send a message"
      onSubmit={(e) => {
        e.preventDefault();
        send(e.currentTarget);
      }}
    >
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Message</span>
          <textarea
            ref={box}
            name="body"
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(e.currentTarget.form!);
              }
            }}
            placeholder="Write to your squad…"
            className={`${inputClass} resize-none`}
          />
        </label>
        <button type="submit" className={buttonClass.primary} disabled={!check.ok || pending}>
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
      <p className={`mt-1 text-xs ${check.chars > CHAT_MAX_CHARS ? "text-red-700" : "text-slate-500"}`}>
        {count(check.chars)} / {count(CHAT_MAX_CHARS)} characters · Enter sends, Shift+Enter for a new line
      </p>
      <ResultMessage result={result} />
    </form>
  );
}
