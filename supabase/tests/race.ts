// Helpers for race tests: hold one transaction open (or pause a session with a superuser row lock) and wait until
// the other sessions are blocked on a lock, so a race is replayed deterministically.

import type pg from "pg";
import { as, type Caller } from "./helpers";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Settled = { ok?: any; err?: string; ms: number };

/** Never rejects: records the result or the error (e.g. 'deadlock detected') and how long the call took. */
export function settle(p: Promise<any>): Promise<Settled> {
  const t0 = performance.now();
  return p.then(
    (ok) => ({ ok, ms: performance.now() - t0 }),
    (e) => ({ err: String(e?.message ?? e), ms: performance.now() - t0 }),
  );
}

/** The call's result; fails the test with the database error (a deadlock, say) if the call raised one. */
export function value(s: Settled, what: string): any {
  if (s.err !== undefined) throw new Error(`${what} raised after ${Math.round(s.ms)} ms: ${s.err}`);
  return s.ok;
}

export async function lockWaiters(pool: pg.Pool): Promise<number> {
  const r = await pool.query(
    "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
  );
  return r.rows[0].n;
}

/** Waits until at least k sessions of this database are blocked on a lock. */
export async function waitForLockWaiters(pool: pg.Pool, k: number) {
  for (let i = 0; i < 800; i++) {
    if ((await lockWaiters(pool)) >= k) return;
    await sleep(25);
  }
  throw new Error(`fewer than ${k} sessions ever waited on a lock (now ${await lockWaiters(pool)})`);
}

/** Like waitForLockWaiters, but also returns once `p` has settled (a call that did not need to wait). */
export async function waitForLockWaitersOr(pool: pg.Pool, k: number, p: Promise<unknown>) {
  let settled = false;
  void p.then(() => (settled = true), () => (settled = true));
  for (let i = 0; i < 800; i++) {
    if (settled || (await lockWaiters(pool)) >= k) return;
    await sleep(25);
  }
  throw new Error(`fewer than ${k} sessions ever waited on a lock (now ${await lockWaiters(pool)})`);
}

/**
 * Runs fn as `caller` in a transaction that stays open after fn returns. `started` resolves with fn's result while
 * the transaction (and its locks) are still held; `commit()` lets it commit.
 */
export function holdTx<T>(pool: pg.Pool, caller: Caller, fn: (c: pg.PoolClient) => Promise<T>) {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  let signal!: (v: T) => void;
  let fail!: (e: unknown) => void;
  const started = new Promise<T>((res, rej) => {
    signal = res;
    fail = rej;
  });
  const done = as(
    pool,
    caller,
    async (c) => {
      const v = await fn(c);
      signal(v);
      await gate;
      return v;
    },
    { commit: true },
  );
  done.catch(fail);
  return {
    started,
    commit: async () => {
      open();
      await done;
    },
  };
}

/** A superuser transaction holding a row lock (or an uncommitted edit) until release(), to pause another session. */
export async function holdAsSuperuser(pool: pg.Pool, sql: string, params: unknown[]) {
  const c = await pool.connect();
  await c.query("begin");
  await c.query(sql, params);
  return {
    release: async (commit = false) => {
      await c.query(commit ? "commit" : "rollback");
      c.release();
    },
  };
}
