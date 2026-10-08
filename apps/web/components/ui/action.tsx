"use client";

// Buttons and forms that run a server action (a game function) and show its result. After any action the page
// re-fetches its data; realtime refreshes it again when the database broadcasts the change.

import { startTransition, useActionState, useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
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
 * click on the control panel never advances the night. The second click counts only for the confirmation it
 * showed: when a refresh changes the target (the next phase, the next round, Pause turned into Resume), the click
 * asks again for the new target, or does nothing on a button without a confirmation.
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
  const { armedFor, arm, disarm } = useArming();
  const [result, setResult] = useState<ActionResult | null>(null);
  const armed = confirm !== undefined && armedFor === confirm;
  const run = () => {
    if (armedFor !== null && confirm === undefined) {
      disarm(); // armed for something that is no longer on this button
      return;
    }
    if (confirm !== undefined && !armed) {
      arm(confirm);
      return;
    }
    disarm();
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

/**
 * A form whose fields go to a server action `(prev, formData) => result`. What was typed stays when the action is
 * refused; `resetOnSuccess` clears the fields after an accepted submission. With `confirm`, the submit button needs
 * two clicks; `{name}` in the text is replaced by the field's value ("Click again to extend by {minutes} min"), and
 * the second click counts only if the text is still the same (the fields or the target did not change).
 */
export function ActionForm({
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
  confirm?: string;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const { armedFor, arm, disarm } = useArming();
  // `accepted` counts accepted submissions; as the form's key it clears the fields only after one of them.
  const [{ result, accepted }, dispatch, pending] = useActionState<{ result: ActionResult | null; accepted: number }, FormData>(
    async (prev, form) => {
      const r = await action(prev.result, form);
      router.refresh();
      return { result: r, accepted: prev.accepted + (r.ok ? 1 : 0) };
    },
    { result: null, accepted: 0 },
  );
  return (
    <form
      className={className}
      key={resetOnSuccess ? accepted : 0}
      onSubmit={(e) => {
        // The browser has checked the fields (required, pattern, maxLength) before this runs. Submitting by hand
        // (not <form action>) keeps React from clearing the fields after a refusal.
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        if (confirm !== undefined) {
          const label = confirm.replace(/\{(\w+)\}/g, (_, name: string) => String(form.get(name) ?? "").trim());
          if (armedFor !== label) {
            arm(label);
            return;
          }
        }
        disarm();
        startTransition(() => dispatch(form));
      }}
    >
      {children}
      <div className="mt-3">
        <button type="submit" disabled={pending} className={armedFor !== null ? buttonClass.danger : buttonClass.primary}>
          {pending ? "Working…" : (armedFor ?? submit)}
        </button>
      </div>
      <ResultMessage result={result} />
    </form>
  );
}

/** A form whose submit button needs two clicks, for a form that changes the night for good (the draw, a bulletin). */
export function ConfirmForm(props: Parameters<typeof ActionForm>[0] & { confirm: string }) {
  return <ActionForm {...props} />;
}

/** The first click of a two-click action: remembers what it confirms, for 5 seconds. */
function useArming() {
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const disarm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setArmedFor(null);
  }, []);
  const arm = useCallback((label: string) => {
    if (timer.current) clearTimeout(timer.current);
    setArmedFor(label);
    timer.current = setTimeout(() => setArmedFor(null), 5000);
  }, []);
  return { armedFor, arm, disarm };
}
