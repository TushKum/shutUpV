"use server";

// Access: an organiser makes another person an organiser, resets a staff member's password, or removes their access.
// The login is created with the service key on this server; the database checks that the person asking is an
// organiser and records every change. A new password is shown once, here, and stored nowhere else.

import { randomInt } from "node:crypto";
import { PASSWORD_ALPHABET } from "@msim/engine";
import { getViewer } from "@/lib/auth/viewer";
import { supabaseService } from "@/lib/supabase/service";
import type { ActionResult } from "@/lib/rpc";

function newPassword(): string {
  const c = () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  const block = () => Array.from({ length: 4 }, c).join("");
  return `${block()}-${block()}-${block()}`;
}

async function organiser(): Promise<string | null> {
  const v = await getViewer();
  return v && v.role === "ORGANISER" ? v.userId : null;
}

const refused: ActionResult = { ok: false, code: "NOT_ALLOWED", message: "Only an organiser can change who has access." };

export async function addOrganiser(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const by = await organiser();
  if (!by) return refused;
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!name || name.length > 80) return { ok: false, code: "BAD_NAME", message: "Give the person's name (1 to 80 characters)." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, code: "BAD_EMAIL", message: "Give a valid email address." };
  const sb = supabaseService();
  const password = newPassword();
  const created = await sb.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { msim_role: "ORGANISER" } });
  if (created.error || !created.data.user) {
    const taken = /already|registered|exists/i.test(created.error?.message ?? "");
    return { ok: false, code: taken ? "EXISTS" : "ERROR", message: taken ? "That email already has a login." : `Could not create the login: ${created.error?.message}` };
  }
  const { data, error } = await sb.rpc("add_organiser", { p_user: created.data.user.id, p_name: name, p_by: by });
  if (error || !data?.ok) {
    await sb.auth.admin.deleteUser(created.data.user.id);
    return { ok: false, code: data?.code ?? "ERROR", message: data?.message ?? error?.message ?? "Could not give access." };
  }
  return {
    ok: true,
    message: `${name} is now an organiser. Sign-in email: ${email} · password: ${password} — give it to them in person; it is not shown again.`,
  };
}

export async function resetPassword(userId: string, email: string): Promise<ActionResult> {
  const by = await organiser();
  if (!by) return refused;
  const sb = supabaseService();
  const { data: logged, error: logError } = await sb.rpc("log_password_reset", { p_user: userId, p_by: by });
  if (logError || !logged?.ok) return { ok: false, code: logged?.code ?? "ERROR", message: logged?.message ?? logError?.message ?? "Could not reset." };
  const password = newPassword();
  const { error } = await sb.auth.admin.updateUserById(userId, { password });
  if (error) return { ok: false, code: "ERROR", message: `Could not reset the password: ${error.message}` };
  return { ok: true, message: `New password for ${email}: ${password} — give it to them in person; it is not shown again.` };
}

export async function removeAccess(userId: string): Promise<ActionResult> {
  const by = await organiser();
  if (!by) return refused;
  const sb = supabaseService();
  const { data, error } = await sb.rpc("remove_staff", { p_user: userId, p_by: by });
  if (error || !data?.ok) return { ok: false, code: data?.code ?? "ERROR", message: data?.message ?? error?.message ?? "Could not remove access." };
  // Their login goes too, so the email can be given access again later.
  await sb.auth.admin.deleteUser(userId);
  return { ok: true, message: "Access removed: that login no longer works." };
}
