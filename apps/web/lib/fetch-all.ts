// Reading past PostgREST's 1,000-row cap.

export const PAGE_SIZE = 1000;

/**
 * Reads every row of a query in pages (PostgREST caps a response at 1,000 rows). `page(from, to)` must apply a
 * stable order and `.range(from, to)`.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}
