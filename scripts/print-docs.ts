// Prints the participant handbook, the three track cards and the four simple guides as A4 PDFs in docs/event/print/, for the registration
// desk and the tables. The Markdown is read with the portal's own reader (apps/web/lib/team/markdown.ts) and printed
// by Chromium; links print as their text, each quoted line as its own paragraph and "---" rules are dropped.
//
//   pnpm print-docs
//
// Run it again after editing docs/event/HANDBOOK.md or docs/event/cards/*.md.

import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { parseMarkdown, type Block, type Inline } from "../apps/web/lib/team/markdown";

const OUT = "docs/event/print";

interface Doc {
  source: string;
  file: string;
  title: string;
  /** A card fits on one page: smaller type, tighter spacing. */
  card?: boolean;
}

const DOCS: Doc[] = [
  { source: "docs/event/HANDBOOK.md", file: "handbook.pdf", title: "Participant handbook" },
  { source: "docs/event/cards/PRODUCT.md", file: "card-product.pdf", title: "Product team card", card: true },
  { source: "docs/event/cards/CONSULTING.md", file: "card-consulting.pdf", title: "Consulting team card", card: true },
  { source: "docs/event/cards/FINANCE.md", file: "card-finance.pdf", title: "Finance team card", card: true },
  { source: "docs/event/simple/FINANCE.md", file: "simple-finance.pdf", title: "Finance, explained simply" },
  { source: "docs/event/simple/PRODUCT.md", file: "simple-product.pdf", title: "Product, explained simply" },
  { source: "docs/event/simple/CONSULTING.md", file: "simple-consulting.pdf", title: "Consulting, explained simply" },
  { source: "docs/event/simple/ORGANISER.md", file: "simple-organiser.pdf", title: "Organisers, explained simply" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(runs: readonly Inline[]): string {
  return runs
    .map((r) => {
      if (r.kind === "text") return esc(r.text);
      if (r.kind === "code") return `<code>${esc(r.text)}</code>`;
      return r.kind === "strong" ? `<strong>${inline(r.children)}</strong>` : `<em>${inline(r.children)}</em>`;
    })
    .join("");
}

function blocks(list: readonly Block[]): string {
  return list
    .map((b) => {
      switch (b.kind) {
        case "heading":
          return `<h${b.level}>${inline(b.content)}</h${b.level}>`;
        case "paragraph":
          return `<p>${inline(b.content)}</p>`;
        case "list": {
          const tag = b.ordered ? "ol" : "ul";
          const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : "";
          return `<${tag}${start}>${b.items.map((item) => `<li>${blocks(item)}</li>`).join("")}</${tag}>`;
        }
        case "table": {
          const cell = (t: string, c: Inline[], i: number) => `<${t}${b.align[i] ? ` style="text-align:${b.align[i]}"` : ""}>${inline(c)}</${t}>`;
          return `<table><thead><tr>${b.head.map((c, i) => cell("th", c, i)).join("")}</tr></thead><tbody>${b.rows
            .map((row) => `<tr>${row.map((c, i) => cell("td", c, i)).join("")}</tr>`)
            .join("")}</tbody></table>`;
        }
        case "code":
          return `<pre>${esc(b.text)}</pre>`;
      }
    })
    .join("\n");
}

/** The Markdown the reader does not handle, made plain: links to their text, quotes unquoted, rules dropped. */
export function printable(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .split("\n")
    .filter((l) => !/^\s*-{3,}\s*$/.test(l))
    .map((l) => (/^>/.test(l) ? `${l.replace(/^> ?/, "")}\n` : l)) // each quoted line its own paragraph
    .join("\n");
}

const css = (card: boolean) => `
  @page { size: A4; margin: ${card ? "12mm 13mm 14mm" : "16mm 16mm 18mm"}; }
  * { box-sizing: border-box; }
  body { font-family: Inter, "DejaVu Sans", sans-serif; color: #111827; font-size: ${card ? "9.4pt" : "10pt"}; line-height: ${card ? 1.35 : 1.45}; margin: 0; }
  h1 { font-size: ${card ? "17pt" : "21pt"}; margin: 0 0 ${card ? "6pt" : "10pt"}; padding-bottom: 4pt; border-bottom: 2pt solid #111827; }
  h2 { font-size: ${card ? "11.5pt" : "14pt"}; margin: ${card ? "9pt" : "16pt"} 0 4pt; break-after: avoid; }
  h3 { font-size: ${card ? "10pt" : "11.5pt"}; margin: ${card ? "7pt" : "12pt"} 0 3pt; break-after: avoid; }
  p { margin: ${card ? "3pt" : "5pt"} 0; }
  ul, ol { margin: ${card ? "2pt" : "4pt"} 0; padding-left: 15pt; }
  li { margin: ${card ? "1pt" : "2pt"} 0; }
  li > p { margin: 0; }
  table { border-collapse: collapse; width: 100%; margin: ${card ? "4pt" : "6pt"} 0; break-inside: ${card ? "auto" : "avoid"}; }
  th, td { border: 0.6pt solid #9ca3af; padding: ${card ? "2.5pt 4pt" : "3pt 5pt"}; text-align: left; vertical-align: top; }
  th { background: #e5e7eb; font-weight: 600; }
  tr { break-inside: avoid; }
  code { font-family: "DejaVu Sans Mono", monospace; font-size: 0.9em; }
  pre { font-family: "DejaVu Sans Mono", monospace; font-size: 8.5pt; background: #f3f4f6; padding: 5pt; white-space: pre-wrap; }
  strong { font-weight: 650; }
`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const page = await browser.newPage();
    for (const d of DOCS) {
      const body = blocks(parseMarkdown(printable(readFileSync(d.source, "utf8"))));
      await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(d.title)}</title><style>${css(!!d.card)}</style></head><body>${body}</body></html>`);
      await page.pdf({
        path: `${OUT}/${d.file}`,
        format: "A4",
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: !d.card,
        headerTemplate: "<span></span>",
        footerTemplate: `<div style="font: 8pt sans-serif; color: #6b7280; width: 100%; text-align: center;">Market Simulation Competition · ${esc(d.title)} · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
      });
      console.log(`Wrote ${OUT}/${d.file}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
