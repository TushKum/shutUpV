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
      className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${
        mode === m ? "bg-white text-slate-900 shadow" : "text-slate-600 hover:text-slate-900"
      }`}
    >
      {label}
    </button>
  );

  return (
    <form action={action} className="space-y-4">
      <div className="flex gap-1 rounded-lg bg-slate-200 p-1">
        {tab("team", "Team")}
        {tab("staff", "Organiser")}
      </div>
      <input type="hidden" name="mode" value={mode} />
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {mode === "team" ? (
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Team code</span>
          <input
            name="code"
            defaultValue={mode === "team" ? state.login : undefined}
            required
            autoComplete="username"
            autoCapitalize="characters"
            placeholder="P07"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-lg uppercase tracking-wider"
          />
        </label>
      ) : (
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Email</span>
          <input
            name="email"
            type="email"
            defaultValue={mode === "staff" ? state.login : undefined}
            required
            autoComplete="username"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-lg"
          />
        </label>
      )}

      <label className="block">
        <span className="text-sm font-medium text-slate-700">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder={mode === "team" ? "XXXX-XXXX-XXXX" : undefined}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-lg tracking-wider"
        />
      </label>

      {state.error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-slate-900 px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
