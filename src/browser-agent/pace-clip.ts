import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getMediaDurationMs } from "../shared/ffprobe.js";

const execFileAsync = promisify(execFile);
const FF_MAXBUF = 50 * 1024 * 1024;

/** A tool action's wall-clock span, used to locate the meaningful moments within a recording. */
export interface ActionSpan {
  tool: string;
  startMs: number;
  endMs: number;
}

export interface PaceResult {
  path: string;
  durationMs: number;
}

/**
 * Removes dead air by time rather than by frame-differencing. The recording is full of Claude
 * "thinking" gaps between actions; frame-drop tools (mpdecimate) can't tell those static gaps from
 * a moving cursor (which changes only a few pixels), so they eat the glide. Instead we keep just the
 * windows around each real action — glide, click, result — and drop the gaps, leaving all motion at
 * true 1x speed. If the kept footage is shorter than minSec, the last frame is held.
 */
export async function paceClipToActions(
  rawPath: string,
  outPath: string,
  spans: ActionSpan[],
  recordStartMs: number,
  opts: { prerollSec: number; holdSec: number; gapMergeSec: number; minSec: number }
): Promise<PaceResult | null> {
  const rawMs = (await getMediaDurationMs(rawPath)) ?? 0;
  const rawSec = rawMs / 1000;

  const windows = buildWindows(spans, recordStartMs, rawSec, opts);
  if (windows.length === 0) {
    // No actions to anchor on — fall back to the tail of the clip (its final state).
    const start = Math.max(0, rawSec - Math.max(opts.minSec, 3));
    windows.push([start, rawSec]);
  }

  const selectExpr = windows.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+");

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        rawPath,
        "-vf",
        `select='${selectExpr}',setpts=N/FRAME_RATE/TB`,
        "-r",
        "30",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        outPath,
      ],
      { maxBuffer: FF_MAXBUF }
    );
    const durationMs = (await getMediaDurationMs(outPath)) ?? 0;
    if (durationMs / 1000 < opts.minSec) {
      const padded = await padToDuration(outPath, outPath.replace(/\.mp4$/, ".held.mp4"), opts.minSec);
      if (padded) return padded;
    }
    return { path: outPath, durationMs };
  } catch {
    return null;
  }
}

/** Extends a clip to targetSec by holding its last frame. Never speeds up or slows the motion. */
export async function padToDuration(inPath: string, outPath: string, targetSec: number): Promise<PaceResult | null> {
  const curMs = (await getMediaDurationMs(inPath)) ?? 0;
  const padSec = targetSec - curMs / 1000;
  if (padSec <= 0.05) return { path: inPath, durationMs: curMs };
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        inPath,
        "-vf",
        `tpad=stop_mode=clone:stop_duration=${padSec.toFixed(3)}`,
        "-r",
        "30",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        outPath,
      ],
      { maxBuffer: FF_MAXBUF }
    );
    const durationMs = await getMediaDurationMs(outPath);
    return durationMs ? { path: outPath, durationMs } : null;
  } catch {
    return null;
  }
}

function buildWindows(
  spans: ActionSpan[],
  recordStartMs: number,
  rawSec: number,
  opts: { prerollSec: number; holdSec: number; gapMergeSec: number }
): [number, number][] {
  if (spans.length === 0) return [];
  // Convert each action's wall-clock span to video seconds, padding the first with preroll (so the
  // starting page is briefly visible before the glide) and the last with a hold (to show the result).
  const raw: [number, number][] = spans
    .map((s) => {
      const a = (s.startMs - recordStartMs) / 1000;
      const b = (s.endMs - recordStartMs) / 1000;
      return [a, b] as [number, number];
    })
    .sort((p, q) => p[0] - q[0]);

  raw[0][0] -= opts.prerollSec;
  raw[raw.length - 1][1] += opts.holdSec;

  // Merge windows separated by less than gapMergeSec so tiny gaps don't produce visible jumps.
  const merged: [number, number][] = [];
  for (const [a, b] of raw) {
    const clampedA = Math.max(0, a);
    const clampedB = Math.min(rawSec, b);
    if (clampedB <= clampedA) continue;
    const last = merged[merged.length - 1];
    if (last && clampedA - last[1] <= opts.gapMergeSec) {
      last[1] = Math.max(last[1], clampedB);
    } else {
      merged.push([clampedA, clampedB]);
    }
  }
  return merged;
}
