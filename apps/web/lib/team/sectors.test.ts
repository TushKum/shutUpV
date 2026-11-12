import { describe, expect, test } from "vitest";
import { pctText, sectorRace, sectorStyle } from "./sectors";

describe("the sector race", () => {
  test("each sector's average change since the IPO, best first, with its best company", () => {
    const race = sectorRace([
      { ticker: "VLK", sector: "Luxury", ipo: 1000, price: 1100 },
      { ticker: "ATL", sector: "Luxury", ipo: 1000, price: 900 },
      { ticker: "FRL", sector: "FMCG", ipo: 1000, price: 1200 },
      { ticker: "SUN", sector: "Energy", ipo: 1000, price: 950 },
      { ticker: "NEW", sector: "Energy", ipo: null, price: 1000 },
    ]);
    expect(race).toEqual([
      { sector: "FMCG", companies: 1, avgBp: 2000, best: { ticker: "FRL", bp: 2000 } },
      { sector: "Luxury", companies: 2, avgBp: 0, best: { ticker: "VLK", bp: 1000 } },
      { sector: "Energy", companies: 1, avgBp: -500, best: { ticker: "SUN", bp: -500 } },
    ]);
  });
  test("nothing to race with one sector; sectors match ignoring case", () => {
    expect(sectorRace([{ ticker: "A", sector: "FMCG", ipo: 100, price: 110 }, { ticker: "B", sector: "fmcg ", ipo: 100, price: 90 }])).toBeNull();
    expect(sectorRace([])).toBeNull();
  });
  test("each sector keeps one colour; unknown sectors get a stable one", () => {
    expect(sectorStyle("LUXURY").icon).toBe("💎");
    expect(sectorStyle("Space")).toEqual(sectorStyle("space"));
    expect(pctText(-110)).toBe("−1.10%");
    expect(pctText(425)).toBe("+4.25%");
  });
});
