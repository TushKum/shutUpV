import { describe, expect, test } from "vitest";
import type { EngagementRow } from "./crisis";
import { hireThreads, parseSort, profileCompleteness, ratingSummary, searchFirms, type DirectoryProfile } from "./hire";

const firm = (code: string, value: number, rating: number | null, clients = 0) => ({ team_id: code, code, name: `Firm ${code}`, value_cents: value, clients, avg_rating: rating });
const profile = (p: Partial<DirectoryProfile>): DirectoryProfile => ({ headline: "", specialities: [], rate_card: "", about: "", asking_cents: 0, ...p });
const eng = (k: number, company: string, firmId: string, rating: number | null = null, rating_default = false): EngagementRow => ({
  id: `${k}${company}${firmId}`,
  k,
  company_id: company,
  firm_team_id: firmId,
  cash_cents: 100,
  shares: 0,
  escrow: "HELD",
  rating,
  rating_default,
  bonus_cents: null,
});

describe("firm directory", () => {
  const firms = [firm("C01", 500, 4), firm("C02", 900, null), firm("C03", 700, 4.5, 2)];
  const profiles = new Map([
    ["C01", profile({ headline: "Supply chain turnarounds", specialities: ["logistics"], asking_cents: 90000 })],
    ["C03", profile({ about: "Pricing and PR for consumer apps", asking_cents: 50000 })],
  ]);

  test("sorts by value, rating or asking fee (no asking fee last)", () => {
    expect(searchFirms(firms, profiles, "", "value").map((f) => f.code)).toEqual(["C02", "C03", "C01"]);
    expect(searchFirms(firms, profiles, "", "rating").map((f) => f.code)).toEqual(["C03", "C01", "C02"]);
    expect(searchFirms(firms, profiles, "", "asking").map((f) => f.code)).toEqual(["C03", "C01", "C02"]);
    expect(searchFirms(firms, profiles, "", "code").map((f) => f.code)).toEqual(["C01", "C02", "C03"]);
  });

  test("searches every word across the code, name and profile", () => {
    expect(searchFirms(firms, profiles, "supply", "value").map((f) => f.code)).toEqual(["C01"]);
    expect(searchFirms(firms, profiles, "pricing consumer", "value").map((f) => f.code)).toEqual(["C03"]);
    expect(searchFirms(firms, profiles, "c02", "value").map((f) => f.code)).toEqual(["C02"]);
    expect(searchFirms(firms, profiles, "pricing logistics", "value")).toEqual([]);
  });

  test("an unknown sort falls back to value", () => {
    expect(parseSort("rating")).toBe("rating");
    expect(parseSort("nope")).toBe("value");
    expect(parseSort(undefined)).toBe("value");
  });

  test("profile completeness counts the five parts", () => {
    expect(profileCompleteness(undefined)).toBe(0);
    expect(profileCompleteness(profile({ headline: "x", about: "y", asking_cents: 1 }))).toBe(3);
  });

  test("rating summary counts stars and defaults", () => {
    const s = ratingSummary([eng(1, "A", "C01", 5), eng(2, "B", "C01", 3, true), eng(2, "C", "C02", 1), eng(3, "D", "C01")], "C01");
    expect(s).toEqual({ rated: 2, defaults: 1, stars: [0, 0, 1, 0, 1] });
  });
});

describe("hire chat threads", () => {
  const companies = [
    { id: "A", product_team_id: "P01" },
    { id: "B", product_team_id: "P02" },
  ];
  const rows = [eng(1, "A", "C01"), eng(2, "B", "C01"), eng(3, "A", "C02"), eng(4, "A", "C01")];

  test("a company sees one thread per firm it hired, newest first, with every sub-round", () => {
    expect(hireThreads(rows, companies, "P01")).toEqual([
      { company_id: "A", firm_team_id: "C01", partner_team_id: "C01", ks: [4, 1] },
      { company_id: "A", firm_team_id: "C02", partner_team_id: "C02", ks: [3] },
    ]);
  });

  test("a firm sees one thread per company that hired it, with the company's Product team as partner", () => {
    expect(hireThreads(rows, companies, "C01")).toEqual([
      { company_id: "A", firm_team_id: "C01", partner_team_id: "P01", ks: [4, 1] },
      { company_id: "B", firm_team_id: "C01", partner_team_id: "P02", ks: [2] },
    ]);
  });

  test("a team that hired no one (or a fund) has no thread", () => {
    expect(hireThreads(rows, companies, "F01")).toEqual([]);
    expect(hireThreads([], companies, "P01")).toEqual([]);
  });
});
