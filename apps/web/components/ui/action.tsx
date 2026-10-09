"use client";

// Buttons and forms that run a server action (a game function) and show its result. After any action the page
// re-fetches its data; realtime refreshes it again when the database broadcasts the change.

import { startTransition, useActionState, useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/rpc";
import { buttonClass } from "./ui";
import { CONFIRM_DELAY_MS, confirmLabel, oversizedFile, safely } from "./action-helpers";

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
 * asks again for the new target, or does nothing on a button without a confirmation. A double-click is not two
 * decisions: a confirming click within half a second of the first is ignored.
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
  const { armedFor, arm, disarm, tooSoon, cooling } = useArming();
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
    if (armed && tooSoon()) return;
    disarm();
    start(async () => {
      const r = await safely(action);
      setResult(r);
      router.refresh();
    });
  };
  return (
    <div className="inline-block">
      <button type="button" onClick={run} disabled={disabled || pending || (armed && cooling)} title={title} className={armed ? buttonClass.danger : buttonClass[variant]}>
        {pending ? "Working…" : armed ? confirm : children}
      </button>
      <ResultMessage result={result} />
    </div>
  );
}

/**
 * A form whose fields go to a server action `(prev, formData) => result`. What was typed stays when the action is
 * refused; `resetOnSuccess` clears the fields after an accepted submission. With `confirm`, the submit button needs
 * two clicks; `{name}` in the text is replaced by the field's value, or by its label in `confirmValues` ("Click
 * again to extend by {minutes} min"), and the second click counts only if the text is still the same (the fields or
 * the target did not change). `maxFileBytes` refuses a chosen file that is too large before it is sent.
 */
export function ActionForm({
  action,
  children,
  submit,
  confirm,
  confirmValues,
  maxFileBytes,
  className = "",
  resetOnSuccess = false,
}: {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  children: ReactNode;
  submit: ReactNode;
  confirm?: string;
  confirmValues?: Record<string, Record<string, string>>;
  maxFileBytes?: number;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const { armedFor, arm, disarm, tooSoon, cooling } = useArming();
  const [local, setLocal] = useState<ActionResult | null>(null);
  // `accepted` counts accepted submissions; as the form's key it clears the fields only after one of them.
  const [{ result, accepted }, dispatch, pending] = useActionState<{ result: ActionResult | null; accepted: number }, FormData>(
    async (prev, form) => {
      const r = await safely(() => action(prev.result, form));
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
        const tooBig = maxFileBytes === undefined ? null : oversizedFile(form, maxFileBytes);
        setLocal(tooBig);
        if (tooBig) {
          disarm();
          return;
        }
        if (confirm !== undefined) {
          const label = confirmLabel(confirm, form, confirmValues);
          if (armedFor !== label) {
            arm(label);
            return;
          }
          if (tooSoon()) return;
        }
        disarm();
        startTransition(() => dispatch(form));
      }}
    >
      {children}
      <div className="mt-3">
        <button type="submit" disabled={pending || (armedFor !== null && cooling)} className={armedFor !== null ? buttonClass.danger : buttonClass.primary}>
          {pending ? "Working…" : (armedFor ?? submit)}
        </button>
      </div>
      <ResultMessage result={local ?? result} />
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
  const armedAt = useRef(0);
  // Disabled for a moment after the first click, so the second click of a double-click lands on nothing.
  const [cooling, setCooling] = useState(false);
  const coolTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (coolTimer.current) clearTimeout(coolTimer.current);
    },
    [],
  );
  const disarm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (coolTimer.current) clearTimeout(coolTimer.current);
    setCooling(false);
    setArmedFor(null);
  }, []);
  const arm = useCallback((label: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (coolTimer.current) clearTimeout(coolTimer.current);
    armedAt.current = Date.now();
    setArmedFor(label);
    setCooling(true);
    coolTimer.current = setTimeout(() => setCooling(false), CONFIRM_DELAY_MS);
    timer.current = setTimeout(() => setArmedFor(null), 5000);
  }, []);
  const tooSoon = useCallback(() => Date.now() - armedAt.current < CONFIRM_DELAY_MS, []);
  return { armedFor, arm, disarm, tooSoon, cooling };
}
