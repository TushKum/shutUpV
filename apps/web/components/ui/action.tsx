"use client";

// Buttons and forms that run a server action (a game function) and show its result. After any action the page
// re-fetches its data; realtime refreshes it again when the database broadcasts the change.

import { startTransition, useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/rpc";
import { buttonClass } from "./ui";

export function ResultMessage({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  const text = result.message ?? (result.ok ? "Done." : result.code ?? "Refused.");
  return (
    <p role={result.ok ? "status" : "alert"} className={`mt-2 text-sm ${result.ok ? "text-emerald-700" : "text-red-700"}`}>
      {result.ok ? text : `${result.code && result.code !== "ERROR" && result.code !== "NOT_ALLOWED" ? `${result.code}: ` : ""}${text}`}
    </p>
  );
}

/**
 * Runs `action` on click. With `confirm`, the first click asks for a second one ("Click again to …"), so a stray
 * click on the control panel never advances the night.
 */
export function ActionButton({
  action,
  children,
  confirm,
  variant = "secondary",
  disabled = false,
  title,
}: {
  action: () => Promise<ActionResult>;
  children: ReactNode;
  confirm?: string;
  variant?: keyof typeof buttonClass;
  disabled?: boolean;
  title?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = () => {
    if (confirm && !armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 5000);
      return;
    }
    setArmed(false);
    start(async () => {
      const r = await action();
      setResult(r);
      router.refresh();
    });
  };
  return (
    <div className="inline-block">
      <button type="button" onClick={run} disabled={disabled || pending} title={title} className={armed ? buttonClass.danger : buttonClass[variant]}>
        {pending ? "Working…" : armed ? confirm : children}
      </button>
      <ResultMessage result={result} />
    </div>
  );
}

/** A form whose fields go to a server action `(prev, formData) => result`. */
export function ActionForm({
  action,
  children,
  submit,
  className = "",
  resetOnSuccess = false,
}: {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  children: ReactNode;
  submit: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const [result, formAction, pending] = useActionState(async (prev: ActionResult | null, form: FormData) => {
    const r = await action(prev, form);
    router.refresh();
    return r;
  }, null);
  return (
    <form action={formAction} className={className} key={resetOnSuccess && result?.ok ? JSON.stringify(result.data ?? {}) : undefined}>
      {children}
      <div className="mt-3">
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending ? "Working…" : submit}
        </button>
      </div>
      <ResultMessage result={result} />
    </form>
  );
}

/**
 * A form whose submit button needs two clicks ("Click again to …"), for a form that changes the night for good (the
 * draw, publishing a bulletin). Otherwise like ActionForm; the fields keep what was typed when the action is refused.
 */
export function ConfirmForm({
  action,
  children,
  submit,
  confirm,
  className = "",
  resetOnSuccess = false,
}: {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  children: ReactNode;
  submit: ReactNode;
  confirm: string;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [result, dispatch, pending] = useActionState(async (prev: ActionResult | null, form: FormData) => {
    const r = await action(prev, form);
    router.refresh();
    return r;
  }, null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <form
      className={className}
      key={resetOnSuccess && result?.ok ? JSON.stringify(result.data ?? {}) : undefined}
      onSubmit={(e) => {
        // The browser has checked the fields (required, pattern, maxLength) before this runs.
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        if (!armed) {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 5000);
          return;
        }
        setArmed(false);
        const form = new FormData(e.currentTarget);
        startTransition(() => dispatch(form));
      }}
    >
      {children}
      <div className="mt-3">
        <button type="submit" disabled={pending} className={armed ? buttonClass.danger : buttonClass.primary}>
          {pending ? "Working…" : armed ? confirm : submit}
        </button>
      </div>
      <ResultMessage result={result} />
    </form>
  );
}
