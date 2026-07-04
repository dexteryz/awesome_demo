import { writeFile } from "node:fs/promises";
import { analyzePr } from "../../pr-analysis/analyze.js";
import type { Config } from "../config.js";
import type { RunLogger } from "../../shared/logger.js";

export async function runAnalyze(params: {
  prRef: string;
  config: Config;
  outPath: string;
  logger: RunLogger;
}): Promise<void> {
  const { prRef, config, outPath, logger } = params;
  const demoScript = await analyzePr({
    prRef,
    appBaseUrl: config.app.baseUrl,
    appStartPath: config.app.startPath,
    model: config.models.prAnalysis,
    logger,
  });
  await writeFile(outPath, JSON.stringify(demoScript, null, 2), "utf8");
  logger.info(`Wrote demo script -> ${outPath}`);
}
