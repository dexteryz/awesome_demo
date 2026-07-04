import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { RunLogger } from "../shared/logger.js";

const execFileAsync = promisify(execFile);

// Pinned to match what `hyperframes init` itself pins in generated package.json scripts,
// so repeated runs across time stay reproducible.
const HYPERFRAMES_VERSION = "hyperframes@0.7.31";

/** Scaffolds a Hyperframes project in `dir` if it doesn't already have one (idempotent per run). */
export async function ensureHyperframesProject(dir: string, logger: RunLogger): Promise<void> {
  if (existsSync(`${dir}/package.json`)) return;
  logger.info(`Scaffolding Hyperframes project at ${dir}`);
  await execFileAsync(
    "npx",
    ["--yes", HYPERFRAMES_VERSION, "init", dir, "--non-interactive", "--example", "blank"],
    { maxBuffer: 20 * 1024 * 1024 }
  );
}

/**
 * Renders the composition at `projectDir/index.html` to an mp4. Uses --video-frame-format png,
 * which Hyperframes' own docs recommend for UI recordings/screen captures to avoid JPEG artifacts
 * on saturated UI colors — exactly our clip content.
 */
export async function renderComposition(projectDir: string, outputPath: string, logger: RunLogger): Promise<void> {
  // The render runs with cwd=projectDir, so resolve the output to an absolute path first —
  // otherwise a relative --output lands inside the Hyperframes project dir, not the caller's cwd.
  const absoluteOutput = resolve(outputPath);
  logger.info(`Rendering composition -> ${absoluteOutput}`);
  await execFileAsync(
    "npx",
    ["--yes", HYPERFRAMES_VERSION, "render", "--output", absoluteOutput, "--video-frame-format", "png"],
    { cwd: projectDir, maxBuffer: 50 * 1024 * 1024 }
  );
  logger.info(`Render complete: ${absoluteOutput}`);
}
