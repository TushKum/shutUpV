import Image from "next/image";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TRACK_LABELS } from "@msim/engine";
import { getViewer } from "@/lib/auth/viewer";
import { safeNext } from "@/lib/auth/routes";
import { PORTAL_TITLES, teamPortal } from "@/lib/portal/portal";
import { CipherText } from "@/components/ui/matrix/cipher-text";
import { LoginForm } from "./login-form";
import { MatrixRain } from "./matrix-rain";
import "./login.css";

export const metadata: Metadata = { title: "Enter PRIMUS · Market Simulation" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  const viewer = await getViewer();
  const portal = await teamPortal();
  if (viewer) redirect(safeNext(nextPath, viewer.role));

  const accentTitle = portal ? PORTAL_TITLES[portal] : "simulation.";

  return (
    <main className="mx-login-shell">
      <MatrixRain />
      <div className="mx-login-atmosphere" aria-hidden="true" />
      <div className="mx-login-vignette" aria-hidden="true" />

      <div className="mx-login-layout">
        <section className="mx-login-editorial" aria-label="PRIMUS overview">
          <div className="mx-login-brand-row">
            <Image src="/primus-logo-light.svg" alt="PRIMUS" width={337} height={125} priority className="mx-login-logo" />
            <span className="mx-login-pill">
              <i className="mx-login-pill-dot" aria-hidden="true" />
              {portal ? `${TRACK_LABELS[portal]} PORTAL` : "FLOOR ONLINE"}
            </span>
          </div>

          <div>
            <p className="mx-login-hero-kicker">{"PRIMUS // MARKET SIMULATION 2026"}</p>
            <h1 className="mx-login-hero-title">
              {portal ? "Connect to" : "Enter the"}
              <span className="mx-login-hero-accent">
                <CipherText text={accentTitle} duration={650} />
              </span>
            </h1>
          </div>

          <p className="mx-login-hero-copy">
            {portal
              ? `Dedicated access for ${TRACK_LABELS[portal]} desks. Enter the team code and passphrase issued on your table card.`
              : "Three competitive desks—Product, Consulting, and Finance—trading inside one live synthetic economy."}
          </p>

          <div className="mx-login-desks" aria-label="Simulation tracks">
            <div className="mx-login-desk mx-login-desk--product">
              <span className="mx-login-desk-dot" aria-hidden="true" />
              <span className="mx-login-desk-num">01</span>
              <span className="mx-login-desk-name">Product</span>
            </div>
            <div className="mx-login-desk mx-login-desk--consulting">
              <span className="mx-login-desk-dot" aria-hidden="true" />
              <span className="mx-login-desk-num">02</span>
              <span className="mx-login-desk-name">Consulting</span>
            </div>
            <div className="mx-login-desk mx-login-desk--finance">
              <span className="mx-login-desk-dot" aria-hidden="true" />
              <span className="mx-login-desk-num">03</span>
              <span className="mx-login-desk-name">Finance</span>
            </div>
          </div>
        </section>

        <section className="mx-login-card-wrap" aria-label="PRIMUS sign in">
          <header className="mx-login-mobile-brand">
            <Image src="/primus-logo-light.svg" alt="PRIMUS" width={337} height={125} priority className="mx-login-logo" />
            <p className="mx-login-hero-kicker">{"MARKET SIMULATION // 2026"}</p>
          </header>

          <div className="mx-login-card">
            <div className="mx-login-card-head">
              <span className="mx-login-session-tag">{portal ? TRACK_LABELS[portal] : "Access Terminal"}</span>
              <span className="mx-login-node-badge">
                <i className="mx-login-node-dot" aria-hidden="true" />
                LIVE
              </span>
            </div>

            <div className="mx-login-card-intro">
              <h2 className="mx-login-card-title">Sign in to your desk</h2>
              <p className="mx-login-card-subtitle">
                {portal
                  ? `Use your ${TRACK_LABELS[portal]} card credentials to connect.`
                  : "Enter the team code and password printed on your card."}
              </p>
            </div>

            <LoginForm next={nextPath} portal={portal} />

            <div className="mx-login-footer">
              <span>ENCRYPTED SESSION</span>
              <span>LOST CARD? CONTROL DESK</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
