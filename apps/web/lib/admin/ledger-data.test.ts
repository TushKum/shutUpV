import { describe, expect, test } from "vitest";
import { fetchAll } from "./ledger-data";

// A table of `n` rows served the way PostgREST serves .range(from, to): at most `size` rows a request.
function table(n: number) {
  const rows = Array.from({ length: n }, (_, i) => i);
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  };
  return { rows, calls, page };
}

describe("fetchAll: every row, 1,000 per request", () => {
  test("one request after another until a short page", async () => {
    const t = table(2500);
    expect(await fetchAll(t.page, { size: 1000 })).toEqual(t.rows);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  test("an exact multiple needs one more (empty) page to know it is the end", async () => {
    const t = table(2000);
    expect(await fetchAll(t.page, { size: 1000 })).toHaveLength(2000);
    expect(t.calls).toHaveLength(3);
  });

  test("with the count known, the pages are read in parallel, in order, then one more for rows added since", async () => {
    const t = table(3500);
    expect(await fetchAll(t.page, { size: 1000, total: 3500, parallel: 2 })).toEqual(t.rows);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
      [4000, 4999],
    ]);
    const grown = table(3600);
    expect(await fetchAll(grown.page, { size: 1000, total: 3500 })).toHaveLength(3600);
    const empty = table(0);
    expect(await fetchAll(empty.page, { total: 0 })).toEqual([]);
  });

  test("an error stops the read", async () => {
    await expect(fetchAll(async () => ({ data: null, error: { message: "permission denied" } }))).rejects.toThrow("permission denied");
    await expect(fetchAll(async () => ({ data: null, error: { message: "boom" } }), { total: 10 })).rejects.toThrow("boom");
  });
});
