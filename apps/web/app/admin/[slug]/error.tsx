"use client";

// Anything a section throws (a read that failed, the connection dropping mid-render) shows here, inside the control
// panel: the header, the tabs and the clock stay, and the section can be tried again.

import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { Notice, Panel, buttonClass } from "@/components/ui/ui";

export default function SectionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  return (
    <Panel title="This section could not load">
      <Notice tone="red">
        {error.message || "Something went wrong."}
        {error.digest ? <span className="ml-1 font-mono text-xs">({error.digest})</span> : null}
      </Notice>
      <p className="mt-3 text-sm text-slate-600">The night goes on in the database; nothing was changed by this error. Try again, or open another section.</p>
      <button
        type="button"
        className={`${buttonClass.primary} mt-3`}
        onClick={() =>
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
      >
        Try again
      </button>
    </Panel>
  );
}
