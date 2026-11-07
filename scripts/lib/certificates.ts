// Printable certificates after the awards: one A4 landscape page per participant, black on white for any printer.
// Each names the participant, the team and its code, the final rank and points (Round 1 + Round 2 + Round 3, out of
// 300) and any award the team won. A disqualified team's members get a certificate of participation without results.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { AWARD_LABELS, type AwardCode } from "@msim/engine";
import { toWinAnsi } from "./cards";

export interface CertificateTeam {
  code: string;
  name: string;
  members: string[];
  /** Null when the team is not ranked (disqualified). */
  rank: number | null;
  r1: number;
  r2: number;
  r3: number;
  total: number;
  awards: AwardCode[];
}

export interface CertificateOptions {
  eventName: string;
  /** "20 November 2026". */
  date: string;
  /** How many teams were ranked ("3rd of 148"). */
  ranked: number;
  rehearsal?: boolean;
}

const A4_LANDSCAPE: [number, number] = [841.89, 595.28];

export const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
};

/** The lines of one certificate, in order (pure, so they are tested without a PDF). */
export function certificateLines(team: CertificateTeam, member: string, o: CertificateOptions) {
  const achievement = team.awards.length > 0;
  return {
    heading: achievement ? "Certificate of Achievement" : "Certificate of Participation",
    presented: "This certificate is presented to",
    name: member,
    team: `a member of ${team.name} (${team.code}),`,
    event: `for taking part in ${o.eventName}, the overnight business case competition, on ${o.date}.`,
    result:
      team.rank === null
        ? null
        : `Final rank ${ordinal(team.rank)} of ${o.ranked} · ${team.total} of 300 points (PRD ${team.r1} · crisis solution ${team.r2} · portfolio ${team.r3})`,
    awards: team.awards.map((a) => AWARD_LABELS[a]),
  };
}

function centred(page: PDFPage, text: string, y: number, size: number, font: PDFFont, color = rgb(0, 0, 0)) {
  let t = toWinAnsi(text);
  const max = A4_LANDSCAPE[0] - 140;
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > max) t = t.slice(0, -1);
  page.drawText(t, { x: (A4_LANDSCAPE[0] - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color });
}

export async function renderCertificates(teams: readonly CertificateTeam[], o: CertificateOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(toWinAnsi(`${o.eventName} - certificates`));
  doc.setCreator("PRIMUS platform");
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const [W, H] = A4_LANDSCAPE;

  for (const team of teams) {
    for (const member of team.members) {
      const l = certificateLines(team, member, o);
      const page = doc.addPage(A4_LANDSCAPE);
      page.drawRectangle({ x: 28, y: 28, width: W - 56, height: H - 56, borderColor: rgb(0, 0, 0), borderWidth: 3 });
      page.drawRectangle({ x: 38, y: 38, width: W - 76, height: H - 76, borderColor: rgb(0, 0, 0), borderWidth: 0.75 });
      centred(page, o.rehearsal ? `${o.eventName} (REHEARSAL)` : o.eventName, H - 110, 22, serifBold);
      centred(page, l.heading, H - 165, 38, serifBold);
      centred(page, l.presented, H - 215, 15, italic);
      centred(page, l.name, H - 265, 34, serifBold);
      page.drawLine({ start: { x: W / 2 - 220, y: H - 275 }, end: { x: W / 2 + 220, y: H - 275 }, thickness: 0.75 });
      centred(page, l.team, H - 305, 15, serif);
      centred(page, l.event, H - 330, 13, serif);
      let y = H - 370;
      if (l.result) {
        centred(page, l.result, y, 13, serif);
        y -= 28;
      }
      for (const a of l.awards) {
        centred(page, a, y, 20, serifBold);
        y -= 26;
      }
      for (const [i, label] of ["Organiser", "Faculty fairness officer"].entries()) {
        const x = i === 0 ? 120 : W - 320;
        page.drawLine({ start: { x, y: 95 }, end: { x: x + 200, y: 95 }, thickness: 0.75 });
        page.drawText(label, { x: x + (200 - sans.widthOfTextAtSize(label, 10)) / 2, y: 80, size: 10, font: sans });
      }
    }
  }
  return doc.save();
}
