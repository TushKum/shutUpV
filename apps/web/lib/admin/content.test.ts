import { describe, expect, test } from "vitest";
import { MAX_CSV_BYTES, checkHeader, contentLocks, minProblemCards, parseCrisisDeck, parseFlashBulletin, parseProblemDeck, readCsvUpload } from "./content";

const csv = (lines: string[]) => `${lines.join("\r\n")}\r\n`;

describe("reading the uploaded file", () => {
  test("returns the text of a .csv file", async () => {
    const file = new File(["number,title,body\n1,a,b\n"], "deck.csv", { type: "text/csv" });
    expect(await readCsvUpload(file)).toEqual({ ok: true, value: "number,title,body\n1,a,b\n" });
    // Some browsers send CSV as application/vnd.ms-excel or no type at all: the extension is enough.
    expect((await readCsvUpload(new File(["x"], "DECK.CSV", { type: "" }))).ok).toBe(true);
  });

  test("refuses nothing chosen, another kind of file, a large file and binary content", async () => {
    expect(await readCsvUpload(null)).toEqual({ ok: false, message: "Choose a CSV file to upload." });
    expect(await readCsvUpload("number,title")).toEqual({ ok: false, message: "Choose a CSV file to upload." });
    expect(await readCsvUpload(new File([], "deck.csv"))).toEqual({ ok: false, message: "Choose a CSV file to upload." });
    expect(await readCsvUpload(new File(["x"], "deck.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))).toEqual({
      ok: false,
      message: "“deck.xlsx” is not a .csv file.",
    });
    expect(await readCsvUpload(new File(["x".repeat(MAX_CSV_BYTES + 1)], "deck.csv"))).toEqual({ ok: false, message: "The file is 513 KB; the limit is 512 KB." });
    expect(await readCsvUpload(new File(["a\u0000b"], "deck.csv"))).toEqual({ ok: false, message: "The file is not a text CSV (save it as “CSV UTF-8”)." });
  });
});

describe("the header row", () => {
  test("names missing columns and lists the expected ones", () => {
    expect(checkHeader("number,sector,title\n1,a,b\n", "problem")).toBe("Missing column: body. Expected columns: number, sector, title, body.");
    expect(checkHeader("category;title;body\nx;y;z\n", "crisis")).toBe("Missing columns: category, title, body. Expected columns: category, number, title, body.");
    expect(checkHeader("", "flash")).toBe("The file is empty. Expected columns: title, body.");
    expect(checkHeader("title,body\n", "flash")).toBe("The file has a header row but no bulletin.");
    expect(checkHeader("number,title,body\n", "problem")).toBe("The file has a header row but no cards.");
    expect(checkHeader("title,Title,body\na,b,c\n", "flash")).toBe("The column “title” appears twice. Expected columns: title, body.");
    expect(checkHeader('title,body\n"open,quote\n', "flash")).toBe("CSV ends inside a quoted field. Expected columns: title, body.");
  });

  test("accepts any column order, upper case, spaces and a byte-order mark; optional columns may be left out", () => {
    expect(checkHeader("﻿ Body ,TITLE, Number \nb,t,1\n", "problem")).toBeNull();
    expect(checkHeader("category,title,body\nx,y,z\n", "crisis")).toBeNull();
  });
});

describe("the problem deck", () => {
  test("parses with the engine's parser (quoted commas and line breaks included)", () => {
    const r = parseProblemDeck(csv(["number,sector,title,body", '2,Health,Clinic stock,"Runs out, often"', '1,Water,Unsafe water,"Line one', 'line two"']));
    expect(r).toEqual({
      ok: true,
      value: [
        { number: 2, sector: "Health", title: "Clinic stock", body: "Runs out, often" },
        { number: 1, sector: "Water", title: "Unsafe water", body: "Line one\r\nline two" },
      ],
    });
    expect(parseProblemDeck("number,title,body\n1,t,b\n")).toEqual({ ok: true, value: [{ number: 1, sector: "", title: "t", body: "b" }] });
  });

  test("reports the engine's row errors and the database's limits by row", () => {
    expect(parseProblemDeck("number,sector,title,body\n1,a,t,b\nx,a,t,b\n")).toEqual({ ok: false, message: "Problem CSV row 3: bad number" });
    expect(parseProblemDeck("number,sector,title,body\n1,a,,b\n")).toEqual({ ok: false, message: "Problem CSV row 2: title and body are required" });
    expect(parseProblemDeck("number,sector,title,body\n1,a,t,b\n1,a,t,b\n")).toEqual({ ok: false, message: "Problem CSV: card numbers must be unique" });
    expect(parseProblemDeck("number,sector,title,body\n1,a,t,b\n1000,a,t,b\n")).toEqual({ ok: false, message: "Row 3 (card 1000): the card number must be from 1 to 999." });
    expect(parseProblemDeck(`number,sector,title,body\n7,a,${"t".repeat(201)},b\n`)).toEqual({ ok: false, message: "Row 2 (card 7): the title is longer than 200 characters." });
    expect(parseProblemDeck(`number,sector,title,body\n7,${"s".repeat(101)},t,b\n`)).toEqual({ ok: false, message: "Row 2 (card 7): the sector is longer than 100 characters." });
    expect(parseProblemDeck(`number,sector,title,body\n7,s,t,${"b".repeat(4001)}\n`)).toEqual({ ok: false, message: "Row 2 (card 7): the body is longer than 4000 characters." });
    expect(parseProblemDeck("id,title,body\n1,t,b\n")).toEqual({ ok: false, message: "Missing column: number. Expected columns: number, sector, title, body." });
  });

  test("characters are counted as the database counts them (an emoji is one)", () => {
    expect(parseProblemDeck(`number,sector,title,body\n7,s,${"💧".repeat(200)},b\n`).ok).toBe(true);
  });
});

describe("the crisis deck", () => {
  test("parses; an empty number means 1", () => {
    expect(parseCrisisDeck(csv(["category,number,title,body", "Regulation,,A ban,You must stop.", "Regulation,2,Another ban,Stop again."]))).toEqual({
      ok: true,
      value: [
        { category: "Regulation", number: 1, title: "A ban", body: "You must stop." },
        { category: "Regulation", number: 2, title: "Another ban", body: "Stop again." },
      ],
    });
    expect(parseCrisisDeck("category,title,body\nRegulation,A ban,Stop.\n").ok).toBe(true);
  });

  test("refuses a bad number, a repeated category and number, and missing text, naming the row", () => {
    expect(parseCrisisDeck("category,number,title,body\nRegulation,one,t,b\n")).toEqual({
      ok: false,
      message: "Row 2: the number must be a whole number from 1 to 999 (or left empty for 1).",
    });
    expect(parseCrisisDeck("category,number,title,body\nRegulation,1.5,t,b\n").ok).toBe(false);
    expect(parseCrisisDeck("category,number,title,body\nA,1,t,b\nB,1,t,b\nA,,t,b\n")).toEqual({
      ok: false,
      message: "Row 4: “A #1” is already on row 2; each category and number pair must be unique.",
    });
    expect(parseCrisisDeck("category,number,title,body\n,1,t,b\n")).toEqual({ ok: false, message: "Crisis CSV row 2: category, title and body are required" });
    expect(parseCrisisDeck(`category,number,title,body\n${"c".repeat(101)},1,t,b\n`)).toEqual({ ok: false, message: "Row 2: the category is longer than 100 characters." });
  });
});

describe("the flash bulletin", () => {
  test("is exactly one row with a title and a body", () => {
    expect(parseFlashBulletin('title,body\nInterest rates rise,"Investors want profit within 12 months."\n')).toEqual({
      ok: true,
      value: { title: "Interest rates rise", body: "Investors want profit within 12 months." },
    });
    expect(parseFlashBulletin("title,body\na,b\nc,d\n")).toEqual({ ok: false, message: "Flash bulletin CSV: exactly one row after the header (found 2)" });
    expect(parseFlashBulletin(`title,body\n${"x".repeat(141)},b\n`)).toEqual({ ok: false, message: "Flash bulletin CSV: the title is at most 140 characters" });
    expect(parseFlashBulletin(`title,body\nt,${"b".repeat(4001)}\n`)).toEqual({ ok: false, message: "The body is longer than 4000 characters." });
    expect(parseFlashBulletin("headline,body\nt,b\n")).toEqual({ ok: false, message: "Missing column: title. Expected columns: title, body." });
  });
});

describe("locks", () => {
  test("both decks after the draw, the flash bulletin once published", () => {
    expect(contentLocks({ drawnAt: null, flashPublishedAt: null })).toEqual({ problem: null, crisis: null, flash: null });
    const at = "2026-10-08T15:30:00Z";
    expect(contentLocks({ drawnAt: at, flashPublishedAt: null })).toEqual({
      problem: "Locked: the problem deck is fixed once the lottery has been drawn.",
      crisis: "Locked: the crisis deck is fixed once the lottery has been drawn.",
      flash: null,
    });
    expect(contentLocks({ drawnAt: null, flashPublishedAt: at }).flash).toBe("Locked: the flash bulletin has been published.");
  });

  test("the deck needs two more cards than there are squads", () => {
    expect(minProblemCards(50)).toBe(52);
  });
});
