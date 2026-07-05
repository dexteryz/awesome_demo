import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CaptureManifestSchema, writeManifest, type CaptureManifest } from "../browser-agent/manifest.js";
import { padToDuration } from "../browser-agent/pace-clip.js";
import { getMediaDurationMs } from "../shared/ffprobe.js";
import { ElevenLabsProvider, type Alignment, type TtsProvider } from "./elevenlabs.js";
import type { Config } from "../cli/config.js";
import type { RunLogger } from "../shared/logger.js";
import type { RunPaths } from "../shared/paths.js";

/**
 * Stage 2.5: synthesizes a voice line per step from its narrationText, then re-paces each step's
 * video to match its narration length so audio and picture line up by construction (a long line
 * gets a longer clip, a short line a shorter one) — rather than both being pinned to a fixed
 * duration. Purely additive: it only fills in the manifest's audioPath/audioDurationMs (and
 * holds clipPath/clipDurationMs to the voice length); analyze and capture are untouched.
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
    // Rewrite the spoken text for pronunciation only; the caption still shows the original wording.
    const spokenText = applyPronunciations(step.narrationText, config.narration.pronunciations);

    let captionWords: { text: string; startSec: number }[] | null = null;
    if (config.narration.wordSync && provider.synthesizeToFileWithTimestamps) {
      const alignment = await provider.synthesizeToFileWithTimestamps(spokenText, audioPath);
      if (alignment) captionWords = wordTimings(alignment, step.narrationText);
    } else {
      await provider.synthesizeToFile(spokenText, audioPath);
    }
    const audioDurationMs = await getMediaDurationMs(audioPath);

    step.audioPath = audioPath;
    step.audioDurationMs = audioDurationMs;
    step.captionWords = captionWords;
    if (captionWords) logger.info(`  ${step.id}: ${captionWords.length} word timings for karaoke caption`);

    // Match the video to the voice by stretching the HOLD only — never touch the motion. The clip
    // is already paced to its action windows (glide at 1x); if the voice line is longer, hold the
    // final frame to fill it. If the clip is already longer, leave it and the audio finishes first.
    if (step.clipPath && audioDurationMs) {
      const audioSec = audioDurationMs / 1000;
      const narratedClip = join(paths.clipsDir, `${step.id}.narrated.mp4`);
      const retimed = await padToDuration(step.clipPath, narratedClip, audioSec);
      if (retimed) {
        logger.info(
          `  ${step.id}: narration ${audioSec.toFixed(1)}s, clip held to ${(retimed.durationMs / 1000).toFixed(1)}s`
        );
        step.clipPath = retimed.path;
        step.clipDurationMs = retimed.durationMs;
      } else {
        logger.warn(`Holding clip to narration failed for ${step.id}; keeping existing clip`);
      }
    }
  }

  await writeManifest(manifestPath, manifest);
  logger.info(`Narration complete; updated manifest at ${manifestPath}`);
  return manifest;
}

/**
 * Turns ElevenLabs per-character timing into per-word start times for the DISPLAYED caption. The
 * alignment is for the spoken (pronunciation-adjusted) text, so we aggregate its characters into
 * spoken words and pair them by index with the caption's words — pronunciation rewrites are
 * whole-word and space-free, so the token counts match. If they don't, we distribute evenly.
 */
function wordTimings(alignment: Alignment, displayedText: string): { text: string; startSec: number }[] {
  const displayed = displayedText.split(/\s+/).filter(Boolean);

  const spokenStarts: number[] = [];
  let inWord = false;
  const { characters, character_start_times_seconds: starts } = alignment;
  for (let i = 0; i < characters.length; i++) {
    const isSpace = /\s/.test(characters[i]);
    if (!isSpace && !inWord) {
      spokenStarts.push(starts[i]);
      inWord = true;
    } else if (isSpace) {
      inWord = false;
    }
  }

  const lastEnd = alignment.character_end_times_seconds[alignment.character_end_times_seconds.length - 1] ?? 0;
  if (spokenStarts.length === displayed.length) {
    return displayed.map((text, i) => ({ text, startSec: spokenStarts[i] }));
  }
  // Token counts diverged — space the caption words evenly across the audio as a graceful fallback.
  return displayed.map((text, i) => ({ text, startSec: (lastEnd * i) / displayed.length }));
}

/** Applies whole-word, case-insensitive pronunciation rewrites to the spoken text (TTS input only). */
function applyPronunciations(text: string, rules: { from: string; to: string }[]): string {
  let out = text;
  for (const { from, to } of rules) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "gi"), to);
  }
  return out;
}

function createProvider(config: Config): TtsProvider {
  switch (config.narration.provider) {
    case "elevenlabs":
      return new ElevenLabsProvider({ voiceId: config.narration.voiceId ?? "", modelId: config.narration.modelId });
    default:
      throw new Error(`Unknown narration provider: ${config.narration.provider}`);
  }
}
