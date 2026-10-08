// The local stack's settings, from .env.e2e (written by scripts/local-supabase.sh).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface E2eEnv {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  NEXT_PUBLIC_TEAM_EMAIL_DOMAIN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DATABASE_URL: string;
  CARD_SECRET: string;
  TEAM_EMAIL_DOMAIN: string;
}

export function e2eEnv(): E2eEnv {
  const file = join(__dirname, "..", "..", ".env.e2e");
  if (!existsSync(file)) throw new Error("apps/web/.env.e2e is missing: run scripts/local-supabase.sh first");
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out as unknown as E2eEnv;
}
