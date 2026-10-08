"use client";

// A form whose submit button needs two clicks ("Click again to …"), for a form that changes the night for good
// (the draw, publishing a bulletin). Otherwise like ActionForm: the fields go to a server action
// `(prev, formData) => result`, the result is shown under the button and the page re-fetches its data. The fields
// keep what was typed when the action is refused, and are cleared after a success with `resetOnSuccess`.

import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/rpc";
import { ResultMessage } from "@/components/ui/action";
import { buttonClass } from "@/components/ui/ui";

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
