import { readFile } from "node:fs/promises";
import { DemoScriptSchema, type DemoScript } from "../../pr-analysis/schema.js";
import { CaptureManifestSchema, type CaptureManifest } from "../../browser-agent/manifest.js";
import { buildComposition } from "../../composer/build-composition.js";
import { ensureHyperframesProject, renderComposition } from "../../composer/render.js";
import type { Config } from "../config.js";
import type { RunLogger } from "../../shared/logger.js";

export async function runAssemble(params: {
  demoScriptPath: string;
  manifestPath: string;
  hyperframesProjectDir: string;
  outputVideoPath: string;
  config: Config;
  logger: RunLogger;
}): Promise<void> {
  const { demoScriptPath, manifestPath, hyperframesProjectDir, outputVideoPath, config, logger } = params;

  const demoScript = DemoScriptSchema.parse(JSON.parse(await readFile(demoScriptPath, "utf8"))) as DemoScript;
  const manifest = CaptureManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8"))) as CaptureManifest;

  await ensureHyperframesProject(hyperframesProjectDir, logger);

  const { totalDurationSec } = await buildComposition({
    demoScript,
    manifest,
    hyperframesProjectDir,
    fallbackStepDurationSec: config.capture.fallbackStepDurationSec,
    hideCaptionsWhenNarrated: config.hyperframes.hideCaptionsWhenNarrated,
  });
  logger.info(`Composition built (${totalDurationSec.toFixed(1)}s total)`);

  await renderComposition(hyperframesProjectDir, outputVideoPath, logger);
}
