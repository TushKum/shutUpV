import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { safeNext } from "@/lib/auth/routes";
import { LoginForm } from "./login-form";
import { MatrixRain } from "@/components/ui/matrix/matrix-rain";
import { CipherText } from "@/components/ui/matrix/cipher-text";
import { DitherLayer } from "@/components/ui/matrix/dither-layer";
import { PORTAL_TITLES, teamPortal } from "@/lib/portal/portal";
import { TRACK_LABELS } from "@msim/engine";

export const metadata: Metadata = { title: "Sign in · Market Simulation" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  const viewer = await getViewer();
  const portal = await teamPortal();
  if (viewer) redirect(safeNext(nextPath, viewer.role));

  return (
    <main className="terminal-container terminal-theme-scope flex min-h-dvh items-center justify-center px-4 py-10">
      {/* The rain and the CRT layer are the backdrop; the sign-in card is opaque, so no glyph runs under its text. */}
      <MatrixRain opacity={0.35} />
      <div aria-hidden className="mx-crt" />
      <div className="mx-panel glow-box relative w-full max-w-sm overflow-hidden rounded-xl">
        <div className="relative h-3 border-b border-line">
          <DitherLayer from="top" opacity={0.7} />
        </div>
        <div className="p-6">
          <p aria-hidden className="font-mono text-xs text-phosphor-mid">
            &gt; wake up, trader…
          </p>
          <h1 className="mx-cursor mt-1 text-2xl font-bold text-phosphor glow">
            <CipherText text={portal ? `PRIMUS · ${PORTAL_TITLES[portal]}` : "Market Simulation"} duration={900} />
          </h1>
          <p className="mb-6 mt-2 text-base text-paper">
            {portal
              ? `For ${TRACK_LABELS[portal]} teams. Sign in with the team code and password on your card.`
              : "Sign in with the team code and password on your card."}
          </p>
          <LoginForm next={nextPath} />
        </div>
      </div>
    </main>
  );
}
