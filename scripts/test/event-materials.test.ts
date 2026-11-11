// The event materials (docs/event, seed/flash-bulletins) must stay usable on the platform: every flash bulletin
// uploads through the Content page's parser, and every sample submission fits its template and word limit.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { TEMPLATES, validateSubmission, type SubmissionType } from "@msim/engine";
import { parseFlashBulletin } from "../../apps/web/lib/admin/content";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** A sample in docs/event/samples: "**Label**" lines open the template sections; "---" ends the sample. */
function sampleContent(type: SubmissionType, file: string): Record<string, string> {
  const text = read(`docs/event/samples/${file}`).split("\n---\n")[0]!;
  const content: Record<string, string> = {};
  const company = /\*\*Company:\*\* (.+?) · \*\*Ticker:\*\* ([A-Z]+)/.exec(text);
  if (company) Object.assign(content, { company_name: company[1], ticker: company[2] });
  let key: string | null = null;
  for (const line of text.split("\n")) {
    const label = /^\*\*(.+)\*\*$/.exec(line)?.[1];
    const field = label ? TEMPLATES[type].find((f) => f.label === label) : undefined;
    if (field) key = field.key;
    else if (key) content[key] = `${content[key] ?? ""}${line}\n`.trimStart();
  }
  return content;
}

describe("flash bulletins", () => {
  const files = readdirSync(new URL("../../seed/flash-bulletins", import.meta.url)).filter((f) => f.endsWith(".csv"));

  test("there are bulletins to choose from", () => expect(files.length).toBeGreaterThanOrEqual(3));

  test.each(files)("%s uploads on the Content page", (file) => {
    const r = parseFlashBulletin(read(`seed/flash-bulletins/${file}`));
    expect(r).toMatchObject({ ok: true });
  });
});

describe("sample submissions", () => {
  test.each([
    ["PITCH", "PITCH-strong.md"],
    ["PITCH", "PITCH-weak.md"],
    ["PLAN", "PLAN-strong.md"],
    ["PLAN", "PLAN-weak.md"],
  ] as [SubmissionType, string][])("%s %s fills every section and fits the limit", (type, file) => {
    const content = sampleContent(type, file);
    for (const f of TEMPLATES[type]) expect(content[f.key]?.trim(), `${file}: ${f.label}`).toBeTruthy();
    expect(validateSubmission(type, content)).toMatchObject({ ok: true });
  });

  test("the flash answers fit 100 words", () => {
    const answers = read("docs/event/samples/FLASH-samples.md").match(/(?:^> .*\n?)+/gm) ?? [];
    expect(answers).toHaveLength(3);
    for (const a of answers) expect(validateSubmission("FLASH", { answer: a.replace(/^> /gm, "") })).toMatchObject({ ok: true });
  });
});
