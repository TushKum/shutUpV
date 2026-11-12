"use client";

// Home shows the big round banner; every other page shows its one-line form, so the page's own work starts near the
// top of the screen. Both are rendered on the server; only the one for this page is mounted.

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

export function BannerFrame({ full, compact }: { full: ReactNode; compact: ReactNode }) {
  const path = usePathname();
  return <>{path === "/team" ? full : compact}</>;
}
