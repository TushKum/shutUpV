import type { TestProject } from "vitest/node";
import { buildTemplate, startCluster } from "./pg";

declare module "vitest" {
  export interface ProvidedContext {
    pgAdminUrl: string;
  }
}

// The admin URL is handed to the test files through vitest's provide/inject, so several test runs
// (each with its own cluster) can run side by side.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  if (process.env.TEST_DATABASE_URL) {
    await buildTemplate(process.env.TEST_DATABASE_URL);
    project.provide("pgAdminUrl", process.env.TEST_DATABASE_URL);
    return async () => {};
  }
  const cluster = await startCluster();
  try {
    await buildTemplate(cluster.adminUrl);
  } catch (err) {
    await cluster.stop();
    throw err;
  }
  project.provide("pgAdminUrl", cluster.adminUrl);
  return cluster.stop;
}
