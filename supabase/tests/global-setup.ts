import { buildTemplate, startCluster, writeConn } from "./pg";

export default async function setup(): Promise<() => Promise<void>> {
  if (process.env.TEST_DATABASE_URL) {
    await buildTemplate(process.env.TEST_DATABASE_URL);
    writeConn({ adminUrl: process.env.TEST_DATABASE_URL });
    return async () => {};
  }
  const cluster = await startCluster();
  try {
    await buildTemplate(cluster.adminUrl);
  } catch (err) {
    await cluster.stop();
    throw err;
  }
  writeConn({ adminUrl: cluster.adminUrl });
  return cluster.stop;
}
