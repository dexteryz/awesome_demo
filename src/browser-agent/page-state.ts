import type { Page } from "playwright";

export interface PageState {
  ariaSnapshot: string;
  screenshotBase64: string;
  url: string;
}

const MAX_ARIA_SNAPSHOT_CHARS = 12000;

/**
 * Captures both a structured accessibility snapshot (for reliable role/name-based locators, and
 * ref ids the agent can quote back) and a screenshot (for visual grounding: modal stacking,
 * disabled states, icon-only buttons) every turn of the browser agent loop.
 */
export async function capturePageState(page: Page): Promise<PageState> {
  let ariaSnapshot: string;
  try {
    ariaSnapshot = await page.locator("body").ariaSnapshot({ mode: "ai" });
  } catch (err) {
    ariaSnapshot = `(failed to capture accessibility snapshot: ${(err as Error).message})`;
  }
  if (ariaSnapshot.length > MAX_ARIA_SNAPSHOT_CHARS) {
    ariaSnapshot = ariaSnapshot.slice(0, MAX_ARIA_SNAPSHOT_CHARS) + "\n...[snapshot truncated]...";
  }

  const screenshotBuffer = await page.screenshot({ type: "png" });

  return {
    ariaSnapshot,
    screenshotBase64: screenshotBuffer.toString("base64"),
    url: page.url(),
  };
}
