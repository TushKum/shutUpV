// The HTTP worker's abort deadline includes authentication and preflight work.
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), worker: vi.fn(), event: vi.fn() }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: mocks.viewer }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => ({}) }));
vi.mock("@/lib/supabase/service", () => ({
  supabaseService: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.event }) }) }) }),
}));
vi.mock("@/lib/judge", () => ({
  judgeConfig: () => ({ fake: true, budgetMs: 900_000, concurrency: 8, models: {} }),
  fakeJudgeRefusal: () => null,
  hasApiCredential: () => true,
  promptLoader: () => () => ({}),
  supabaseJudgeDb: () => ({}),
  createJudge: () => () => ({}),
  runWorker: mocks.worker,
  queueCounts: async () => ({}),
  workReply: () => ({ status: 200, body: {} }),
}));

import { POST } from "./route";

afterEach(() => vi.restoreAllMocks());

test("the abort timer starts before authentication, leaving time to report results", async () => {
  const signal = new AbortController().signal;
  const order: string[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    expect(ms).toBe(280_000);
    order.push("deadline");
    return signal;
  });
  mocks.viewer.mockImplementation(async () => {
    order.push("authentication");
    return { role: "ORGANISER" };
  });
  mocks.event.mockResolvedValue({ data: { id: "00000000-0000-0000-0000-000000000001", is_rehearsal: true }, error: null });
  mocks.worker.mockResolvedValue({});
  const response = await POST(new Request("http://localhost/api/judge/work", {
    method: "POST", body: JSON.stringify({ event: "00000000-0000-0000-0000-000000000001" }),
  }));
  expect(response.status).toBe(200);
  expect(order).toEqual(["deadline", "authentication"]);
  expect(mocks.worker).toHaveBeenCalledWith(expect.objectContaining({ abortSignal: signal }));
});
