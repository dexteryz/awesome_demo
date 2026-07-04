import type { Config } from "../config.js";
import type { RunLogger } from "../../shared/logger.js";
import type { RunPaths } from "../../shared/paths.js";
import { runAnalyze } from "./analyze.js";
import { captureDemo } from "./capture.js";
import { runAssemble } from "./assemble.js";

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
