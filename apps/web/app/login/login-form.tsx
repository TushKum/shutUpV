"use client";

import { useActionState, useId, useState } from "react";
import { TRACK_LABELS, normalizeTeamCode, trackOfCode, type Track } from "@msim/engine";
import { signIn, type LoginState } from "./actions";

const PORTAL_PLACEHOLDER: Record<Track, string> = {
  PRODUCT: "P07",
  CONSULTING: "C07",
  FINANCE: "F07",
};

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.9 4.2A10.7 10.7 0 0 1 12 4c6.5 0 10 8 10 8a17.6 17.6 0 0 1-3.2 4.3" />
      <path d="M6.6 6.6A17.7 17.7 0 0 0 2 12s3.5 8 10 8a9.8 9.8 0 0 0 5.4-1.6" />
      <path d="M14.1 14.1a3 3 0 0 1-4.2-4.2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function LoginForm({ next, portal = null }: { next?: string; portal?: Track | null }) {
  const [mode, setMode] = useState<"team" | "staff">("team");
  const [submittedMode, setSubmittedMode] = useState<"team" | "staff">("team");
  const [typedCode, setTypedCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});

  const codeId = useId();
  const emailId = useId();
  const passwordId = useId();

  const teamLoginDefault = submittedMode === "team" ? state.login : undefined;
  const staffLoginDefault = submittedMode === "staff" ? state.login : undefined;
  const activeCode = typedCode || teamLoginDefault || "";
  const detectedTrack = activeCode ? trackOfCode(normalizeTeamCode(activeCode)) : null;
  const visibleError = mode === submittedMode ? state.error : undefined;
  const isStaff = mode === "staff";

  return (
    <form
      action={(formData) => {
        setSubmittedMode(mode);
        return action(formData);
      }}
      className="mx-login-form"
      noValidate
    >
      <input type="hidden" name="mode" value={mode} />
      {next && <input type="hidden" name="next" value={next} />}

      <div className="mx-login-toggle" role="group" aria-label="Sign-in mode">
        <button
          type="button"
          className="mx-login-tab"
          data-active={!isStaff}
          aria-pressed={!isStaff}
          onClick={() => setMode("team")}
        >
          Team
        </button>
        <button
          type="button"
          className="mx-login-tab"
          data-active={isStaff}
          aria-pressed={isStaff}
          onClick={() => setMode("staff")}
        >
          Organiser
        </button>
      </div>

      {!isStaff ? (
        <div className="mx-login-group">
          <div className="mx-login-label-row">
            <label htmlFor={codeId} className="mx-login-label">
              Team code
            </label>
            {detectedTrack && (
              <span className="mx-login-track-chip" data-track={detectedTrack}>
                {TRACK_LABELS[detectedTrack]}
              </span>
            )}
          </div>
          <div className="mx-login-field">
            <span className="mx-login-prefix" aria-hidden="true">
              &gt;
            </span>
            <input
              id={codeId}
              name="code"
              type="text"
              required
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
              placeholder={`e.g. ${portal ? PORTAL_PLACEHOLDER[portal] : "P07"}`}
              defaultValue={teamLoginDefault}
              onChange={(event) => setTypedCode(event.currentTarget.value)}
              className="mx-login-input mx-login-input--code"
            />
          </div>
        </div>
      ) : (
        <div className="mx-login-group">
          <div className="mx-login-label-row">
            <label htmlFor={emailId} className="mx-login-label">
              Email
            </label>
          </div>
          <div className="mx-login-field mx-login-field--staff">
            <span className="mx-login-prefix" aria-hidden="true">
              @
            </span>
            <input
              id={emailId}
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="lead@primus.org"
              defaultValue={staffLoginDefault}
              className="mx-login-input"
            />
          </div>
        </div>
      )}

      <div className="mx-login-group">
        <div className="mx-login-label-row">
          <label htmlFor={passwordId} className="mx-login-label">
            Password
          </label>
        </div>
        <div className={`mx-login-field ${isStaff ? "mx-login-field--staff" : ""}`}>
          <span className="mx-login-prefix" aria-hidden="true">
            #
          </span>
          <input
            id={passwordId}
            name="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            placeholder="••••••••••••"
            className="mx-login-input"
          />
          <button
            type="button"
            className="mx-login-eye"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            <EyeIcon open={showPassword} />
          </button>
        </div>
        {!isStaff && <p className="mx-login-hint">Case-insensitive · dashes optional</p>}
      </div>

      {visibleError && (
        <div role="alert" aria-live="polite" className="mx-login-alert mx-sys">
          {visibleError}
        </div>
      )}

      <button type="submit" disabled={pending} className={`mx-login-submit ${isStaff ? "mx-login-submit--staff" : ""}`}>
        {pending ? "Authenticating…" : "Sign in"}
      </button>
    </form>
  );
}
