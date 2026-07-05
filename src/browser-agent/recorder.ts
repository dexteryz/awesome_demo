import type { Browser, BrowserContext, Page } from "playwright";
import { CURSOR_INIT_SCRIPT } from "./cursor.js";

export interface StepRecordingHandle {
  context: BrowserContext;
  page: Page;
  /** Wall-clock time (ms) recording began, for mapping action timestamps to video time. */
  recordStartMs: number;
}

/**
 * Opens a fresh per-step browser context with video recording enabled. Playwright's recordVideo
 * is a context-creation-time option (no supported mid-context start/stop), so one context per
 * demo-script step is the natural unit of recording — see agent-loop/manifest for how step
 * boundaries and storageState carry continuity across these fresh contexts.
 */
export async function openStepContext(
  browser: Browser,
  params: {
    storageStatePath?: string;
    viewport: { width: number; height: number };
    videoDir: string;
    videoSize: { width: number; height: number };
    injectCursor?: boolean;
  }
): Promise<StepRecordingHandle> {
  const recordStartMs = Date.now();
  const context = await browser.newContext({
    storageState: params.storageStatePath,
    viewport: params.viewport,
    recordVideo: { dir: params.videoDir, size: params.videoSize },
  });
  if (params.injectCursor) {
    // Runs before page scripts on every navigation, so the synthetic cursor survives in-app routing.
    await context.addInitScript(CURSOR_INIT_SCRIPT);
  }
  const page = await context.newPage();
  if (params.injectCursor) {
    // Seat the virtual pointer at viewport center so the first glide starts from the middle,
    // matching where the injected cursor initializes (no jump from the 0,0 corner).
    await page.mouse.move(params.viewport.width / 2, params.viewport.height / 2);
  }
  return { context, page, recordStartMs };
}

/** Closes the context (finalizing the video file to disk) and returns the resulting video path, if any. */
export async function closeStepContext(handle: StepRecordingHandle): Promise<string | null> {
  const video = handle.page.video();
  await handle.context.close();
  if (!video) return null;
  try {
    return await video.path();
  } catch {
    return null;
  }
}
