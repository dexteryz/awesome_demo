import type { Browser, BrowserContext, Page } from "playwright";

export interface StepRecordingHandle {
  context: BrowserContext;
  page: Page;
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
  }
): Promise<StepRecordingHandle> {
  const context = await browser.newContext({
    storageState: params.storageStatePath,
    viewport: params.viewport,
    recordVideo: { dir: params.videoDir, size: params.videoSize },
  });
  const page = await context.newPage();
  return { context, page };
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
