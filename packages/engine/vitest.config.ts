import { defineConfig } from "vitest/config";

// legacy/: the Market Simulation engine, kept only as reference while PRIMUS replaces it (removed after Phase 2).
export default defineConfig({ test: { exclude: ["legacy/**", "node_modules/**"] } });
