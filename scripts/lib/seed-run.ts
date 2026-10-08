// Creates the logins of a seed plan through the Supabase Auth admin API and seeds the event. Shared by the
// seed script and the end-to-end tests.

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { toSeedPayload, type SeedPlan } from "./seed-plan";

async function allUsers(sb: SupabaseClient): Promise<Map<string, User>> {
  const users = new Map<string, User>();
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email) users.set(u.email.toLowerCase(), u);
    if (data.users.length < 1000) return users;
  }
}

/** Creates missing logins and resets existing ones to the derived password. Returns email → user id. */
export async function ensureLogins(sb: SupabaseClient, plan: SeedPlan): Promise<Map<string, string>> {
  const existing = await allUsers(sb);
  const wanted = [
    ...plan.teams.map((t) => ({ email: t.email, password: t.password, role: "TEAM" })),
    ...plan.staff.map((s) => ({ email: s.email, password: s.password, role: s.role })),
  ];
  const ids = new Map<string, string>();
  let created = 0;
  let updated = 0;
  const update = async (w: (typeof wanted)[number], user: User) => {
    const { error } = await sb.auth.admin.updateUserById(user.id, {
      password: w.password,
      app_metadata: { msim_role: w.role },
    });
    if (error) throw new Error(`update ${w.email}: ${error.message}`);
    ids.set(w.email, user.id);
    updated++;
  };
  // Small batches keep well inside the Auth admin rate limits.
  for (let i = 0; i < wanted.length; i += 10) {
    await Promise.all(
      wanted.slice(i, i + 10).map(async (w) => {
        const user = existing.get(w.email);
        if (user) return update(w, user);
        const { data, error } = await sb.auth.admin.createUser({
          email: w.email,
          password: w.password,
          email_confirm: true,
          app_metadata: { msim_role: w.role },
        });
        if (!error && data.user) {
          ids.set(w.email, data.user.id);
          created++;
          return;
        }
        // Another seeding run (browser tests seed in parallel and share the staff logins) may have created it
        // since the list was read.
        const now = (await allUsers(sb)).get(w.email);
        if (!now) throw new Error(`create ${w.email}: ${error?.message}`);
        return update(w, now);
      }),
    );
  }
  if (process.env.SEED_QUIET !== "1") console.log(`Logins: ${created} created, ${updated} refreshed`);
  return ids;
}

/** Logins first, then the event in one transaction (seed_event). With `replace`, an event still in SETUP (or any
 * rehearsal) of the same slug is purged first. Returns the event id and email → user id. */
export async function seedWithLogins(sb: SupabaseClient, plan: SeedPlan, { replace = false } = {}) {
  const ids = await ensureLogins(sb, plan);
  if (replace) {
    const { error } = await sb.rpc("purge_event", { p_slug: plan.event.slug });
    if (error) throw new Error(`purge_event: ${error.message}`);
  }
  const { data: eventId, error } = await sb.rpc("seed_event", { p: toSeedPayload(plan, ids) });
  if (error) throw new Error(`seed_event: ${error.message}`);
  return { eventId: eventId as string, ids };
}
