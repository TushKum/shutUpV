"use server";

import { redirect } from "next/navigation";
import { TEAM_CODE_RE, normalizePassword, normalizeTeamCode, teamEmail } from "@msim/engine";
import { teamEmailDomain } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth/viewer";
import { safeNext } from "@/lib/auth/routes";

export interface LoginState {
  error?: string;
  /** Echoed back so the field is not cleared after a failed attempt. */
  login?: string;
}

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const mode = form.get("mode") === "staff" ? "staff" : "team";
  let email: string;
  let password: string;

  if (mode === "team") {
    const code = normalizeTeamCode(String(form.get("code") ?? ""));
    if (!TEAM_CODE_RE.test(code)) return { error: "Enter the team code printed on your card, for example P07.", login: code };
    email = teamEmail(code, teamEmailDomain());
    password = normalizePassword(String(form.get("password") ?? ""));
  } else {
    email = String(form.get("email") ?? "").trim().toLowerCase();
    password = String(form.get("password") ?? "");
    if (!email.includes("@")) return { error: "Enter your organiser email address.", login: email };
  }
  const login = mode === "team" ? normalizeTeamCode(String(form.get("code") ?? "")) : email;
  if (!password) return { error: "Enter your password.", login };

  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    const wrongCredentials = error.status === 400 || error.code === "invalid_credentials";
    // The real cause stays on the server (the host's logs), never on the screen: a wrong key or address in the site's
    // settings shows here as a 401 or a network error.
    if (!wrongCredentials) console.error(`sign-in failed: status ${error.status ?? "none"}, code ${error.code ?? "none"}, ${error.message}`);
    return {
      login,
      error:
        error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : !wrongCredentials
            ? "The login service cannot be reached. Try again in a moment; if it keeps failing, go to the technical support desk."
            : mode === "team"
              ? "That team code and password do not match. Check your card."
              : "That email and password do not match.",
    };
  }

  const viewer = await getViewer(sb);
  if (!viewer) {
    await sb.auth.signOut();
    return { error: "This login is not set up for the event. Please go to the technical support desk.", login };
  }
  // A team signing in from the sign-in page itself opens on the PRIMUS welcome screen; one sent here from a page
  // (its session had expired) goes straight back to that page.
  redirect(viewer.role === "TEAM" && !form.get("next") ? "/welcome" : safeNext(form.get("next"), viewer.role));
}

export async function signOut(): Promise<void> {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}
