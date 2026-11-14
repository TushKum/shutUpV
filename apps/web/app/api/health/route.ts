// GET /api/health: is the app up, can it reach the database, and has the database every migration this build needs? Public, never cached, says nothing about any event.
// The keep-alive job (.github/workflows/keep-alive.yml) calls it every 10 minutes: that keeps a free Render server
// from going to sleep, and the database query keeps a free Supabase project from being paused for inactivity.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { EXPECTED_SCHEMA, schemaState, type SchemaState } from "@/lib/schema";
import { readSchemaVersion } from "@/lib/schema-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let database: "ok" | "down" = "down";
  let schema: SchemaState = "unknown";
  let schemaVersion: string | null = null;
  try {
    const sb = await supabaseServer();
    // Which migration the database is at (public.schema_version, migration 50 on): "behind" means a migration this
    // build needs was not run.
    schemaVersion = await readSchemaVersion();
    schema = schemaState(schemaVersion);
    // A real query. A signed-out caller may not read events, so Postgres refuses it with a code (42501): that refusal
    // still comes from the database, so it is up. Only a failure with no database code (the network) means down.
    const { error } = await sb.from("events").select("id").limit(1);
    database = !error || (typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)) ? "ok" : "down";
    if (database === "down") console.error("health: database:", error?.message);
  } catch (e) {
    console.error("health: database:", e);
    database = "down";
  }
  return NextResponse.json(
    { app: "ok", database, schema, schemaVersion, expectedSchema: EXPECTED_SCHEMA, ms: Date.now() - started, at: new Date().toISOString() },
    { status: database === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
