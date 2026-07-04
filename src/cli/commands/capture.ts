import { chromium } from "playwright";
import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../config.js";
import { DemoScriptSchema, type DemoScript } from "../../pr-analysis/schema.js";
import { runSeedSteps } from "../../browser-agent/session.js";
import { openStepContext, closeStepContext } from "../../browser-agent/recorder.js";
import { runStepAgentLoop } from "../../browser-agent/agent-loop.js";
import { tightenClip } from "../../browser-agent/tighten-clip.js";
import { writeManifest, type CaptureManifest, type ManifestStep } from "../../browser-agent/manifest.js";
import type { RunLogger } from "../../shared/logger.js";
import type { RunPaths } from "../../shared/paths.js";
import { getMediaDurationMs } from "../../shared/ffprobe.js";

export interface CaptureOptions {
  demoScriptPath: string;
  config: Config;
  paths: RunPaths;
  runId: string;
  logger: RunLogger;
}

/**
 * Drives the browser through every demo-script step, one fresh recordVideo context per step
 * (Playwright can't start/stop recording mid-context). storageState from a one-time seed/login
 * pass is reused across every step's context so we don't have to log in repeatedly; each step's
 * context is explicitly re-navigated to the previous step's ending URL (a harness action, not
 * LLM-driven) so token spend goes to the step itself rather than "getting back to where we were".
 */
export async function captureDemo(options: CaptureOptions): Promise<CaptureManifest> {
  const { demoScriptPath, config, paths, runId, logger } = options;
  const demoScriptRaw = JSON.parse(await readFile(demoScriptPath, "utf8"));
  const demoScript = DemoScriptSchema.parse(demoScriptRaw) as DemoScript;

  const browser = await chromium.launch({ headless: config.capture.headless });
  const startedAt = new Date().toISOString();
  const steps: ManifestStep[] = [];

  const cursorEnabled = config.capture.cursor.enabled;
  const motion = cursorEnabled
    ? {
        moveSteps: config.capture.cursor.moveSteps,
        clickPauseMs: config.capture.cursor.clickPauseMs,
        typeDelayMs: config.capture.cursor.typeDelayMs,
      }
    : null;

  try {
    const seedContext = await browser.newContext({ viewport: config.app.viewport });
    const seedPage = await seedContext.newPage();
    if (config.auth.seedSteps.length > 0) {
      logger.info(`Running ${config.auth.seedSteps.length} auth seed step(s)`);
      await runSeedSteps(seedPage, config.auth.seedSteps, config.app.baseUrl, logger);
    } else {
      await seedPage.goto(new URL(config.app.startPath, config.app.baseUrl).toString(), {
        waitUntil: "networkidle",
      });
    }
    await seedContext.storageState({ path: paths.storageStatePath });
    await seedContext.close();

    let endUrl = new URL(config.app.startPath, config.app.baseUrl).toString();

    for (const step of demoScript.steps) {
      logger.info(`Step ${step.id}: ${step.instruction}`);
      let attempts = 0;
      let success = false;
      let reason = "";
      let clipPath: string | null = null;
      let rawClipPath: string | null = null;
      let clipDurationMs: number | null = null;
      let screenshotBefore: string | null = null;
      let screenshotAfter: string | null = null;
      let toolCallLog: ManifestStep["toolCallLog"] = [];
      let stepEndUrl = endUrl;

      while (attempts < config.capture.maxRetriesPerStep && !success) {
        attempts++;
        const handle = await openStepContext(browser, {
          storageStatePath: paths.storageStatePath,
          viewport: config.app.viewport,
          videoDir: paths.clipsDir,
          videoSize: config.capture.video,
          injectCursor: cursorEnabled,
        });

        let recordedVideoPath: string | null = null;
        try {
          await handle.page.goto(endUrl, { waitUntil: "networkidle", timeout: 15000 });

          const beforePath = join(paths.screenshotsDir, `${step.id}-before-attempt${attempts}.png`);
          await handle.page.screenshot({ path: beforePath });

          const result = await runStepAgentLoop({
            page: handle.page,
            step,
            model: config.models.browserAgent,
            maxTurns: config.capture.maxTurnsPerStep,
            logger,
            motion,
          });

          const afterPath = join(paths.screenshotsDir, `${step.id}-after-attempt${attempts}.png`);
          await handle.page.screenshot({ path: afterPath });

          success = result.success;
          reason = result.reason;
          toolCallLog = result.toolCallLog;
          screenshotBefore = beforePath;
          screenshotAfter = afterPath;
          stepEndUrl = handle.page.url();
        } finally {
          recordedVideoPath = await closeStepContext(handle);
        }

        if (success && recordedVideoPath) {
          const finalRawPath = join(paths.clipsDir, `${step.id}.webm`);
          try {
            await rename(recordedVideoPath, finalRawPath);
            rawClipPath = finalRawPath;
            clipPath = finalRawPath;
            clipDurationMs = await getMediaDurationMs(finalRawPath);

            // Strip the dead air from recording per-turn API latency and pace the clip. Falls back
            // to the raw clip if ffmpeg fails so a step is never lost to post-processing.
            if (config.capture.tighten.enabled) {
              const tightened = await tightenClip(finalRawPath, join(paths.clipsDir, `${step.id}.mp4`), {
                targetStepDurationSec: config.capture.tighten.targetStepDurationSec,
                minStepDurationSec: config.capture.tighten.minStepDurationSec,
                removeIdleFrames: config.capture.tighten.removeIdleFrames,
              });
              if (tightened) {
                logger.info(
                  `  tightened ${step.id}: ${((clipDurationMs ?? 0) / 1000).toFixed(1)}s -> ${(
                    tightened.durationMs / 1000
                  ).toFixed(1)}s`
                );
                clipPath = tightened.path;
                clipDurationMs = tightened.durationMs;
              } else {
                logger.warn(`Tighten pass failed for ${step.id}; keeping raw clip`);
              }
            }
          } catch (err) {
            logger.warn(`Failed to finalize clip for ${step.id}: ${(err as Error).message}`);
          }
        }

        if (!success) {
          logger.warn(`Step ${step.id} attempt ${attempts} failed: ${reason}`);
        }
      }

      if (success) endUrl = stepEndUrl;

      steps.push({
        id: step.id,
        status: success ? "success" : "failed",
        attempts,
        instruction: step.instruction,
        captionText: step.captionText,
        narrationText: step.narrationText,
        clipPath,
        rawClipPath,
        clipDurationMs,
        audioPath: null,
        audioDurationMs: null,
        screenshotBefore,
        screenshotAfter,
        endUrl,
        failureReason: success ? null : reason,
        toolCallLog,
      });
    }
  } finally {
    await browser.close();
  }

  const overallStatus = steps.every((s) => s.status === "success") ? "complete" : "partial";
  const manifest: CaptureManifest = {
    meta: {
      runId,
      sourceDemoScriptPath: demoScriptPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      overallStatus,
    },
    steps,
  };

  await writeManifest(paths.manifestPath, manifest);
  logger.info(`Capture ${overallStatus}: ${steps.filter((s) => s.status === "success").length}/${steps.length} steps succeeded`);
  return manifest;
}
