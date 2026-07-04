import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CaptureManifestSchema, writeManifest, type CaptureManifest } from "../browser-agent/manifest.js";
import { tightenClip } from "../browser-agent/tighten-clip.js";
import { getMediaDurationMs } from "../shared/ffprobe.js";
import { ElevenLabsProvider, type TtsProvider } from "./elevenlabs.js";
import type { Config } from "../cli/config.js";
import type { RunLogger } from "../shared/logger.js";
import type { RunPaths } from "../shared/paths.js";

/**
 * Stage 2.5: synthesizes a voice line per step from its narrationText, then re-paces each step's
 * video to match its narration length so audio and picture line up by construction (a long line
 * gets a longer clip, a short line a shorter one) — rather than both being pinned to a fixed
 * duration. Purely additive: it only fills in the manifest's audioPath/audioDurationMs (and
 * re-tightens clipPath/clipDurationMs to the voice length); analyze and capture are untouched.
 */
export async function narrate(params: {
  manifestPath: string;
  config: Config;
  paths: RunPaths;
  logger: RunLogger;
}): Promise<CaptureManifest> {
  const { manifestPath, config, paths, logger } = params;

  const manifest = CaptureManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));

  const provider: TtsProvider = createProvider(config);

  for (const step of manifest.steps) {
    if (!step.narrationText.trim()) {
      logger.warn(`Step ${step.id} has no narrationText; skipping audio`);
      continue;
    }

    const audioPath = join(paths.audioDir, `${step.id}.mp3`);
    logger.info(`Synthesizing narration for ${step.id}`);
    await provider.synthesizeToFile(step.narrationText, audioPath);
    const audioDurationMs = await getMediaDurationMs(audioPath);

    step.audioPath = audioPath;
    step.audioDurationMs = audioDurationMs;

    // Re-pace the video to the voice length. Setting target == min forces the clip to the audio
    // duration (speed up if longer, hold last frame if shorter). Only possible for captured steps.
    if (step.rawClipPath && audioDurationMs) {
      const audioSec = audioDurationMs / 1000;
      const narratedClip = join(paths.clipsDir, `${step.id}.narrated.mp4`);
      const retimed = await tightenClip(step.rawClipPath, narratedClip, {
        targetStepDurationSec: audioSec,
        minStepDurationSec: audioSec,
        removeIdleFrames: config.capture.tighten.removeIdleFrames,
      });
      if (retimed) {
        logger.info(
          `  ${step.id}: narration ${audioSec.toFixed(1)}s, clip re-paced to ${(
            retimed.durationMs / 1000
          ).toFixed(1)}s`
        );
        step.clipPath = retimed.path;
        step.clipDurationMs = retimed.durationMs;
      } else {
        logger.warn(`Re-pacing clip to narration failed for ${step.id}; keeping existing clip`);
      }
    }
  }

  await writeManifest(manifestPath, manifest);
  logger.info(`Narration complete; updated manifest at ${manifestPath}`);
  return manifest;
}

function createProvider(config: Config): TtsProvider {
  switch (config.narration.provider) {
    case "elevenlabs":
      return new ElevenLabsProvider({ voiceId: config.narration.voiceId ?? "", modelId: config.narration.modelId });
    default:
      throw new Error(`Unknown narration provider: ${config.narration.provider}`);
  }
}
