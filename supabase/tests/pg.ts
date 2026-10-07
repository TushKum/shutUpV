// Throwaway Postgres for tests.
//
// If TEST_DATABASE_URL is set (CI service container), it is used as the admin connection.
// Otherwise a private cluster is started with the local Postgres binaries (initdb + postgres).
// The Supabase stub and every migration are applied once into a template database; each test file
// then gets its own database cloned from that template.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, chownSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import { inject } from "vitest";

export const ROOT = resolve(import.meta.dirname, "..", "..");
export const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
export const STUB_SQL = join(ROOT, "supabase", "tests", "supabase-stub.sql");
export const TEMPLATE_DB = "msim_template";

function pgBinDir(): string {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  try {
    return execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
  } catch {
    const base = "/usr/lib/postgresql";
    const versions = existsSync(base) ? readdirSync(base).sort((a, b) => Number(b) - Number(a)) : [];
    if (versions[0]) return join(base, versions[0], "bin");
    throw new Error("Postgres binaries not found: set PG_BIN or TEST_DATABASE_URL");
  }
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

function runAsPostgresUser(bin: string, args: string[]): string[] {
  // initdb and postgres refuse to run as root.
  return isRoot ? ["runuser", "-u", "postgres", "--", bin, ...args] : [bin, ...args];
}

export async function startCluster(): Promise<{ adminUrl: string; stop: () => Promise<void> }> {
  const bin = pgBinDir();
  const dir = mkdtempSync(join(tmpdir(), "msim-pg-"));
  if (isRoot) {
    const uid = Number(execFileSync("id", ["-u", "postgres"], { encoding: "utf8" }).trim());
    const gid = Number(execFileSync("id", ["-g", "postgres"], { encoding: "utf8" }).trim());
    chownSync(dir, uid, gid);
  }
  const data = join(dir, "data");
  const [cmd, ...args] = runAsPostgresUser(join(bin, "initdb"), [
    "-D", data, "-U", "postgres", "--auth=trust", "--encoding=UTF8", "--no-locale",
  ]);
  execFileSync(cmd!, args, { stdio: "pipe" });

  const port = await freePort();
  // pg_ctl daemonises the server, so no long-running child process (or signal forwarding) is involved.
  const [pcmd, ...pargs] = runAsPostgresUser(join(bin, "pg_ctl"), [
    "-D", data, "-l", join(dir, "postgres.log"), "-w", "-t", "30",
    "-o", `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off ` +
      `-c full_page_writes=off -c max_connections=200 -c timezone=UTC`,
    "start",
  ]);
  execFileSync(pcmd!, pargs, { stdio: "pipe" });

  const adminUrl = `postgres://postgres@127.0.0.1:${port}/postgres`;
  return {
    adminUrl,
    stop: async () => {
      const [scmd, ...sargs] = runAsPostgresUser(join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
      try {
        execFileSync(scmd!, sargs, { stdio: "pipe" });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(MIGRATIONS_DIR, f));
}

function dbUrl(adminUrl: string, db: string): string {
  const u = new URL(adminUrl);
  u.pathname = `/${db}`;
  return u.toString();
}

export async function buildTemplate(adminUrl: string): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${TEMPLATE_DB}`);
  await admin.query(`create database ${TEMPLATE_DB}`);
  await admin.end();

  const client = new pg.Client({ connectionString: dbUrl(adminUrl, TEMPLATE_DB) });
  await client.connect();
  try {
    await client.query(readFileSync(STUB_SQL, "utf8"));
    for (const file of migrationFiles()) {
      try {
        await client.query(readFileSync(file, "utf8"));
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

let counter = 0;

/** A fresh database cloned from the migrated template. */
export async function createTestDb(): Promise<{ pool: pg.Pool; url: string; drop: () => Promise<void> }> {
  const adminUrl = inject("pgAdminUrl");
  const name = `msim_t_${process.pid}_${Date.now()}_${counter++}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name} template ${TEMPLATE_DB}`);
  await admin.end();
  const url = dbUrl(adminUrl, name);
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  // Idle clients are terminated when the database is dropped at the end; that is expected.
  pool.on("error", () => {});
  return {
    pool,
    url,
    drop: async () => {
      await pool.end();
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}
