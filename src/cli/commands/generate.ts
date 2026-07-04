import type { Config } from "../config.js";
import type { RunLogger } from "../../shared/logger.js";
import type { RunPaths } from "../../shared/paths.js";
import { runAnalyze } from "./analyze.js";
import { captureDemo } from "./capture.js";
import { runAssemble } from "./assemble.js";
import { narrate } from "../../narration/narrate.js";

/** Chains analyze -> capture -> assemble, stopping and reporting the last-good artifact on failure. */
export async function runGenerate(params: {
  prRef: string;
  config: Config;
  paths: RunPaths;
  runId: string;
  logger: RunLogger;
}): Promise<void> {
  const { prRef, config, paths, runId, logger } = params;

  logger.info("=== Stage 1: analyze ===");
  await runAnalyze({ prRef, config, outPath: paths.demoScriptPath, logger });

  logger.info("=== Stage 2: capture ===");
  const manifest = await captureDemo({ demoScriptPath: paths.demoScriptPath, config, paths, runId, logger });
  if (manifest.meta.overallStatus === "partial") {
    logger.warn("Some steps failed to capture; assembling with fallback cards for those steps.");
  }

  if (config.narration.enabled) {
    logger.info("=== Stage 2.5: narrate ===");
    try {
      await narrate({ manifestPath: paths.manifestPath, config, paths, logger });
    } catch (err) {
      // Don't discard a completed capture over a narration failure (e.g. a voice still
      // fine-tuning, a bad key, or an API hiccup). Warn and assemble a silent video; the
      // narrate stage can be re-run against the manifest later without re-capturing.
      logger.warn(`Narration failed; assembling without voice-over: ${(err as Error).message}`);
    }
  }

  logger.info("=== Stage 3: assemble ===");
  await runAssemble({
    demoScriptPath: paths.demoScriptPath,
    manifestPath: paths.manifestPath,
    hyperframesProjectDir: paths.hyperframesProjectDir,
    outputVideoPath: paths.outputVideoPath,
    config,
    logger,
  });

  logger.info(`Done. Video at: ${paths.outputVideoPath}`);
}
