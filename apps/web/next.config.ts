import type { NextConfig } from "next";

// Every screen is per-user and realtime, so the classic request-time rendering model is used
// (Cache Components off).
const nextConfig: NextConfig = {
  transpilePackages: ["@msim/engine"],
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
