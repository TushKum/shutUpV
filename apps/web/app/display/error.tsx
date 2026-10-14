"use client";

// Anything the big screen throws while reading (event, status, board, a takeover) lands here, and the screen keeps
// trying again on its own: a projector must never stay on an error page until someone reloads it.

import { RetryScreen } from "@/components/retry-screen";

export default function DisplayError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RetryScreen {...props} />;
}
