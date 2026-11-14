// The database migration this build of the app needs (the newest file in supabase/migrations). /api/health and the
// control panel compare it with public.schema_version() to catch a migration that was not run.
export const EXPECTED_SCHEMA = "20261117000050";

export type SchemaState = "ok" | "behind" | "ahead" | "unknown";

/** "behind": the database misses migrations this app needs; "ahead": the app is older than the database. */
export function schemaState(db: string | null | undefined): SchemaState {
  if (!db || !/^\d{14}$/.test(db)) return "unknown";
  return db === EXPECTED_SCHEMA ? "ok" : db < EXPECTED_SCHEMA ? "behind" : "ahead";
}
