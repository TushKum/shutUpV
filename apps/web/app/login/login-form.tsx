"use client";

import { useActionState, useState } from "react";
import { signIn, type LoginState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<"team" | "staff">("team");
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});

  const tab = (m: "team" | "staff", label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`matrix-login-tab flex-1 rounded-md px-3 py-2 font-mono text-sm font-bold ${
        mode === m ? "matrix-login-tab-active bg-phosphor text-ink" : "matrix-login-tab-idle text-muted hover:text-phosphor"
      }`}
    >
      {label}
    </button>
  );

  return (
    <form action={action} className="space-y-4">
      <div className="matrix-login-tabs flex gap-1 rounded-lg border border-line bg-ink p-1">
        {tab("team", "Team")}
        {tab("staff", "Organiser")}
      </div>
      <input type="hidden" name="mode" value={mode} />
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {mode === "team" ? (
        <label className="block">
          <span className="font-mono text-sm font-bold text-phosphor-mid">Team code</span>
          <input
            name="code"
            defaultValue={mode === "team" ? state.login : undefined}
            required
            autoComplete="username"
            autoCapitalize="characters"
            placeholder="P07"
            className="matrix-login-input mt-1 block w-full rounded-md border border-phosphor-dim px-3 py-2 text-lg uppercase tracking-wider"
          />
        </label>
      ) : (
        <label className="block">
          <span className="font-mono text-sm font-bold text-phosphor-mid">Email</span>
          <input
            name="email"
            type="email"
            defaultValue={mode === "staff" ? state.login : undefined}
            required
            autoComplete="username"
            className="matrix-login-input mt-1 block w-full rounded-md border border-phosphor-dim px-3 py-2 text-lg"
          />
        </label>
      )}

      <label className="block">
        <span className="font-mono text-sm font-bold text-phosphor-mid">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder={mode === "team" ? "XXXX-XXXX-XXXX" : undefined}
          className="matrix-login-input mt-1 block w-full rounded-md border border-phosphor-dim px-3 py-2 font-mono text-lg tracking-wider"
        />
      </label>

      {state.error ? (
        <p role="alert" className="mx-sys rounded-md border border-danger/70 bg-danger/10 px-3 py-2 text-sm text-danger-soft">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="matrix-login-submit mx-key mx-key-solid w-full rounded-md px-4 py-3 text-base"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
