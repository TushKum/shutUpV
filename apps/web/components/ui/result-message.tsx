// The result of an action (a game function): what was done, or why it was refused.

import type { ActionResult } from "@/lib/rpc";

export function ResultMessage({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  const text = result.message ?? (result.ok ? "Done." : result.code ?? "Refused.");
  return (
    <p role={result.ok ? "status" : "alert"} className={`mt-2 text-sm ${result.ok ? "text-emerald-700" : "text-red-700"}`}>
      {result.ok ? text : `${result.code && result.code !== "ERROR" && result.code !== "NOT_ALLOWED" ? `${result.code}: ` : ""}${text}`}
    </p>
  );
}
