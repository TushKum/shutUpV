// Reads public.schema_version() as the service role (clients may not call it). Without the service key (a build
// that never runs the judge) the version is unknown, which is reported, never treated as "behind".

import "server-only";
import { supabaseService } from "@/lib/supabase/service";

export async function readSchemaVersion(): Promise<string | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const { data } = await supabaseService().rpc("schema_version");
    return typeof data === "string" ? data : null;
  } catch {
    return null;
  }
}
