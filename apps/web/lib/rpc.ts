// Calls a game function as the signed-in user (RLS and SECURITY DEFINER checks apply exactly as for any client).
// Every result is normalised to { ok, code, message, data }: a refusal from the game ({ok: false, code}) and an
// exception raised by the database (permission, validation) look the same to the screens.

import { supabaseServer } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  code?: string;
  message?: string;
  data?: Record<string, unknown>;
}

interface RpcError {
  message: string;
  code?: string;
}

/** Pure: turns a PostgREST rpc response into an ActionResult. */
export function toResult(data: unknown, error: RpcError | null): ActionResult {
  if (error) {
    const permission = error.code === "42501";
    return {
      ok: false,
      code: permission ? "NOT_ALLOWED" : "ERROR",
      message: permission ? `Not allowed: ${error.message}` : error.message.replace(/^.*?ERROR:\s*/, ""),
    };
  }
  if (data && typeof data === "object" && !Array.isArray(data) && "ok" in data) {
    const { ok, code, message, ...rest } = data as Record<string, unknown>;
    return { ok: ok === true, code: code as string | undefined, message: message as string | undefined, data: rest };
  }
  return { ok: true, data: { value: data } };
}

export async function rpc(fn: string, args: Record<string, unknown>): Promise<ActionResult> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc(fn, args);
  return toResult(data, error);
}
