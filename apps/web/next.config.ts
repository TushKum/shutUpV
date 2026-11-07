import path from "node:path";
import type { NextConfig } from "next";

// Every screen is per-user and realtime, so the classic request-time rendering model is used
// (Cache Components off).
//
// The judge prompts (prompts/ at the repository root, outside this app) are read from the filesystem at run time, so
// file tracing cannot see them: they are traced in by hand for the routes that read them, from the repository root
// (outputFileTracingRoot, two folders up; this file is compiled as CommonJS, so __dirname is this folder). Route keys
// are picomatch globs (brackets escaped); file globs are relative to this folder.
const PROMPTS = ["../../prompts/PRD.md", "../../prompts/SOLUTION.md"];
const CALIBRATION = "../../prompts/calibration/samples.json";

const nextConfig: NextConfig = {
  transpilePackages: ["@msim/engine"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  outputFileTracingIncludes: {
    // The worker: the two prompts.
    "/api/judge/work": PROMPTS,
    // The judge page: the calibration samples it uploads, and the prompts' SHA-256.
    "/admin/\\[slug\\]/judge": [...PROMPTS, CALIBRATION],
    // How judging works, for teams: the two published prompts.
    "/team/judging": PROMPTS,
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
