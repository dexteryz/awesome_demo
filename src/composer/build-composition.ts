import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { DemoScript } from "../pr-analysis/schema.js";
import type { CaptureManifest } from "../browser-agent/manifest.js";
import { introCardHtml } from "./templates/intro-card.html.js";
import { outroCardHtml } from "./templates/outro-card.html.js";
import { successStepHtml, failedStepFallbackHtml } from "./templates/step-segment.html.js";

const WIDTH = 1920;
const HEIGHT = 1080;
const INTRO_DURATION_SEC = 3;
const OUTRO_DURATION_SEC = 3;

export interface BuildCompositionResult {
  compositionPath: string;
  totalDurationSec: number;
}

/**
 * Turns a CaptureManifest (+ the DemoScript it was captured from) into a Hyperframes `index.html`
 * composition: an intro card, one segment per manifest step (a muted <video> + caption overlay on
 * success, or a static fallback card on failure so partial captures still assemble end-to-end),
 * and an outro card. Every timed element carries class="clip" and data-start/data-duration/
 * data-track-index per Hyperframes' runtime requirements.
 */
export async function buildComposition(params: {
  demoScript: DemoScript;
  manifest: CaptureManifest;
  hyperframesProjectDir: string;
  fallbackStepDurationSec: number;
  hideCaptionsWhenNarrated: boolean;
}): Promise<BuildCompositionResult> {
  const { demoScript, manifest, hyperframesProjectDir, fallbackStepDurationSec, hideCaptionsWhenNarrated } = params;

  const assetsDir = join(hyperframesProjectDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const stepsById = new Map(demoScript.steps.map((s) => [s.id, s]));

  let currentTime = INTRO_DURATION_SEC;
  const segments: string[] = [];

  for (const manifestStep of manifest.steps) {
    const demoStep = stepsById.get(manifestStep.id);
    const shortLabel = manifestStep.captionText || demoStep?.captionText || manifestStep.instruction;

    // Copy the narration audio (if the narrate stage produced it) into the composition and time the
    // segment to it. hideCaptionsWhenNarrated lets a narrated video drop the burned-in caption.
    let audioSrc: string | undefined;
    if (manifestStep.audioPath) {
      const audioFileName = `${manifestStep.id}.mp3`;
      await copyFile(manifestStep.audioPath, join(assetsDir, audioFileName));
      audioSrc = `assets/${audioFileName}`;
    }
    const showCaption = !(audioSrc && hideCaptionsWhenNarrated);
    // When narrated, the caption is a subtitle of the spoken line so the read text matches the
    // heard text; otherwise it's the short action label.
    const captionText = audioSrc ? manifestStep.narrationText || shortLabel : shortLabel;

    if (manifestStep.status === "success" && manifestStep.clipPath) {
      const durationSec = manifestStep.clipDurationMs
        ? manifestStep.clipDurationMs / 1000
        : demoStep?.estimatedDurationSec ?? fallbackStepDurationSec;

      const assetFileName = `${manifestStep.id}${extname(manifestStep.clipPath)}`;
      await copyFile(manifestStep.clipPath, join(assetsDir, assetFileName));

      segments.push(
        successStepHtml({
          start: currentTime,
          duration: durationSec,
          clipSrc: `assets/${assetFileName}`,
          captionText,
          audioSrc,
          showCaption,
        })
      );
      currentTime += durationSec;
    } else {
      // For a failed step, prefer the narration length so the fallback card holds for the voice line.
      const durationSec = manifestStep.audioDurationMs
        ? manifestStep.audioDurationMs / 1000
        : fallbackStepDurationSec;
      segments.push(failedStepFallbackHtml({ start: currentTime, duration: durationSec, captionText, audioSrc }));
      currentTime += durationSec;
    }
  }

  const outroStart = currentTime;
  const totalDurationSec = outroStart + OUTRO_DURATION_SEC;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${WIDTH}, height=${HEIGHT}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #000; }
      body { font-family: "Inter", sans-serif; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="root" data-start="0" data-duration="${totalDurationSec}"
         data-width="${WIDTH}" data-height="${HEIGHT}">
      ${introCardHtml({
        start: 0,
        duration: INTRO_DURATION_SEC,
        featureName: demoScript.meta.featureName,
        narrative: demoScript.userStory.narrative,
      })}
      ${segments.join("\n")}
      ${outroCardHtml({
        start: outroStart,
        duration: OUTRO_DURATION_SEC,
        prTitle: demoScript.meta.prTitle,
        prUrl: demoScript.meta.prUrl,
      })}
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["root"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;

  const compositionPath = join(hyperframesProjectDir, "index.html");
  await writeFile(compositionPath, html, "utf8");

  return { compositionPath, totalDurationSec };
}

function extname(path: string): string {
  const idx = basename(path).lastIndexOf(".");
  return idx === -1 ? "" : basename(path).slice(idx);
}
