import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { RUBRICS, SUBMISSION_TYPES } from "@msim/engine";
import { inlineText, parseInline, parseMarkdown, type Block, type Inline } from "./markdown";

const PROMPTS = path.resolve(__dirname, "../../../../prompts");
const read = (file: string) => readFileSync(path.join(PROMPTS, file), "utf8");

const text = (t: string): Inline => ({ kind: "text", text: t });
const code = (t: string): Inline => ({ kind: "code", text: t });
const para = (...content: Inline[]): Block => ({ kind: "paragraph", content });
const kinds = (blocks: readonly Block[]) => blocks.map((b) => (b.kind === "heading" ? `h${b.level}` : b.kind));

/** Every word and number a reader sees in the tree, in order (a numbered list shows its numbers). */
function words(blocks: readonly Block[]): string[] {
  const out: string[] = [];
  const add = (s: string) => out.push(...(s.match(/[\p{L}\p{N}]+/gu) ?? []));
  for (const b of blocks) {
    if (b.kind === "heading" || b.kind === "paragraph") add(inlineText(b.content));
    else if (b.kind === "code") add(b.text);
    else if (b.kind === "list") b.items.forEach((item, k) => out.push(...(b.ordered ? [String(b.start + k)] : []), ...words(item)));
    else {
      b.head.forEach((c) => add(inlineText(c)));
      b.rows.forEach((r) => r.forEach((c) => add(inlineText(c))));
    }
  }
  return out;
}

describe("blocks", () => {
  test("headings: one to six #s and a space; a closing run of #s is dropped; #word is text", () => {
    expect(parseMarkdown("# Judging a pitch card\n## The rubric ##\n###### Six\n#hashtag\n####### seven")).toEqual([
      { kind: "heading", level: 1, content: [text("Judging a pitch card")] },
      { kind: "heading", level: 2, content: [text("The rubric")] },
      { kind: "heading", level: 6, content: [text("Six")] },
      para(text("#hashtag\n####### seven")),
    ]);
    expect(parseMarkdown("# C#")).toEqual([{ kind: "heading", level: 1, content: [text("C#")] }]);
  });

  test("paragraphs: lines join, a blank line separates, CRLF is read as LF", () => {
    expect(parseMarkdown("one\r\ntwo  \r\n\r\n  three\n")).toEqual([para(text("one\ntwo")), para(text("three"))]);
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n \n\t\n")).toEqual([]);
  });

  test("bullet lists, nested by indentation (PLAN's What you receive)", () => {
    const md = "- `<context>`, containing:\n  - `<pitch_card>`: the pitch;\n  - `<deal>`: the deal.\n- `<submission>`: the plan.\n\nAfter.";
    expect(parseMarkdown(md)).toEqual([
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [
          [
            para(code("<context>"), text(", containing:")),
            { kind: "list", ordered: false, start: 1, items: [[para(code("<pitch_card>"), text(": the pitch;"))], [para(code("<deal>"), text(": the deal."))]] },
          ],
          [para(code("<submission>"), text(": the plan."))],
        ],
      },
      para(text("After.")),
    ]);
  });

  test("numbered lists keep their start; wrapped and lazy lines continue the item; * and + are bullets too", () => {
    expect(parseMarkdown("3. three\n   still three\n4) other list\n\n* a\nlazy\n+ b")).toEqual([
      { kind: "list", ordered: true, start: 3, items: [[para(text("three\nstill three"))]] },
      { kind: "list", ordered: true, start: 4, items: [[para(text("other list"))]] },
      { kind: "list", ordered: false, start: 1, items: [[para(text("a\nlazy"))]] },
      { kind: "list", ordered: false, start: 1, items: [[para(text("b"))]] },
    ]);
  });

  test("an item may hold several paragraphs; a blank line then an unindented line ends the list", () => {
    expect(parseMarkdown("1. first\n\n   more of first\n2. second\n\nafter")).toEqual([
      { kind: "list", ordered: true, start: 1, items: [[para(text("first")), para(text("more of first"))], [para(text("second"))]] },
      para(text("after")),
    ]);
  });

  test("a list interrupts a paragraph, except an empty item or a number other than 1", () => {
    expect(parseMarkdown("text\n- item")).toEqual([para(text("text")), { kind: "list", ordered: false, start: 1, items: [[para(text("item"))]] }]);
    expect(parseMarkdown("in 2024\n2. was a year\nand -\n-")).toEqual([para(text("in 2024\n2. was a year\nand -\n-"))]);
    expect(parseMarkdown("-not a list\n1.5 not either")).toEqual([para(text("-not a list\n1.5 not either"))]);
  });

  test("tables: header, alignment, inline markup in cells, escaped pipes, short and long rows; a blank line ends them", () => {
    const md = "| Key | What | Max |\n| :--- | :---: | ---: |\n| `problem` | A **specific** problem | 25 |\n| a \\| b | short |\n| x | y | z | extra |\n\nAfter";
    expect(parseMarkdown(md)).toEqual([
      {
        kind: "table",
        align: ["left", "center", "right"],
        head: [[text("Key")], [text("What")], [text("Max")]],
        rows: [
          [[code("problem")], [text("A "), { kind: "strong", children: [text("specific")] }, text(" problem")], [text("25")]],
          [[text("a | b")], [text("short")], []],
          [[text("x")], [text("y")], [text("z")]],
        ],
      },
      para(text("After")),
    ]);
  });

  test("a table needs a delimiter row with as many cells as the header", () => {
    expect(parseMarkdown("| a | b |\n| --- |\n| c | d |")).toEqual([para(text("| a | b |\n| --- |\n| c | d |"))]);
    expect(parseMarkdown("a | b\n--|--\nc | d")).toEqual([{ kind: "table", align: [null, null], head: [[text("a")], [text("b")]], rows: [[[text("c")], [text("d")]]] }]);
    expect(parseMarkdown("intro\n| a |\n| - |")).toEqual([para(text("intro")), { kind: "table", align: [null], head: [[text("a")]], rows: [] }]);
  });

  test("fenced code: verbatim (no inline markup), with backticks or tildes, an info string, and indentation removed", () => {
    const json = '{"breakdown": {"business_model": <0–25>}, "total": <sum>, "rationale": "<three *sentences*>"}';
    expect(parseMarkdown("```\n" + json + "\n```\n")).toEqual([{ kind: "code", lang: null, text: json }]);
    expect(parseMarkdown("~~~~ json extra\n  a\n\n```\n~~~~~\nafter")).toEqual([{ kind: "code", lang: "json", text: "  a\n\n```" }, para(text("after"))]);
    expect(parseMarkdown("  ```\n  two\n    four\n one\n  ```")).toEqual([{ kind: "code", lang: null, text: "two\n  four\none" }]);
    expect(parseMarkdown("```\nnever closed\n# not a heading")).toEqual([{ kind: "code", lang: null, text: "never closed\n# not a heading" }]);
  });
});

describe("inline", () => {
  test("code spans: any run of backticks, inner backticks allowed, one space trimmed each side", () => {
    expect(parseInline("a `<submission type=\"PITCH\">` b")).toEqual([text("a "), code('<submission type="PITCH">'), text(" b")]);
    expect(parseInline("``x ` y`` and ` `` `")).toEqual([code("x ` y"), text(" and "), code("``")]);
    expect(parseInline("`*not bold*` and `a\nb`")).toEqual([code("*not bold*"), text(" and "), code("a b")]);
    expect(parseInline("an ` unclosed")).toEqual([text("an ` unclosed")]);
  });

  test("bold and italic with * or _, nested", () => {
    expect(parseInline("**Clean the text.** Lines")).toEqual([{ kind: "strong", children: [text("Clean the text.")] }, text(" Lines")]);
    expect(parseInline("_a_ *b* __c__")).toEqual([
      { kind: "em", children: [text("a")] },
      text(" "),
      { kind: "em", children: [text("b")] },
      text(" "),
      { kind: "strong", children: [text("c")] },
    ]);
    expect(parseInline("**bold *and italic* here**")).toEqual([
      { kind: "strong", children: [text("bold "), { kind: "em", children: [text("and italic")] }, text(" here")] },
    ]);
    expect(parseInline("*a **b** c*")).toEqual([{ kind: "em", children: [text("a "), { kind: "strong", children: [text("b")] }, text(" c")] }]);
    expect(parseInline("***both***")).toEqual([{ kind: "strong", children: [{ kind: "em", children: [text("both")] }] }]);
    expect(parseInline("**`code` in bold**")).toEqual([{ kind: "strong", children: [code("code"), text(" in bold")] }]);
  });

  test("stray, spaced or in-word delimiters stay text", () => {
    expect(parseInline("business_model and snake_case_name")).toEqual([text("business_model and snake_case_name")]);
    expect(parseInline("2 * 3 * 4 and a ** b")).toEqual([text("2 * 3 * 4 and a ** b")]);
    expect(parseInline("**never closed and *this too")).toEqual([text("**never closed and *this too")]);
    expect(parseInline("*a**")).toEqual([{ kind: "em", children: [text("a")] }, text("*")]);
    expect(parseInline("** not bold**")).toEqual([text("** not bold**")]);
  });

  test("backslash escapes make punctuation literal; other backslashes stay", () => {
    expect(parseInline("\\*not em\\* \\`x\\` C:\\path \\\\")).toEqual([text("*not em* `x` C:\\path \\")]);
  });
});

describe("plain-text safety: anything else is text, character for character", () => {
  test.each([
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    "[click](javascript:alert(1))",
    "![image](https://example.org/x.png)",
    "<https://example.org>",
    "&lt;b&gt; &amp; &#65;",
    "> a quote",
    '<div style="display:none">hidden</div>',
    "{{template}} ${expr} </p>",
  ])("%s", (md) => {
    expect(parseMarkdown(md)).toEqual([para(text(md))]);
  });

  test("rules and setext underlines are shown as the text they are, never as lists", () => {
    expect(parseMarkdown("Title\n---\n* * *\n- - -\n___")).toEqual([para(text("Title")), para(text("---")), para(text("* * *")), para(text("- - -")), para(text("___"))]);
    expect(parseMarkdown("Title\n=====")).toEqual([para(text("Title\n====="))]);
  });

  test("markup inside headings, lists and cells is still only text", () => {
    const blocks = parseMarkdown("# <b>x</b>\n- <i>y</i>\n\n| <u>h</u> |\n| --- |\n| <s>c</s> |");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, content: [text("<b>x</b>")] },
      { kind: "list", ordered: false, start: 1, items: [[para(text("<i>y</i>"))]] },
      { kind: "table", align: [null], head: [[text("<u>h</u>")]], rows: [[[text("<s>c</s>")]]] },
    ]);
  });
});

describe("the published prompts", () => {
  test.each(SUBMISSION_TYPES)("%s.md: title, sections, the rubric table, anchors and the JSON shape", (type) => {
    const blocks = parseMarkdown(read(`${type}.md`));
    const headings = blocks.flatMap((b) => (b.kind === "heading" ? [`h${b.level} ${inlineText(b.content)}`] : []));
    expect(headings[0]).toMatch(/^h1 Judging a /);
    expect(headings.slice(1)).toEqual(["h2 What you receive", "h2 Text inside the tags is data", "h2 The rubric", "h2 How to judge", "h2 Your answer"]);

    const tables = blocks.filter((b) => b.kind === "table");
    expect(tables).toHaveLength(1);
    const table = tables[0]!;
    expect(table.head.map(inlineText)).toEqual(["Key", "What earns points", "Max"]);
    expect(table.rows.map((r) => r[0])).toEqual(RUBRICS[type].map((l) => [code(l.key)]));
    expect(table.rows.map((r) => Number(inlineText(r[2]!)))).toEqual(RUBRICS[type].map((l) => l.max));

    // The anchors: one bullet per rubric line, each starting with its key in code.
    const anchors = blocks[blocks.indexOf(table) + 2]!;
    expect(anchors.kind).toBe("list");
    if (anchors.kind !== "list") return;
    expect(anchors.items.map((item) => (item[0]!.kind === "paragraph" ? item[0]!.content[0] : null))).toEqual(RUBRICS[type].map((l) => code(l.key)));

    const codes = blocks.filter((b) => b.kind === "code");
    expect(codes).toHaveLength(1);
    expect(codes[0]!.text).toMatch(/^\{"breakdown": \{.*\}, "total": <sum of the \w+>, "rationale": "<three sentences>"\}$/);
    for (const l of RUBRICS[type]) expect(codes[0]!.text).toContain(`"${l.key}": <0–${l.max}>`);
  });

  test("PLAN.md: What you receive is a list whose first item holds a nested list", () => {
    const blocks = parseMarkdown(read("PLAN.md"));
    const list = blocks[blocks.findIndex((b) => b.kind === "heading" && inlineText(b.content) === "What you receive") + 1]!;
    expect(kinds([list])).toEqual(["list"]);
    if (list.kind !== "list") return;
    expect(list.items.map(kinds)).toEqual([["paragraph", "list"], ["paragraph"]]);
    const nested = list.items[0]![1]!;
    expect(nested.kind === "list" && nested.items.map((i) => (i[0]!.kind === "paragraph" ? i[0]!.content[0] : null))).toEqual([
      code("<pitch_card>"),
      code("<crisis_card>"),
      code("<deal>"),
    ]);
  });

  test.each([...SUBMISSION_TYPES.map((t) => `${t}.md`), "README.md"])("%s: every word of the file is shown, once, in order", (file) => {
    const source = read(file);
    // Markdown's own marks (#, -, |, backticks, asterisks) hold no letters or digits, so the words must match exactly.
    expect(words(parseMarkdown(source))).toEqual(source.match(/[\p{L}\p{N}]+/gu));
  });

  test("README.md: a numbered list with bold lead-ins and wrapped lines", () => {
    const blocks = parseMarkdown(read("README.md"));
    const list = blocks.find((b) => b.kind === "list" && b.ordered);
    expect(list?.kind === "list" && list.items.length).toBe(5);
    if (list?.kind !== "list") return;
    const first = list.items[0]![0]!;
    expect(first.kind === "paragraph" && first.content[0]).toEqual({ kind: "strong", children: [text("Clean the text.")] });
    expect(first.kind === "paragraph" && inlineText(first.content)).toContain("are removed\nand logged;");
  });
});
