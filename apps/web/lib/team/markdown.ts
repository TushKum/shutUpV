// A small Markdown reader for the judge prompts published to teams (prompts/*.md): it turns the text into a tree of
// blocks (headings, paragraphs, bullet and numbered lists, tables, fenced code) holding inline runs (text, inline
// code, bold, italic), which app/team/judging/markdown.tsx renders as React elements. It follows CommonMark and
// GitHub tables for these constructs only; anything else (links, images, HTML, quotes, rules, entities) stays plain
// text, so nothing in a prompt is hidden or turned into markup. Pure.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] };

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; content: Inline[] }
  | { kind: "paragraph"; content: Inline[] }
  /** Each item is a list of blocks (its text, then any nested list). */
  | { kind: "list"; ordered: boolean; start: number; items: Block[][] }
  | { kind: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { kind: "code"; lang: string | null; text: string };

/** The blocks of a Markdown document. */
export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replace(/\r\n?/g, "\n").split("\n"));
}

/** The plain text of inline runs (what a reader sees, without the markup). */
export function inlineText(content: readonly Inline[]): string {
  return content.map((n) => (n.kind === "text" || n.kind === "code" ? n.text : inlineText(n.children))).join("");
}

// ───────────────────────────── Lines ─────────────────────────────

const isBlank = (line: string) => /^[ \t]*$/.test(line);

/** "---", "* * *", "___": a rule in Markdown, shown here as the text it is (and never read as a list). */
const isRule = (line: string) => /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line);

/** Columns of leading whitespace (a tab advances to the next multiple of 4). */
function indentOf(line: string): number {
  let col = 0;
  for (const ch of line) {
    if (ch === " ") col++;
    else if (ch === "\t") col += 4 - (col % 4);
    else break;
  }
  return col;
}

/** The line without up to `n` columns of leading whitespace. */
function stripIndent(line: string, n: number): string {
  let col = 0;
  let i = 0;
  while (i < line.length && col < n) {
    const ch = line[i];
    if (ch === " ") col++;
    else if (ch === "\t") {
      const width = 4 - (col % 4);
      if (col + width > n) return " ".repeat(col + width - n) + line.slice(i + 1);
      col += width;
    } else break;
    i++;
  }
  return line.slice(i);
}

interface Fence {
  indent: number;
  char: "`" | "~";
  length: number;
  info: string;
}

function fenceOpen(line: string): Fence | null {
  const m = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return null;
  const char = m[2]![0] as "`" | "~";
  if (char === "`" && m[3]!.includes("`")) return null;
  return { indent: m[1]!.length, char, length: m[2]!.length, info: m[3]!.trim() };
}

function fenceCloses(line: string, f: Fence): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return m !== null && m[1]![0] === f.char && m[1]!.length >= f.length;
}

function headingOf(line: string): Extract<Block, { kind: "heading" }> | null {
  const m = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
  if (!m) return null;
  // A closing run of #s (after a space) is not part of the text.
  const text = (m[2] ?? "").replace(/(?:^|[ \t]+)#+$/, "").trim();
  return { kind: "heading", level: m[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, content: parseInline(text) };
}

interface Marker {
  /** "-", "*", "+", "." or ")": items of one list share it. */
  type: string;
  ordered: boolean;
  start: number;
  /** Where the item's text starts; later lines indented this far belong to the item. */
  contentCol: number;
  content: string;
}

function markerOf(line: string): Marker | null {
  const m = /^( {0,3})(?:([-+*])|(\d{1,9})([.)]))(?:([ \t]+)(.*))?$/.exec(line);
  if (!m) return null;
  const indent = m[1]!.length;
  const width = m[2] ? 1 : m[3]!.length + 1;
  const ordered = !m[2];
  const base = { type: m[2] ?? m[4]!, ordered, start: ordered ? Number(m[3]) : 1 };
  const after = (m[5] ?? "") + (m[6] ?? "");
  if (isBlank(after)) return { ...base, contentCol: indent + width + 1, content: "" };
  const spaces = indentOf(after);
  // Five or more spaces: the item's text starts after one of them.
  const gap = spaces <= 4 ? spaces : 1;
  return { ...base, contentCol: indent + width + gap, content: stripIndent(after, gap) };
}

/** A table's cells: split on pipes not escaped with a backslash, without the outer pipes; `\|` is a pipe. */
function cellsOf(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += s[i];
  }
  cells.push(cell.trim());
  return cells;
}

const hasPipe = (line: string) => /(^|[^\\])\|/.test(line);

function alignOf(cell: string): Align | undefined {
  const m = /^(:?)-+(:?)$/.exec(cell);
  if (!m) return undefined;
  return m[1] && m[2] ? "center" : m[1] ? "left" : m[2] ? "right" : null;
}

/** The alignments when lines[i] is a table's header row and lines[i + 1] its delimiter row, else null. */
function tableAt(lines: readonly string[], i: number): Align[] | null {
  const head = lines[i];
  const delim = lines[i + 1];
  if (head === undefined || delim === undefined || indentOf(head) > 3 || indentOf(delim) > 3) return null;
  if (!hasPipe(head) || !hasPipe(delim)) return null;
  const aligns = cellsOf(delim).map(alignOf);
  if (aligns.some((a) => a === undefined) || aligns.length !== cellsOf(head).length) return null;
  return aligns as Align[];
}

/** Does lines[i] start a block that ends a paragraph? */
function interrupts(lines: readonly string[], i: number): boolean {
  const line = lines[i]!;
  if (fenceOpen(line) || headingOf(line) || tableAt(lines, i) || isRule(line)) return true;
  const m = markerOf(line);
  // As in CommonMark, an empty item or a numbered item other than 1 does not interrupt a paragraph.
  return m !== null && m.content !== "" && (!m.ordered || m.start === 1);
}

function endsInParagraph(blocks: readonly Block[]): boolean {
  const last = blocks.at(-1);
  if (!last) return false;
  if (last.kind === "paragraph") return true;
  return last.kind === "list" && endsInParagraph(last.items.at(-1) ?? []);
}

// ───────────────────────────── Blocks ─────────────────────────────

function parseBlocks(lines: readonly string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = fenceOpen(line);
    if (fence) {
      const body: string[] = [];
      i++;
      // An unclosed fence runs to the end of its container.
      while (i < lines.length && !fenceCloses(lines[i]!, fence)) body.push(stripIndent(lines[i++]!, fence.indent));
      i++;
      out.push({ kind: "code", lang: fence.info.split(/\s+/)[0] || null, text: body.join("\n") });
      continue;
    }

    const heading = headingOf(line);
    if (heading) {
      out.push(heading);
      i++;
      continue;
    }

    const align = tableAt(lines, i);
    if (align) {
      const width = align.length;
      const fit = (cells: string[]) => Array.from({ length: width }, (_, k) => parseInline(cells[k] ?? ""));
      const head = fit(cellsOf(line));
      const rows: Inline[][][] = [];
      i += 2;
      // Rows run to a blank line or the start of another block (GitHub's rule).
      while (i < lines.length && !isBlank(lines[i]!) && !fenceOpen(lines[i]!) && !headingOf(lines[i]!) && !isRule(lines[i]!) && !markerOf(lines[i]!)) {
        rows.push(fit(cellsOf(lines[i]!)));
        i++;
      }
      out.push({ kind: "table", align, head, rows });
      continue;
    }

    if (isRule(line)) {
      out.push({ kind: "paragraph", content: [{ kind: "text", text: line.trim() }] });
      i++;
      continue;
    }

    const marker = markerOf(line);
    if (marker) {
      const list = parseList(lines, i, marker);
      out.push(list.block);
      i = list.next;
      continue;
    }

    const text = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]!) && !interrupts(lines, i)) text.push(lines[i++]!.trim());
    out.push({ kind: "paragraph", content: parseInline(text.join("\n")) });
  }
  return out;
}

function parseList(lines: readonly string[], start: number, first: Marker): { block: Block; next: number } {
  const items: Block[][] = [];
  let i = start;
  let marker: Marker | null = first;
  while (marker) {
    const col = marker.contentCol;
    const body = [marker.content];
    i++;
    while (i < lines.length) {
      const line = lines[i]!;
      if (isBlank(line)) {
        let j = i;
        while (j < lines.length && isBlank(lines[j]!)) j++;
        if (j < lines.length && indentOf(lines[j]!) >= col) {
          for (; i < j; i++) body.push("");
          continue;
        }
        break;
      }
      if (indentOf(line) >= col) {
        body.push(stripIndent(line, col));
        i++;
        continue;
      }
      // A lazy continuation line: more text for the paragraph the item ends with.
      if (!isBlank(body.at(-1)!) && !interrupts(lines, i) && !markerOf(line) && endsInParagraph(parseBlocks(body))) {
        body.push(line.trim());
        i++;
        continue;
      }
      break;
    }
    items.push(parseBlocks(body));

    let j = i;
    while (j < lines.length && isBlank(lines[j]!)) j++;
    const next: Marker | null = j < lines.length ? markerOf(lines[j]!) : null;
    if (next && next.type === first.type) {
      i = j;
      marker = next;
    } else marker = null;
  }
  return { block: { kind: "list", ordered: first.ordered, start: first.start, items }, next: i };
}

// ───────────────────────────── Inline ─────────────────────────────

const ESCAPABLE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const isSpace = (ch: string | undefined) => ch === undefined || /\s/u.test(ch);
const isPunct = (ch: string | undefined) => ch !== undefined && /[\p{P}\p{S}]/u.test(ch);

function runLength(s: string, at: number, ch: string): number {
  let n = 0;
  while (s[at + n] === ch) n++;
  return n;
}

/** Where a code span opened by `n` backticks closes (a run of exactly `n`), or −1. */
function codeClose(s: string, from: number, n: number): number {
  let p = from;
  while (p < s.length) {
    if (s[p] === "`") {
      const r = runLength(s, p, "`");
      if (r === n) return p;
      p += r;
    } else p++;
  }
  return -1;
}

/** Can the delimiter run s[at, at + run) open or close emphasis? (CommonMark's flanking rules.) */
function flanking(s: string, at: number, run: number, ch: string): { open: boolean; close: boolean } {
  const prev = at === 0 ? undefined : s[at - 1];
  const next = s[at + run];
  const left = next !== undefined && !isSpace(next) && (!isPunct(next) || isSpace(prev) || isPunct(prev));
  const right = prev !== undefined && !isSpace(prev) && (!isPunct(prev) || isSpace(next) || isPunct(next));
  if (ch === "*") return { open: left, close: right };
  // An underscore inside a word (snake_case) neither opens nor closes.
  return { open: left && (!right || isPunct(prev)), close: right && (!left || isPunct(next)) };
}

/** Where the emphasis opened by `n` × `ch` before `from` closes, or −1. Code spans and nested emphasis are skipped. */
function emphasisClose(s: string, from: number, ch: string, n: number): number {
  let p = from;
  while (p < s.length) {
    const c = s[p];
    if (c === "\\" && ESCAPABLE.test(s[p + 1] ?? "")) {
      p += 2;
    } else if (c === "`") {
      const r = runLength(s, p, "`");
      const close = codeClose(s, p + r, r);
      p = close >= 0 ? close + r : p + r;
    } else if (c === ch) {
      const r = runLength(s, p, ch);
      const f = flanking(s, p, r, ch);
      if (f.close && r >= n && p > from) return p;
      if (f.open) {
        const m = Math.min(r, 2);
        const inner = emphasisClose(s, p + m, ch, m);
        if (inner >= 0) {
          p = inner + m;
          continue;
        }
      }
      p += r;
    } else p++;
  }
  return -1;
}

/** Inline runs: code spans, bold, italic and backslash escapes; everything else is text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ kind: "text", text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\" && ESCAPABLE.test(src[i + 1] ?? "")) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const run = runLength(src, i, "`");
      const close = codeClose(src, i + run, run);
      if (close < 0) {
        text += "`".repeat(run);
        i += run;
        continue;
      }
      flush();
      let code = src.slice(i + run, close).replace(/\n/g, " ");
      if (code.length >= 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") code = code.slice(1, -1);
      out.push({ kind: "code", text: code });
      i = close + run;
      continue;
    }
    if (ch === "*" || ch === "_") {
      const run = runLength(src, i, ch);
      if (flanking(src, i, run, ch).open) {
        let matched = false;
        for (const n of run >= 2 ? [2, 1] : [1]) {
          const close = emphasisClose(src, i + n, ch, n);
          if (close < 0) continue;
          flush();
          const children = parseInline(src.slice(i + n, close));
          out.push(n === 2 ? { kind: "strong", children } : { kind: "em", children });
          i = close + n;
          matched = true;
          break;
        }
        if (matched) continue;
      }
      text += ch.repeat(run);
      i += run;
      continue;
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}
