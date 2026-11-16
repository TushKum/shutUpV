// Supabase Auth's rate limits, read (and set) through the Management API with a personal access token, so they can be
// checked exactly instead of by burning sign-ins. Used by pnpm auth-limits and pnpm preflight.
//
// The API's field names and the dashboard's labels (Authentication → Rate Limits):
//   rate_limit_otp            "sign-ups and sign-ins"   per 5 minutes per IP   (password sign-ins)
//   rate_limit_token_refresh  "token refreshes"         per 5 minutes per IP
//   rate_limit_verify         "token verifications"     per 5 minutes per IP
//   rate_limit_anonymous_users, rate_limit_email_sent, rate_limit_sms_sent, rate_limit_web3: not used by PRIMUS
// Every rate_limit_* field the API returns is shown, so a field named differently is still visible.

export const MANAGEMENT_API = "https://api.supabase.com/v1";

/** What 600 people need: sign-ins at check-in (from a few shared addresses) and every phone refreshing its session. */
export const RECOMMENDED: Record<string, { label: string; min: number }> = {
  rate_limit_otp: { label: "sign-ups and sign-ins", min: 1000 },
  rate_limit_token_refresh: { label: "token refreshes", min: 1800 },
};

const LABELS: Record<string, string> = {
  rate_limit_otp: "sign-ups and sign-ins",
  rate_limit_token_refresh: "token refreshes",
  rate_limit_verify: "token verifications",
  rate_limit_anonymous_users: "anonymous users",
  rate_limit_email_sent: "sending emails",
  rate_limit_sms_sent: "sending SMS messages",
  rate_limit_web3: "Web3 sign-ups and sign-ins",
};

/** The project reference of a Supabase URL (https://<ref>.supabase.co), or null. */
export function projectRef(supabaseUrl: string): string | null {
  try {
    const host = new URL(supabaseUrl).host;
    const m = /^([a-z0-9]{20})\.supabase\.(co|in)$/.exec(host);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

export interface LimitRow {
  field: string;
  label: string;
  value: number | null;
  /** The minimum PRIMUS needs, when it needs one. */
  min: number | null;
  ok: boolean;
}

/** Every rate_limit_* field of an Auth config, the two PRIMUS needs first, each checked against its minimum. */
export function limitRows(config: Record<string, unknown>): LimitRow[] {
  const fields = new Set([...Object.keys(RECOMMENDED), ...Object.keys(config).filter((k) => k.startsWith("rate_limit_"))]);
  const rows = [...fields].map((field) => {
    const raw = config[field];
    const value = typeof raw === "number" ? raw : raw == null ? null : Number(raw);
    const min = RECOMMENDED[field]?.min ?? null;
    return { field, label: LABELS[field] ?? field.replace(/^rate_limit_/, "").replaceAll("_", " "), value: Number.isFinite(value) ? value : null, min, ok: min === null || (value !== null && value >= min) };
  });
  const rank = (r: LimitRow) => (r.min !== null ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || a.field.localeCompare(b.field));
}

async function call(token: string, ref: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const r = await fetch(`${MANAGEMENT_API}/projects/${ref}/config/auth`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": "primus-auth-limits", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  if (!r.ok) {
    const why = r.status === 401 ? "the access token was refused (create a new one)" : r.status === 403 ? "this token's account cannot manage the project" : r.status === 404 ? "no such project for this token" : `HTTP ${r.status}`;
    throw new Error(`Supabase Management API: ${why}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

export const readAuthConfig = (token: string, ref: string) => call(token, ref);

/** Raises the two limits PRIMUS needs to at least their minimum (never lowers a higher value); returns the new config. */
export async function raiseAuthLimits(token: string, ref: string, current: Record<string, unknown>): Promise<Record<string, unknown>> {
  const body: Record<string, number> = {};
  for (const [field, { min }] of Object.entries(RECOMMENDED)) {
    const v = Number(current[field]);
    if (!(Number.isFinite(v) && v >= min)) body[field] = min;
  }
  if (Object.keys(body).length) await call(token, ref, { method: "PATCH", body: JSON.stringify(body) });
  return readAuthConfig(token, ref);
}
