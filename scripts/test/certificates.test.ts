import { PDFDocument } from "pdf-lib";
import { expect, test } from "vitest";
import { certificateLines, ordinal, renderCertificates, type CertificateTeam } from "../lib/certificates";

const team = (over: Partial<CertificateTeam> = {}): CertificateTeam => ({
  code: "A101",
  name: "Team Alpha",
  members: ["Priya Sharma", "Rahul Verma", "Anne-Marie O'Brien"],
  rank: 1,
  r1: 78,
  r2: 71,
  r3: 77,
  total: 226,
  awards: ["WINNER", "BEST_PRD"],
  ...over,
});
const opts = { eventName: "PRIMUS", date: "20 November 2026", ranked: 148 };

test("the lines: achievement with awards, the rank and every round's points", () => {
  expect(certificateLines(team(), "Priya Sharma", opts)).toEqual({
    heading: "Certificate of Achievement",
    presented: "This certificate is presented to",
    name: "Priya Sharma",
    team: "a member of Team Alpha (A101),",
    event: "for taking part in PRIMUS, the overnight business case competition, on 20 November 2026.",
    result: "Final rank 1st of 148 · 226 of 300 points (PRD 78 · crisis solution 71 · portfolio 77)",
    awards: ["Winner", "Best PRD"],
  });
});

test("participation without awards; a disqualified team has no results line", () => {
  expect(certificateLines(team({ awards: [], rank: 23 }), "X", opts)).toMatchObject({ heading: "Certificate of Participation", result: expect.stringContaining("23rd of 148") });
  expect(certificateLines(team({ awards: [], rank: null }), "X", opts).result).toBeNull();
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 112].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "112th"]);
});

test("one landscape A4 page per participant, even with names outside the standard fonts", async () => {
  const pdf = await renderCertificates([team(), team({ code: "B202", members: ["Zoë Ñúñez", "李雷"], awards: [], rank: 2 })], opts);
  const doc = await PDFDocument.load(pdf);
  expect(doc.getPageCount()).toBe(5);
  const { width, height } = doc.getPage(0).getSize();
  expect(width).toBeGreaterThan(height);
});
