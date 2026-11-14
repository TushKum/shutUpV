import path from "node:path";
import type { NextConfig } from "next";

// Every screen is per-user and realtime, so the classic request-time rendering model is used
// (Cache Components off).
//
// The judge prompts (prompts/ at the repository root, outside this app) are read from the filesystem at run time, so
// file tracing cannot see them: they are traced in by hand for the routes that read them, from the repository root
// (outputFileTracingRoot, two folders up; this file is compiled as CommonJS, so __dirname is this folder). Route keys
// are picomatch globs (brackets escaped); file globs are relative to this folder.
// Every judge prompt: the classic four and PRIMUS's CRISIS, ADVICE and SOLUTION (lib/judge/prompts.ts PROMPT_FILES).
const PROMPTS = ["../../prompts/*.md"];
const CALIBRATION = "../../prompts/calibration/pitches.json";

// Security headers on every response. No page may be framed by another site (a framed trade or sign-in page could be
// clickjacked); browsers must not guess content types; links out carry only the origin; no page uses the camera,
// microphone or location. HTTPS is enforced for a year once a browser has seen the site.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@msim/engine"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  outputFileTracingRoot: path.join(__dirname, "../.."),
  outputFileTracingIncludes: {
    // The worker: every prompt, and the calibration samples when calibration_input has no text.
    "/api/judge/work": [...PROMPTS, CALIBRATION],
    // The calibration page: the samples and the PITCH prompt they are judged with.
    "/admin/\\[slug\\]/judge/calibration": ["../../prompts/PITCH.md", CALIBRATION],
    // The prompts page for teams: the published prompts.
    "/team/judging": PROMPTS,
    // The crisis memo page shows the case from MEMO.md.
    "/team/squad/memo": ["../../prompts/MEMO.md"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
