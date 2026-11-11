import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { SUBMISSION_TYPES } from "@msim/engine";
import { parseMarkdown } from "@/lib/team/markdown";
import { Markdown } from "./markdown";

// The React rendering of the published prompts: real elements for the Markdown subset, and text (escaped by React)
// for everything else.

const render = (md: string, headingBase = 0) => renderToStaticMarkup(createElement(Markdown, { blocks: parseMarkdown(md), label: "Test", headingBase }));

describe("Markdown", () => {
  test("headings move down by headingBase (at most h6); paragraphs, lists, code and emphasis", () => {
    expect(render("# Title\n## Part\n###### Deep", 2)).toMatch(/^<div[^>]*><h3[^>]*>Title<\/h3><h4[^>]*>Part<\/h4><h6[^>]*>Deep<\/h6><\/div>$/);
    const html = render("Some **bold**, *italic* and `code`.\n\n- one\n  - nested\n\n3. three\n4. four\n\n```\n<b>raw</b>\n```");
    expect(html).toContain("<strong");
    expect(html).toContain(">bold</strong>, <em>italic</em> and <code");
    expect(html).toMatch(/<ul[^>]*><li[^>]*><p[^>]*>one<\/p><ul[^>]*><li[^>]*><p[^>]*>nested<\/p><\/li><\/ul><\/li><\/ul>/);
    expect(html).toMatch(/<ol start="3"[^>]*><li[^>]*><p[^>]*>three<\/p><\/li><li[^>]*><p[^>]*>four<\/p><\/li><\/ol>/);
    expect(html).toContain("<pre");
    expect(html).toContain("<code>&lt;b&gt;raw&lt;/b&gt;</code></pre>");
  });

  test("a table scrolls inside a named, focusable frame, with its alignment", () => {
    const html = render("| Key | Max |\n| --- | ---: |\n| `problem` | 25 |");
    expect(html).toMatch(/^<div[^>]*><div role="region" aria-label="Test: table of Key, Max" tabindex="0" class="[^"]*overflow-x-auto[^"]*"><table/);
    expect(html).toContain('<th scope="col" class="px-3 py-2 font-semibold text-right">Max</th>');
    expect(html).toContain('<td class="px-3 py-2 align-top text-right">25</td>');
  });

  test.each([
    ["<script>alert(1)</script>", "&lt;script&gt;alert(1)&lt;/script&gt;"],
    ['<img src=x onerror="alert(1)">', "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"],
    ["[click](javascript:alert(1))", "[click](javascript:alert(1))"],
    ["&amp; &#65;", "&amp;amp; &amp;#65;"],
    ["| <i>x</i> |\n| --- |\n| `<b>` |", "&lt;i&gt;x&lt;/i&gt;"],
  ])("%s is shown as text", (md, shown) => {
    const html = render(md);
    expect(html).toContain(shown);
    expect(html).not.toMatch(/<(script|img|a|i|b)[\s>]/);
  });

  test.each(SUBMISSION_TYPES)("prompts/%s.md renders with one table, one code block and no raw HTML", (type) => {
    const source = readFileSync(path.resolve(__dirname, `../../../../../prompts/${type}.md`), "utf8");
    const html = render(source, 2);
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html.match(/<pre/g)).toHaveLength(1);
    expect(html.match(/<h3/g)).toHaveLength(1);
    expect(html.match(/<h4/g)).toHaveLength(5);
    expect(html).toContain(`<code class="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800">&lt;submission type=&quot;${type}&quot; ticker=&quot;…&quot;&gt;</code>`);
    expect(html).not.toMatch(/<(submission|context|pitch_card|crisis_card|deal|bulletin)[\s>]/);
  });

  test("the renderer never sets HTML directly", () => {
    expect(readFileSync(path.join(__dirname, "markdown.tsx"), "utf8")).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    expect(readFileSync(path.join(__dirname, "page.tsx"), "utf8")).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
  });
});
