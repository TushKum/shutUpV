"use client";

// The last net for an error no section catches (for example the sign-in check of an area's layout failing to read
// the account). The big screen retries on its own; anywhere else the person can try again.

import { usePathname } from "next/navigation";
import { RetryScreen } from "@/components/retry-screen";
import { buttonClass } from "@/components/ui/ui";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const path = usePathname();
  if (path?.startsWith("/display")) return <RetryScreen error={error} retry={retry} />;
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-bold">This page could not load</h1>
      <p className="mt-2 text-slate-600">Nothing was changed. Try again in a moment.</p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-slate-500">{error.digest}</p> : null}
      <button type="button" onClick={() => retry()} className={`${buttonClass.primary} mt-4`}>
        Try again
      </button>
    </main>
  );
}
