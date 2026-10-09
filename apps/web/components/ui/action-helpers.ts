// Pure helpers of the action components (kept apart so they can be unit-tested without React).

import type { ActionResult } from "@/lib/rpc";

/** A confirming click this soon after the first one is a double-click, not a second decision. */
export const CONFIRM_DELAY_MS = 500;

/**
 * The confirmation text of a form: `{name}` becomes the field's value, or its label from `values[name]` (for codes
 * such as CLEARED / DISQUALIFIED), so the second click confirms exactly what will be sent.
 */
export function confirmLabel(template: string, form: FormData, values: Record<string, Record<string, string>> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const raw = String(form.get(name) ?? "").trim();
    return values[name]?.[raw] ?? raw;
  });
}

/** The first chosen file larger than `maxBytes`, with a refusal to show instead of sending it. */
export function oversizedFile(form: FormData, maxBytes: number): ActionResult | null {
  for (const [, value] of form) {
    if (typeof value !== "string" && value.size > maxBytes) {
      const kb = (n: number) => Math.ceil(n / 1024).toLocaleString("en-IN");
      return { ok: false, code: "BAD_FILE", message: `The file is ${kb(value.size)} KB; the limit is ${kb(maxBytes)} KB.` };
    }
  }
  return null;
}

/** An action that throws (the connection dropped, or a chosen file changed on disk) becomes a refusal on the page. */
export async function safely(run: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await run();
  } catch {
    return {
      ok: false,
      code: "NOT_SENT",
      message: "The request did not reach the server (the connection dropped, or a chosen file changed since it was chosen). Check the page, then try again.",
    };
  }
}
