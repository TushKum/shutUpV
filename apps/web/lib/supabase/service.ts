// Supabase client acting as the service role, for server code that must bypass Row Level Security (the AI judge
// worker claims and reports runs with it). The key is server-only: never import this from a Client Component
// ("server-only" makes such an import a build error).

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/env";

let client: SupabaseClient | undefined;

export function supabaseService(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing environment variable SUPABASE_SERVICE_ROLE_KEY (see .env.example)");
  client ??= createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
