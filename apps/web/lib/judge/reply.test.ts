import { describe, expect, test } from "vitest";
import { modelCheckReply, workReply } from "./reply";
import { EMPTY_USAGE } from "./types";
import type { StopReason, WorkerSummary } from "./worker";

const summary = (stopped: StopReason, reason?: string): WorkerSummary => ({
  done: 2,
  failed: 0,
  retried: 1,
  calibration: 0,
  sealed: 0,
  claimed: 3,
  errors: 0,
  ignored: 0,
  ms: 1234,
  stopped,
  ...(reason !== undefined ? { reason } : {}),
  tokens: EMPTY_USAGE,
});

const extra = { fake: false, remaining: { queued: 4, running: 0, done: 2, failed: 0 } };

describe("workReply (POST /api/judge/work)", () => {
  test.each(["empty", "budget", "stopped", "aborted"] as const)("stopped %s: 200 with the summary", (stopped) => {
    const r = workReply(summary(stopped), extra);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ...summary(stopped), ...extra });
    expect(r.body).not.toHaveProperty("error");
  });

  test("a fatal stop: 502 with the summary, error and reason, so the console's loop switches off", () => {
    const reason = "401 authentication_error: invalid x-api-key";
    const r = workReply(summary("fatal", reason), extra);
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ ...summary("fatal", reason), ...extra, error: reason, stopped: "fatal", reason });
  });

  test("a claim error: 502 too; a stop without a reason still says why", () => {
    const r = workReply(summary("error", "could not claim runs: connection refused"), extra);
    expect(r).toMatchObject({ status: 502, body: { stopped: "error", error: "could not claim runs: connection refused" } });
    expect(workReply(summary("fatal"), extra).body).toMatchObject({ error: "a configuration error", reason: "a configuration error" });
    expect(workReply(summary("error"), extra).body).toMatchObject({ error: "the judge queue could not be read" });
  });
});

describe("modelCheckReply", () => {
  test("502 {error, stopped: 'fatal', reason} naming the model and its slot", () => {
    const r = modelCheckReply("claude-opus-5-5", "PRIMARY", { ok: false, error: "404 not_found_error: model: claude-opus-5-5", status: 404 });
    const reason = "the API check of claude-opus-5-5 (the PRIMARY model) failed: 404 not_found_error: model: claude-opus-5-5";
    expect(r).toEqual({ status: 502, body: { error: reason, stopped: "fatal", reason } });
  });
});
