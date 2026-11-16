import { afterEach, describe, expect, test, vi } from "vitest";
import { limitRows, projectRef, raiseAuthLimits, readAuthConfig } from "../lib/auth-limits";

afterEach(() => vi.unstubAllGlobals());

describe("Supabase Auth rate limits", () => {
  test("the project reference comes from the Supabase URL", () => {
    expect(projectRef("https://fqzkbipybqjerdownoqj.supabase.co")).toBe("fqzkbipybqjerdownoqj");
    expect(projectRef("http://127.0.0.1:54321")).toBeNull();
    expect(projectRef("not a url")).toBeNull();
  });

  test("the two limits PRIMUS needs come first and are checked; the others are shown, not judged", () => {
    const rows = limitRows({ rate_limit_otp: 30, rate_limit_token_refresh: 1800, rate_limit_verify: 30, rate_limit_sms_sent: 30, site_url: "x" });
    expect(rows.map((r) => r.field)).toEqual(["rate_limit_otp", "rate_limit_token_refresh", "rate_limit_sms_sent", "rate_limit_verify"]);
    expect(rows[0]).toMatchObject({ label: "sign-ups and sign-ins", value: 30, min: 1000, ok: false });
    expect(rows[1]).toMatchObject({ label: "token refreshes", value: 1800, min: 1800, ok: true });
    expect(rows[2]).toMatchObject({ min: null, ok: true });
  });

  test("a missing field counts as too low", () => {
    expect(limitRows({})[0]).toMatchObject({ field: "rate_limit_otp", value: null, ok: false });
  });

  test("--set raises only what is too low, never lowers a higher value, then reads back", async () => {
    const calls: { method: string; body?: string }[] = [];
    let config: Record<string, unknown> = { rate_limit_otp: 30, rate_limit_token_refresh: 5000 };
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/config/auth");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
      calls.push({ method: init?.method ?? "GET", body: init?.body as string | undefined });
      if (init?.method === "PATCH") config = { ...config, ...JSON.parse(init.body as string) };
      return new Response(JSON.stringify(config), { status: 200 });
    });
    const after = await raiseAuthLimits("tok", "abcdefghijklmnopqrst", await readAuthConfig("tok", "abcdefghijklmnopqrst"));
    expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH", "GET"]);
    expect(JSON.parse(calls[1]!.body!)).toEqual({ rate_limit_otp: 1000 });
    expect(after).toMatchObject({ rate_limit_otp: 1000, rate_limit_token_refresh: 5000 });
  });

  test("a refused token is explained, not dumped", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    await expect(readAuthConfig("bad", "abcdefghijklmnopqrst")).rejects.toThrow("the access token was refused");
  });
});
