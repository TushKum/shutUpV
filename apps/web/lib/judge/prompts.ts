// The judge's system prompts: prompts/PITCH.md, prompts/PLAN.md and prompts/FLASH.md at the repository root, published
// to teams. The folder is found by walking up from the working directory (apps/web for the Next server, the repository
// root for `pnpm judge-worker`), or set with JUDGE_PROMPTS_DIR. A prompt is read again when its file changes; its
// SHA-256 (hex, of the exact text sent) is stored with every run as prompt_sha.
// Dynamic filesystem paths opt out of Turbopack tracing: next.config.ts includes the required prompt files explicitly.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { SubmissionType } from "@msim/engine";

export const PROMPT_FILES: Record<SubmissionType, string> = {
  PITCH: "PITCH.md",
  PLAN: "PLAN.md",
  FLASH: "FLASH.md",
};

export interface JudgePrompt {
  type: SubmissionType;
  /** The system prompt, exactly as stored in the file. */
  text: string;
  /** SHA-256 of `text`, lower-case hex. */
  sha: string;
  file: string;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The prompts folder: JUDGE_PROMPTS_DIR if set, otherwise the first `prompts/` holding PITCH.md (or, failing that,
 * the first `prompts/` folder at all) found walking up from `from`.
 */
export function findPromptsDir(from: string = process.cwd(), env: Record<string, string | undefined> = process.env): string {
  const override = env.JUDGE_PROMPTS_DIR?.trim();
  if (override) return path.resolve(override);
  let firstFolder: string | null = null;
  let dir = path.resolve(/* turbopackIgnore: true */ from);
  for (;;) {
    const candidate = path.join(dir, "prompts");
    if (existsSync(path.join(candidate, PROMPT_FILES.PITCH))) return candidate;
    if (firstFolder === null && existsSync(candidate) && statSync(candidate).isDirectory()) firstFolder = candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (firstFolder) return firstFolder;
  throw new Error(`Could not find the prompts/ folder above ${path.resolve(/* turbopackIgnore: true */ from)} (set JUDGE_PROMPTS_DIR to point at it)`);
}

const cache = new Map<string, { mtimeMs: number; size: number; prompt: JudgePrompt }>();

/** The system prompt for a type, read from `dir` (default: findPromptsDir()). */
export function loadPrompt(type: SubmissionType, dir: string = findPromptsDir()): JudgePrompt {
  const file = path.join(/* turbopackIgnore: true */ dir, PROMPT_FILES[type]);
  let stat;
  try {
    stat = statSync(/* turbopackIgnore: true */ file);
  } catch {
    throw new Error(`The ${type} judge prompt is missing: ${file}`);
  }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.prompt;
  const text = readFileSync(/* turbopackIgnore: true */ file, "utf8");
  if (text.trim() === "") throw new Error(`The ${type} judge prompt is empty: ${file}`);
  const prompt: JudgePrompt = { type, text, sha: sha256Hex(text), file };
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, prompt });
  return prompt;
}

/** A loader bound to one folder, found once (the worker calls it for every run). */
export function promptLoader(dir?: string): (type: SubmissionType) => JudgePrompt {
  let resolved = dir;
  return (type) => {
    resolved ??= findPromptsDir();
    return loadPrompt(type, resolved);
  };
}
