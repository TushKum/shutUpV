import { describe, expect, test } from "vitest";
import { MAX_CSV_BYTES, checkHeader, checkTwist, contentLocks, minProblemCards, parseCrisisDeck, parseProblemDeck, parseTwist, readCsvUpload } from "./content";

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
    expect(checkHeader("category;title;body\nx;y;z\n", "crisis")).toBe("Missing columns: number, category, title, body. Expected columns: number, category, title, body.");
    expect(checkHeader("", "twist")).toBe("The file is empty. Expected columns: title, body.");
    expect(checkHeader("title,body\n", "twist")).toBe("The file has a header row but no twist.");
    expect(checkHeader("number,title,body\n", "problem")).toBe("The file has a header row but no cards.");
    expect(checkHeader("title,Title,body\na,b,c\n", "twist")).toBe("The column “title” appears twice. Expected columns: title, body.");
    expect(checkHeader('title,body\n"open,quote\n', "twist")).toBe("CSV ends inside a quoted field. Expected columns: title, body.");
  });

  test("accepts any column order, upper case, spaces and a byte-order mark; optional columns may be left out", () => {
    expect(checkHeader("﻿ Body ,TITLE, Number \nb,t,1\n", "problem")).toBeNull();
    expect(checkHeader("category,title,body,number\nx,y,z,1\n", "crisis")).toBeNull();
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
  test("parses: one card per crisis type, numbered", () => {
    expect(parseCrisisDeck(csv(["number,category,title,body", "1,Ingredient cost,Palm oil doubles,Costs rise.", "2,Packaging ban,No plastic pouches,Stop by June."]))).toEqual({
      ok: true,
      value: [
        { category: "Ingredient cost", number: 1, title: "Palm oil doubles", body: "Costs rise." },
        { category: "Packaging ban", number: 2, title: "No plastic pouches", body: "Stop by June." },
      ],
    });
  });

  test("refuses a bad or repeated number, a number over 99 and missing text, naming the row", () => {
    expect(parseCrisisDeck("number,category,title,body\none,A,t,b\n")).toEqual({ ok: false, message: "Crisis CSV row 2: bad number" });
    expect(parseCrisisDeck("number,category,title,body\n1,A,t,b\n1,B,t,b\n")).toEqual({ ok: false, message: "Crisis CSV: card numbers must be unique" });
    expect(parseCrisisDeck("number,category,title,body\n100,A,t,b\n")).toEqual({ ok: false, message: "Row 2 (card 100): the number must be from 1 to 99." });
    expect(parseCrisisDeck("number,category,title,body\n1,,t,b\n")).toEqual({ ok: false, message: "Crisis CSV row 2: category, title and body are required" });
    expect(parseCrisisDeck(`number,category,title,body\n1,${"c".repeat(101)},t,b\n`)).toEqual({ ok: false, message: "Row 2 (card 1): the type is longer than 100 characters." });
  });
});

describe("the twist", () => {
  test("from a one-row CSV, or typed into the form", () => {
    expect(parseTwist('title,body\nYour distributor wants 3% more margin,"From today, or they drop you."\n')).toEqual({
      ok: true,
      value: { title: "Your distributor wants 3% more margin", body: "From today, or they drop you." },
    });
    expect(parseTwist("title,body\na,b\nc,d\n")).toEqual({ ok: false, message: "Twist CSV: exactly one row after the header (found 2)" });
    expect(checkTwist("  Margin  ", " More margin. ")).toEqual({ ok: true, value: { title: "Margin", body: "More margin." } });
    expect(checkTwist("", "b")).toEqual({ ok: false, message: "Give the twist a title." });
    expect(checkTwist("x".repeat(141), "b")).toEqual({ ok: false, message: "The title is at most 140 characters." });
    expect(checkTwist("t", " ")).toEqual({ ok: false, message: "Write what the twist says." });
  });
});

describe("locks", () => {
  test("both decks after the draw, the twist once published", () => {
    expect(contentLocks({ drawnAt: null, twistPublishedAt: null })).toEqual({ problem: null, crisis: null, twist: null });
    const at = "2026-11-20T15:45:00Z";
    expect(contentLocks({ drawnAt: at, twistPublishedAt: null })).toEqual({
      problem: "Locked: the problem deck is fixed once the lottery has been drawn.",
      crisis: "Locked: the crisis deck is fixed once the lottery has been drawn.",
      twist: null,
    });
    expect(contentLocks({ drawnAt: null, twistPublishedAt: at }).twist).toBe("Locked: the twist has been published.");
  });

  test("the deck needs one card for every 3 teams", () => {
    expect(minProblemCards(150)).toBe(50);
    expect(minProblemCards(8)).toBe(3);
  });
});
