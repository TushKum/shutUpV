// Public configuration (safe in the browser). Server secrets are read where they are used.

function need(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

export const supabaseUrl = () => need("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);

/** The anon (publishable) key: it only grants what RLS allows to signed-in users. */
export const supabaseAnonKey = () =>
  need(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

/** Domain of the synthetic team login emails; must match TEAM_EMAIL_DOMAIN used by the seed script. */
export const teamEmailDomain = () =>
  need("NEXT_PUBLIC_TEAM_EMAIL_DOMAIN", process.env.NEXT_PUBLIC_TEAM_EMAIL_DOMAIN);
