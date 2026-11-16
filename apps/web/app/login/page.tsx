import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { safeNext } from "@/lib/auth/routes";
import { LoginForm } from "./login-form";
import { SonicWaveformCanvas } from "@/components/ui/sonic-waveform";
import { LoginHero } from "./login-hero";
import { CipherText } from "@/components/ui/matrix/cipher-text";
import { DitherLayer } from "@/components/ui/matrix/dither-layer";
import { PORTAL_TITLES, teamPortal } from "@/lib/portal/portal";
import { TEAM_CODE_RE, TRACK_LABELS, normalizeTeamCode } from "@msim/engine";

export const metadata: Metadata = { title: "Sign in · PRIMUS" };
// A sign-in during a check-in rush may wait for Supabase's rate limit to refill (lib/auth/retry.ts, about 12 s at
// most): give the sign-in action room for that on every plan.
export const maxDuration = 30;

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, code } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  // The QR code on a login card opens /login?code=P07: the team code is filled in and only the password is typed.
  const cardCode = typeof code === "string" ? normalizeTeamCode(code) : "";
  const prefill = TEAM_CODE_RE.test(cardCode) ? cardCode : undefined;
  const viewer = await getViewer();
  const portal = await teamPortal();
  if (viewer) redirect(safeNext(nextPath, viewer.role));

  return (
    <main className="terminal-container terminal-theme-scope relative min-h-dvh bg-black">
      {/* The backdrop: the waveform in PRIMUS green (it settles to a still picture for reduced motion), darkened
          towards the bottom so the card always reads. */}
      <SonicWaveformCanvas className="fixed" rgb="0, 255, 65" lineCount={48} />
      <div aria-hidden className="pointer-events-none fixed inset-0 z-10 bg-gradient-to-t from-black via-black/50 to-black/20" />
      <div aria-hidden className="mx-crt" />
      <div className="relative z-20 mx-auto grid min-h-dvh w-full max-w-5xl items-center gap-6 px-4 py-8 sm:gap-8 sm:py-10 lg:grid-cols-[1.15fr_1fr] lg:gap-12">
        <LoginHero portal={portal} />
        <div className="mx-panel glow-box relative mx-auto w-full max-w-sm overflow-hidden rounded-xl">
          <div className="relative h-3 border-b border-line">
            <DitherLayer from="top" opacity={0.7} />
          </div>
          <div className="p-6">
            <p aria-hidden className="font-mono text-xs text-phosphor-mid">
              &gt; wake up, trader…
            </p>
            <h2 className="mx-cursor mt-1 text-2xl font-bold text-phosphor glow">
              <CipherText text={portal ? PORTAL_TITLES[portal] : "Sign in"} duration={900} />
            </h2>
            <p className="mb-6 mt-2 text-base text-paper">
              {portal
                ? `For ${TRACK_LABELS[portal]} teams. Sign in with the team code and password on your card.`
                : "Sign in with the team code and password on your card."}
            </p>
            <LoginForm next={nextPath} code={prefill} />
          </div>
        </div>
      </div>
    </main>
  );
}
