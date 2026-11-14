import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import config from "../next.config";
import { PROMPT_FILES } from "./judge/prompts";

describe("next.config", () => {
  test("the judge worker's bundle traces every prompt file the judge reads (PRIMUS's included)", () => {
    const traced = config.outputFileTracingIncludes!["/api/judge/work"]!;
    for (const file of new Set(Object.values(PROMPT_FILES))) {
      expect(existsSync(join(__dirname, "../../../prompts", file)), file).toBe(true);
      expect(traced.some((g) => g === `../../prompts/${file}` || g === "../../prompts/*.md"), file).toBe(true);
    }
  });

  test("every response carries the security headers", async () => {
    const [rule] = await config.headers!();
    expect(rule!.source).toBe("/:path*");
    const keys = rule!.headers.map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(["Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy"]));
    expect(rule!.headers.find((h) => h.key === "Content-Security-Policy")!.value).toContain("frame-ancestors 'none'");
    expect(config.poweredByHeader).toBe(false);
  });
});
