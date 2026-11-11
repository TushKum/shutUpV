import { describe, expect, test } from "vitest";
import { crisisCardsFromCsv, flashBulletinFromCsv, parseCsvObjects, problemCardsFromCsv } from "../src/content";

describe("content files", () => {
  test("problem deck: number, sector, title, body; numbers unique", () => {
    const csv = 'number,sector,title,body\n1,Water,Unsafe water,"Tanks are checked rarely, so people fall ill."\n2,Food,Hostel waste,Too much food is thrown away.\n';
    expect(problemCardsFromCsv(csv)).toEqual([
      { number: 1, sector: "Water", title: "Unsafe water", body: "Tanks are checked rarely, so people fall ill." },
      { number: 2, sector: "Food", title: "Hostel waste", body: "Too much food is thrown away." },
    ]);
    expect(() => problemCardsFromCsv("number,sector,title,body\n1,a,t,b\n1,a,t,b\n")).toThrow(/unique/);
    expect(() => problemCardsFromCsv("number,sector,title,body\nx,a,t,b\n")).toThrow(/row 2: bad number/);
  });

  test("crisis deck: number defaults to 1", () => {
    expect(crisisCardsFromCsv("category,title,body\nRegulation,A ban,You must stop.\n")).toEqual([
      { category: "Regulation", number: 1, title: "A ban", body: "You must stop." },
    ]);
    expect(() => crisisCardsFromCsv("category,number,title,body\n,1,t,b\n")).toThrow(/row 2/);
  });

  test("flash bulletin: exactly one row with a title and a body", () => {
    expect(flashBulletinFromCsv('title,body\nInterest rates rise,"Investors want profit within 12 months."\n')).toEqual({
      title: "Interest rates rise",
      body: "Investors want profit within 12 months.",
    });
    expect(() => flashBulletinFromCsv("title,body\na,b\nc,d\n")).toThrow(/exactly one row/);
    expect(() => flashBulletinFromCsv("title,body\n,b\n")).toThrow(/required/);
    expect(() => flashBulletinFromCsv(`title,body\n${"x".repeat(141)},b\n`)).toThrow(/140/);
  });

  test("headers are case-insensitive and trimmed", () => {
    expect(parseCsvObjects(" Title ,BODY\nA,B\n")).toEqual([{ title: "A", body: "B" }]);
  });
});
