import Image from "next/image";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { safeNext } from "@/lib/auth/routes";
import { LoginForm } from "./login-form";
import { MatrixRain } from "./matrix-rain";
import { PORTAL_TITLES, teamPortal } from "@/lib/portal/portal";
import { TRACK_LABELS } from "@msim/engine";
import "./matrix-login.module.css";

export const metadata: Metadata = { title: "Enter PRIMUS · Market Simulation" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  const viewer = await getViewer();
  const portal = await teamPortal();
  if (viewer) redirect(safeNext(nextPath, viewer.role));

  return (
    <main className="matrix-cinematic-login">
      <MatrixRain />
      <div className="matrix-cinematic-vignette" aria-hidden="true" />
      <div className="matrix-cinematic-scanlines" aria-hidden="true" />
      <section className="matrix-logo-intro" aria-hidden="true">
        <div className="matrix-intro-sweep" />
        <div className="matrix-intro-noise" />
        <Image src="/primus-logo-light.svg" alt="" width={760} height={275} priority className="matrix-intro-wordmark" />
        <p className="matrix-intro-status">PRIMUS NETWORK <span>//</span> INITIALISING</p>
      </section>
      <section className="matrix-login-stage" aria-label="PRIMUS sign in">
        <div className="matrix-login-card">
          <div className="matrix-card-topline">
            <span><i /> SECURE ACCESS NODE</span><span>PRIMUS · 2026</span>
          </div>
          <div className="matrix-card-heading">
            <p className="matrix-terminal-prompt">&gt; wake up, trader<span className="matrix-cursor">_</span></p>
            <h1>{portal ? `PRIMUS · ${PORTAL_TITLES[portal]}` : "Enter the simulation"}<span>.</span></h1>
            <p>{portal ? `For ${TRACK_LABELS[portal]} teams. Sign in with the credentials issued on your card.` : "Sign in with the team code and password on your card."}</p>
          </div>
          <LoginForm next={nextPath} />
          <div className="matrix-card-footer">
            <span>ENCRYPTED CONNECTION</span><span>CONTACT ORGANISER FOR SUPPORT</span>
          </div>
        </div>
        <p className="matrix-stage-caption"><i /> THE GAME IS LIVE <span>·</span> EVERY DECISION CONNECTS</p>
      </section>
    </main>
  );
}
