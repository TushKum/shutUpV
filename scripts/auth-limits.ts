// Shows Supabase Auth's rate limits exactly as the project has them, and (with --set) raises the two PRIMUS needs:
// sign-ups and sign-ins to 1000 and token refreshes to 1800 per 5 minutes. Uses no sign-ins.
//
//   SUPABASE_ACCESS_TOKEN=… pnpm auth-limits          (read)
//   SUPABASE_ACCESS_TOKEN=… pnpm auth-limits --set    (raise, then read back)
//
// SUPABASE_ACCESS_TOKEN is a personal access token: supabase.com/dashboard/account/tokens → Generate new token.
// It can manage every project of your account: keep it in .env only, never share it, delete it after the event.

import { parseArgs } from "./lib/args";
import { limitRows, projectRef, raiseAuthLimits, readAuthConfig } from "./lib/auth-limits";

function show(config: Record<string, unknown>): boolean {
  let allOk = true;
  for (const r of limitRows(config)) {
    const need = r.min !== null ? `needs ≥ ${r.min}` : "not used by PRIMUS";
    const mark = r.min === null ? " " : r.ok ? "✔" : "✘";
    if (!r.ok) allOk = false;
    console.log(`${mark} ${r.label.padEnd(28)} ${String(r.value ?? "—").padStart(6)}   (${r.field}; ${need})`);
  }
  return allOk;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const ref = projectRef(process.env.SUPABASE_URL ?? "");
  if (!ref) {
    console.log("SUPABASE_URL in .env is not a Supabase project URL (https://<ref>.supabase.co).");
    return 1;
  }
  if (!token) {
    console.log("Set SUPABASE_ACCESS_TOKEN in .env first: supabase.com/dashboard/account/tokens → Generate new token.");
    return 1;
  }
  let config = await readAuthConfig(token, ref);
  console.log(`Auth rate limits of ${ref} (per 5 minutes per IP address unless noted):\n`);
  let ok = show(config);
  if (args.set === true && !ok) {
    console.log("\nRaising the limits PRIMUS needs…\n");
    config = await raiseAuthLimits(token, ref, config);
    ok = show(config);
  }
  console.log(ok ? "\nThe limits are high enough for 600 people." : "\nToo low for 600 people: run pnpm auth-limits --set, or raise them in Authentication → Rate Limits.");
  return ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
