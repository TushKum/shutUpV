"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

let client: ReturnType<typeof createBrowserClient> | undefined;

/** One client per tab: reads public data through RLS and holds the realtime connection. */
export function supabaseBrowser() {
  client ??= createBrowserClient(supabaseUrl(), supabaseAnonKey());
  return client;
}
