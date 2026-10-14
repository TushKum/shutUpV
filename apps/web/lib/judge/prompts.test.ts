import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { loadCalibrationSamples } from "./calibration";
import { findPromptsDir, loadPrompt, promptLoader } from "./prompts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A fake repository: <root>/prompts/{PITCH,PLAN,FLASH}.md and <root>/apps/web. */
function repo(): { root: string; prompts: string; web: string } {
  const root = mkdtempSync(path.join(tmpdir(), "judge-prompts-"));
  dirs.push(root);
  const prompts = path.join(root, "prompts");
  const web = path.join(root, "apps", "web");
  mkdirSync(prompts);
  mkdirSync(web, { recursive: true });
  for (const t of ["PITCH", "PLAN", "FLASH"]) writeFileSync(path.join(prompts, `${t}.md`), `# ${t} judge\n\nScore it.\n`);
  return { root, prompts, web };
}

describe("findPromptsDir", () => {
  test("walks up from apps/web (the Next server) and from the repository root (the CLI)", () => {
    const r = repo();
    expect(findPromptsDir(r.web, {})).toBe(r.prompts);
    expect(findPromptsDir(r.root, {})).toBe(r.prompts);
  });

  test("JUDGE_PROMPTS_DIR wins", () => {
    const r = repo();
    expect(findPromptsDir(r.web, { JUDGE_PROMPTS_DIR: "/somewhere/else" })).toBe(path.resolve("/somewhere/else"));
  });

  test("a prompts folder without PITCH.md is used only when no better one exists", () => {
    const r = repo();
    const inner = path.join(r.web, "prompts");
    mkdirSync(inner);
    expect(findPromptsDir(r.web, {})).toBe(r.prompts);
  });
});

describe("loadPrompt", () => {
  test("the text exactly as stored, and its SHA-256 in hex", () => {
    const r = repo();
    const p = loadPrompt("PLAN", r.prompts);
    expect(p.text).toBe("# PLAN judge\n\nScore it.\n");
    expect(p.sha).toBe(createHash("sha256").update("# PLAN judge\n\nScore it.\n").digest("hex"));
    expect(p.sha).toMatch(/^[0-9a-f]{64}$/);
  });

  test("cached, and read again when the file changes", () => {
    const r = repo();
    const first = loadPrompt("PITCH", r.prompts);
    expect(loadPrompt("PITCH", r.prompts)).toBe(first);
    const file = path.join(r.prompts, "PITCH.md");
    writeFileSync(file, "# PITCH judge, version 2\n");
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    const second = loadPrompt("PITCH", r.prompts);
    expect(second.text).toBe("# PITCH judge, version 2\n");
    expect(second.sha).not.toBe(first.sha);
  });

  test("a missing or empty prompt is an error", () => {
    const r = repo();
    rmSync(path.join(r.prompts, "FLASH.md"));
    expect(() => loadPrompt("FLASH", r.prompts)).toThrow(/FLASH judge prompt is missing/);
    writeFileSync(path.join(r.prompts, "PLAN.md"), "  \n");
    expect(() => loadPrompt("PLAN", r.prompts)).toThrow(/PLAN judge prompt is empty/);
  });

  test("promptLoader binds a folder", () => {
    const r = repo();
    expect(promptLoader(r.prompts)("FLASH").text).toBe("# FLASH judge\n\nScore it.\n");
  });
});

describe("the repository's prompts/", () => {
  const dir = path.resolve(__dirname, "../../../../prompts");
  test.skipIf(!existsSync(path.join(dir, "PITCH.md")))("are found from apps/web and load, with the 10 calibration samples", () => {
    expect(findPromptsDir(path.resolve(__dirname, "../.."), {})).toBe(dir);
    for (const t of ["PITCH", "PLAN", "FLASH"] as const) expect(loadPrompt(t, dir).sha).toMatch(/^[0-9a-f]{64}$/);
    expect(loadCalibrationSamples(dir).map((s) => s.sample_no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
