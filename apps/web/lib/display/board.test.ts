import { describe, expect, test } from "vitest";
import { bp } from "@/lib/format";
import {
  BOARD_HIGHLIGHT_MS,
  BOARD_PAGE_MS,
  BOARD_PAGE_SIZE,
  boardTiles,
  changeSinceIpoBp,
  highlightUntil,
  moveOf,
  pageCount,
  pageIndex,
  pageOf,
  priceRowFit,
  toneOf,
  type BoardCompany,
} from "./board";

const co = (over: Partial<BoardCompany> & { id: string }): BoardCompany => ({
  ticker: over.id.toUpperCase(),
  name: `Company ${over.id}`,
  ipo_price: 1050,
  market_price: 1050,
  closing_price: null,
  ...over,
});

describe("change since the IPO price, in basis points", () => {
  test("rounded half-up, as the brief's clearing example: $10.50 → $10.82 is +3.05%", () => {
    expect(changeSinceIpoBp(1050, 1082)).toBe(305); // 304.76…
    expect(bp(changeSinceIpoBp(1050, 1082))).toBe("+3.05%");
    expect(changeSinceIpoBp(1050, 1050)).toBe(0);
    expect(changeSinceIpoBp(1000, 1100)).toBe(1000);
  });

  test("exact halves go away from zero, also when the price fell", () => {
    expect(changeSinceIpoBp(2000, 2001)).toBe(5); // 5.0
    expect(changeSinceIpoBp(400, 401)).toBe(25); // 25.0
    expect(changeSinceIpoBp(800, 801)).toBe(13); // 12.5 → 13
    expect(changeSinceIpoBp(800, 799)).toBe(-13); // −12.5 → −13
    expect(changeSinceIpoBp(1050, 1040)).toBe(-95); // −95.24
    expect(bp(changeSinceIpoBp(1050, 1040))).toBe("−0.95%");
    expect(changeSinceIpoBp(1050, 893)).toBe(-1495); // −1495.24
  });

  test("no IPO price (scores not released) or no price: no change", () => {
    expect(changeSinceIpoBp(null, 1050)).toBeNull();
    expect(changeSinceIpoBp(1050, null)).toBeNull();
    expect(changeSinceIpoBp(null, null)).toBeNull();
  });

  test("refuses anything that is not whole positive cents", () => {
    expect(() => changeSinceIpoBp(0, 100)).toThrow();
    expect(() => changeSinceIpoBp(10.5, 100)).toThrow();
  });
});

describe("the last round's move", () => {
  test("up, down, unchanged; unknown without both prices", () => {
    expect(moveOf(1050, 1082)).toBe("UP");
    expect(moveOf(1050, 1040)).toBe("DOWN");
    expect(moveOf(1050, 1050)).toBe("FLAT");
    expect(moveOf(null, 1050)).toBeNull();
    expect(moveOf(undefined, undefined)).toBeNull();
  });

  test("colours: up, down, flat", () => {
    expect(toneOf(5)).toBe("up");
    expect(toneOf(-5)).toBe("down");
    expect(toneOf(0)).toBe("flat");
    expect(toneOf(null)).toBe("flat");
  });
});

describe("tiles", () => {
  test("sorted by ticker (code-unit order), whatever order the rows came in; unlisted companies are left out", () => {
    const tiles = boardTiles([co({ id: "zaab" }), co({ id: "eta" }), co({ id: "x", ticker: null }), co({ id: "abcd" }), co({ id: "zaaz" })], [], false);
    expect(tiles.map((t) => t.ticker)).toEqual(["ABCD", "ETA", "ZAAB", "ZAAZ"]);
  });

  test("before any round has cleared: price and change, no arrow", () => {
    const [t] = boardTiles([co({ id: "eta" })], [], false);
    expect(t).toEqual({ id: "eta", ticker: "ETA", name: "Company eta", price: 1050, closing: false, changeBp: 0, move: null });
  });

  test("the last cleared round's move per company; a company without a row has no arrow", () => {
    const tiles = boardTiles(
      [co({ id: "a", market_price: 1082 }), co({ id: "b", market_price: 1040 }), co({ id: "c" }), co({ id: "d" })],
      [
        { company_id: "a", market_before: 1050, market_after: 1082 },
        { company_id: "b", market_before: 1050, market_after: 1040 },
        { company_id: "c", market_before: 1050, market_after: 1050 },
      ],
      false,
    );
    expect(tiles.map((t) => [t.ticker, t.price, t.changeBp, t.move])).toEqual([
      ["A", 1082, 305, "UP"],
      ["B", 1040, -95, "DOWN"],
      ["C", 1050, 0, "FLAT"],
      ["D", 1050, 0, null],
    ]);
  });

  test("the IPO price pending (pitch scores not released): no price and no change", () => {
    const [t] = boardTiles([co({ id: "zaab", ipo_price: null, market_price: null })], [], false);
    expect(t).toMatchObject({ price: null, changeBp: null, closing: false, move: null });
  });

  test("after the close: the closing price, and the change since IPO is to the closing price", () => {
    const c = co({ id: "eta", market_price: 1200, closing_price: 1155 });
    const [open] = boardTiles([c], [], false);
    expect(open).toMatchObject({ price: 1200, closing: false, changeBp: 1429 }); // 1428.57
    const [closed] = boardTiles([c], [{ company_id: "eta", market_before: 1180, market_after: 1200 }], true);
    expect(closed).toMatchObject({ price: 1155, closing: true, changeBp: 1000, move: "UP" });
    // Closed but this company has no closing price: the market price, not labelled as closing.
    const [none] = boardTiles([co({ id: "x", closing_price: null })], [], true);
    expect(none).toMatchObject({ price: 1050, closing: false });
  });

  test("a company without a name shows its ticker", () => {
    expect(boardTiles([co({ id: "eta", name: null })], [], false)[0]!.name).toBe("ETA");
  });
});

describe("paging", () => {
  test("25 tiles to a page", () => {
    expect(BOARD_PAGE_SIZE).toBe(25);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(3)).toBe(1);
    expect(pageCount(25)).toBe(1);
    expect(pageCount(26)).toBe(2);
    expect(pageCount(50)).toBe(2);
    expect(pageCount(51)).toBe(3);
  });

  test("which slice: page 1 is tiles 1–25, page 2 the rest", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    expect(pageOf(items, 0)).toEqual(items.slice(0, 25));
    expect(pageOf(items, 1)).toEqual(items.slice(25, 50));
    expect(pageOf(items.slice(0, 26), 1)).toEqual([25]);
    expect(pageOf(items.slice(0, 3), 0)).toEqual([0, 1, 2]);
  });

  test("a new page every 20 seconds of server time; the boundary is at exactly 20 s", () => {
    expect(BOARD_PAGE_MS).toBe(20_000);
    expect(pageIndex(0, 2)).toBe(0);
    expect(pageIndex(19_999, 2)).toBe(0);
    expect(pageIndex(20_000, 2)).toBe(1);
    expect(pageIndex(39_999, 2)).toBe(1);
    expect(pageIndex(40_000, 2)).toBe(0);
    expect(pageIndex(60_000, 3)).toBe(0);
    expect(pageIndex(40_000, 3)).toBe(2);
  });

  test("every screen agrees: the page depends on the server time only (a reload does not start at page 1)", () => {
    const t = Date.parse("2026-10-14T19:00:30.000Z"); // 00:30:30 IST
    expect(pageIndex(t, 2)).toBe(Math.floor(t / 20_000) % 2);
    expect(pageIndex(t + 5_000, 2)).toBe(pageIndex(t, 2)); // same 20-s slot
  });

  test("one page: always page 1", () => {
    expect(pageIndex(1_234_567, 1)).toBe(0);
    expect(pageIndex(25_000, 0)).toBe(0);
  });
});

describe("long prices and changes fit their tile", () => {
  test("by the length of the text shown", () => {
    expect(priceRowFit("$10.82", "+3.05%")).toBe("normal");
    expect(priceRowFit("$10.29", "−12.75%")).toBe("normal"); // 13
    expect(priceRowFit("$99.99", "+852.29%")).toBe("small"); // 14
    expect(priceRowFit("$106.50", "+868.18%")).toBe("smaller"); // 15
    expect(priceRowFit("$206.50", "+1866.67%")).toBe("smaller");
  });
});

describe("highlight after a clearing", () => {
  test("a few seconds after the round cleared; none before any clearing", () => {
    expect(highlightUntil("2026-10-14T19:00:00.000Z")).toBe(Date.parse("2026-10-14T19:00:00.000Z") + BOARD_HIGHLIGHT_MS);
    expect(highlightUntil(null)).toBeNull();
    expect(highlightUntil("not a time")).toBeNull();
  });
});
