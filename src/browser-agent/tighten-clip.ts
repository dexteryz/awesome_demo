import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getMediaDurationMs } from "../shared/ffprobe.js";

const execFileAsync = promisify(execFile);

export interface TightenOptions {
  /** Long clips are sped up to land near this duration. Never slows a clip down. */
  targetStepDurationSec: number;
  /** Floor: a clip shorter than this (after any speed-up / idle removal) holds its last frame to reach it. */
  minStepDurationSec: number;
  /**
   * Optional aggressive pass that drops visually near-duplicate frames (mpdecimate) before pacing.
   * Good for extremely static UIs; combined with minStepDurationSec so a collapsed clip still holds
   * a viewable beat. Off by default because target-duration speed-up already handles most cases.
   */
  removeIdleFrames: boolean;
}

export interface TightenResult {
  path: string;
  durationMs: number;
}

/**
 * Post-processes a raw captured clip into a tighter, better-paced one: strips the dead air that
 * comes from recording the agent's per-turn API latency (a motionless page while Claude thinks),
 * so the demo doesn't hold a static screen for 10+ seconds. Speeds up over-long clips toward a
 * target duration (only ever faster, never slower) and holds a minimum beat so short/collapsed
 * clips stay viewable. Outputs h264 mp4 (plays in Hyperframes' Chromium renderer). Returns null
 * on failure so the caller can fall back to the untouched clip.
 */
export async function tightenClip(
  inputPath: string,
  outputPath: string,
  opts: TightenOptions
): Promise<TightenResult | null> {
  const origMs = (await getMediaDurationMs(inputPath)) ?? 0;

  const filters: string[] = [];
  if (opts.removeIdleFrames) {
    filters.push("mpdecimate", "setpts=N/FRAME_RATE/TB");
  }
  const origSec = origMs / 1000;
  if (origSec > opts.targetStepDurationSec && opts.targetStepDurationSec > 0) {
    const speed = origSec / opts.targetStepDurationSec;
    filters.push(`setpts=PTS/${speed.toFixed(4)}`);
  }
  const vf = filters.length > 0 ? filters.join(",") : "setpts=PTS";

  try {
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", inputPath, "-vf", vf, "-r", "30", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", outputPath],
      { maxBuffer: 50 * 1024 * 1024 }
    );

    let durationMs = (await getMediaDurationMs(outputPath)) ?? 0;

    // If idle removal (or a naturally short clip) left it under the floor, hold the last frame.
    if (durationMs / 1000 < opts.minStepDurationSec) {
      const padSec = opts.minStepDurationSec - durationMs / 1000;
      const paddedPath = outputPath.replace(/\.mp4$/, "") + ".padded.mp4";
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-i",
          outputPath,
          "-vf",
          `tpad=stop_mode=clone:stop_duration=${padSec.toFixed(3)}`,
          "-r",
          "30",
          "-an",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          paddedPath,
        ],
        { maxBuffer: 50 * 1024 * 1024 }
      );
      const paddedMs = await getMediaDurationMs(paddedPath);
      if (paddedMs) return { path: paddedPath, durationMs: paddedMs };
    }

    return { path: outputPath, durationMs: durationMs || origMs };
  } catch {
    return null;
  }
}
