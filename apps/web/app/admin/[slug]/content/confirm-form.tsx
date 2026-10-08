"use client";

// A form whose submit button needs two clicks ("Click again to …"), for a form that changes the night for good
// (the draw, publishing a bulletin). Same behaviour as ActionForm otherwise: the fields go to a server action
// `(prev, formData) => result`, the result is shown under the button and the page re-fetches its data.

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
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
  const [result, formAction, pending] = useActionState(async (prev: ActionResult | null, form: FormData) => {
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
    <form action={formAction} className={className} key={resetOnSuccess && result?.ok ? JSON.stringify(result.data ?? {}) : undefined}>
      {children}
      <div className="mt-3">
        <button
          type="submit"
          disabled={pending}
          className={armed ? buttonClass.danger : buttonClass.primary}
          onClick={(e) => {
            if (armed) {
              setArmed(false);
              return; // the second click submits
            }
            e.preventDefault();
            if (e.currentTarget.form && !e.currentTarget.form.reportValidity()) return;
            setArmed(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setArmed(false), 5000);
          }}
        >
          {pending ? "Working…" : armed ? confirm : submit}
        </button>
      </div>
      <ResultMessage result={result} />
    </form>
  );
}
