// Printable login cards: 8 per A4 page (2 × 4), with dashed cut lines. Black on white for any printer.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface LoginCard {
  code: string;
  password: string;
  teamName: string;
  /** A backup team's card says so: it plays only if an organiser activates it before the draw. */
  backup?: boolean;
}

export interface CardSheetOptions {
  eventName: string;
  loginUrl: string;
  rehearsal?: boolean;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 24;
const COLS = 2;
const ROWS = 4;
export const CARDS_PER_PAGE = COLS * ROWS;

/** The standard PDF fonts only cover WinAnsi; replace anything else so a name never breaks the print run. */
export function toWinAnsi(text: string): string {
  return Array.from(text.normalize("NFC"))
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) ? ch : "?";
    })
    .join("");
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  let t = toWinAnsi(text);
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > maxWidth) t = t.slice(0, -1);
  return `${t}...`;
}

function dashedLine(page: PDFPage, x1: number, y1: number, x2: number, y2: number) {
  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness: 0.5,
    color: rgb(0.55, 0.55, 0.55),
    dashArray: [4, 3],
  });
}

export async function renderLoginCards(cards: readonly LoginCard[], opts: CardSheetOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(toWinAnsi(`${opts.eventName} - login cards`));
  doc.setCreator("PRIMUS platform");
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);

  const cardW = (A4[0] - 2 * MARGIN) / COLS;
  const cardH = (A4[1] - 2 * MARGIN) / ROWS;
  const pad = 14;

  for (let start = 0; start < cards.length; start += CARDS_PER_PAGE) {
    const page = doc.addPage(A4);
    const slice = cards.slice(start, start + CARDS_PER_PAGE);

    // Cut lines (outer box and inner grid).
    for (let c = 0; c <= COLS; c++) dashedLine(page, MARGIN + c * cardW, MARGIN, MARGIN + c * cardW, A4[1] - MARGIN);
    for (let r = 0; r <= ROWS; r++) dashedLine(page, MARGIN, MARGIN + r * cardH, A4[0] - MARGIN, MARGIN + r * cardH);

    slice.forEach((card, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = MARGIN + col * cardW + pad;
      const top = A4[1] - MARGIN - row * cardH - pad;
      const w = cardW - 2 * pad;

      // Header band (inverted) and event name.
      page.drawRectangle({ x: x - 2, y: top - 18, width: w + 4, height: 20, color: rgb(0, 0, 0) });
      page.drawText(card.backup ? "BACKUP TEAM CARD" : "TEAM CARD", { x: x + 4, y: top - 13, size: 10, font: bold, color: rgb(1, 1, 1) });
      const evt = fit(opts.rehearsal ? `REHEARSAL · ${opts.eventName}` : opts.eventName, sans, 8, w * 0.55);
      page.drawText(evt, {
        x: x + w - sans.widthOfTextAtSize(evt, 8) - 4,
        y: top - 12,
        size: 8,
        font: sans,
        color: rgb(1, 1, 1),
      });

      page.drawText("TEAM CODE", { x, y: top - 38, size: 7.5, font: bold, color: rgb(0.35, 0.35, 0.35) });
      page.drawText(card.code, { x, y: top - 72, size: 32, font: bold });

      page.drawText(fit(card.teamName, sans, 10, w * 0.5), {
        x: x + w * 0.48,
        y: top - 62,
        size: 10,
        font: sans,
      });

      page.drawText("PASSWORD", { x, y: top - 92, size: 7.5, font: bold, color: rgb(0.35, 0.35, 0.35) });
      page.drawRectangle({
        x: x - 2,
        y: top - 122,
        width: w + 4,
        height: 26,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
      });
      page.drawText(card.password, { x: x + 6, y: top - 116, size: 18, font: mono });

      page.drawText(fit(`Log in at ${opts.loginUrl}`, sans, 9, w), { x, y: top - 140, size: 9, font: sans });
      const note = card.backup
        ? ["Backup team: you play only if the organisers activate your team before", "the problem cards are dealt. Keep this card until they tell you."]
        : [
            "Log in once at check-in. Anyone holding this card can act for your",
            "team, so keep it with you. Lost card? Go to the technical support desk.",
          ];
      note.forEach((line, n) =>
        page.drawText(fit(line, sans, 7, w), {
          x,
          y: top - 156 - n * 9,
          size: 7,
          font: sans,
          color: rgb(0.3, 0.3, 0.3),
        }),
      );
    });

    page.drawText(toWinAnsi(`${opts.eventName} - page ${start / CARDS_PER_PAGE + 1}`), {
      x: MARGIN,
      y: 10,
      size: 7,
      font: sans,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  return doc.save();
}

// ───────────── Staff logins ─────────────

export interface StaffLogin {
  role: string;
  email: string;
  password: string;
}

const ROLE_NOTE: Record<string, string> = {
  ORGANISER: "The control panel: /admin",
  FAIRNESS: "Fairness officer: /admin, the Fairness tab",
  DISPLAY: "The projector: /display, full screen (F11)",
};

/** Reads the seed's out/<slug>-staff-logins.txt ("ROLE  email  password" per line). */
export function parseStaffLogins(text: string): StaffLogin[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [role, email, password] = l.split(/\s+/);
      if (!role || !email || !password) throw new Error(`not a staff login line: ${l}`);
      return { role, email, password };
    });
}

/**
 * The staff logins as one A4 sheet per 8 people: a slip each (role, what it opens, email, password, sign-in address),
 * with cut lines, so each person gets only their own. Organisers first.
 */
export async function renderStaffLogins(staff: readonly StaffLogin[], opts: CardSheetOptions): Promise<Uint8Array> {
  const order = ["ORGANISER", "FAIRNESS", "DISPLAY"];
  const sorted = [...staff].sort((a, b) => (order.indexOf(a.role) + 9) % 9 - (order.indexOf(b.role) + 9) % 9 || a.email.localeCompare(b.email));
  const doc = await PDFDocument.create();
  doc.setTitle(toWinAnsi(`${opts.eventName} - staff logins`));
  doc.setCreator("PRIMUS platform");
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  const PER_PAGE = 8;
  const slipH = (A4[1] - 2 * MARGIN - 30) / PER_PAGE;
  const w = A4[0] - 2 * MARGIN;

  for (let start = 0; start < sorted.length || start === 0; start += PER_PAGE) {
    const page = doc.addPage(A4);
    page.drawText(toWinAnsi(`${opts.rehearsal && !/rehearsal/i.test(opts.eventName) ? "REHEARSAL - " : ""}${opts.eventName} - staff logins (confidential: cut and hand out)`), {
      x: MARGIN,
      y: A4[1] - MARGIN - 12,
      size: 11,
      font: bold,
    });
    const top0 = A4[1] - MARGIN - 30;
    sorted.slice(start, start + PER_PAGE).forEach((s, i) => {
      const top = top0 - i * slipH;
      dashedLine(page, MARGIN, top, A4[0] - MARGIN, top);
      const x = MARGIN + 10;
      page.drawRectangle({ x, y: top - 24, width: 92, height: 16, color: rgb(0, 0, 0) });
      page.drawText(toWinAnsi(s.role), { x: x + 6, y: top - 20, size: 9, font: bold, color: rgb(1, 1, 1) });
      page.drawText(fit(ROLE_NOTE[s.role] ?? "", sans, 8.5, w - 120), { x: x + 104, y: top - 20, size: 8.5, font: sans, color: rgb(0.3, 0.3, 0.3) });
      page.drawText("EMAIL", { x, y: top - 40, size: 7, font: bold, color: rgb(0.35, 0.35, 0.35) });
      page.drawText(fit(s.email, sans, 12, w * 0.55), { x, y: top - 55, size: 12, font: sans });
      page.drawText("PASSWORD", { x: x + w * 0.6, y: top - 40, size: 7, font: bold, color: rgb(0.35, 0.35, 0.35) });
      page.drawText(toWinAnsi(s.password), { x: x + w * 0.6, y: top - 57, size: 15, font: mono });
      page.drawText(fit(`Sign in at ${opts.loginUrl} (Organiser tab)`, sans, 8, w - 20), { x, y: top - 72, size: 8, font: sans, color: rgb(0.3, 0.3, 0.3) });
    });
    const shown = Math.min(PER_PAGE, Math.max(0, sorted.length - start));
    dashedLine(page, MARGIN, top0 - shown * slipH, A4[0] - MARGIN, top0 - shown * slipH);
    if (sorted.length === 0) break;
  }
  return doc.save();
}
