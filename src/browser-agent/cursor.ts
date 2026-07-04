import type { Locator, Page } from "playwright";

export interface CursorMotion {
  /** Interpolation steps for a pointer glide — more steps = smoother, slower movement. */
  moveSteps: number;
  /** Pause after the pointer arrives, before clicking, so a viewer registers the target. */
  clickPauseMs: number;
  /** Per-character delay when typing, for realistic keystrokes. */
  typeDelayMs: number;
}

/**
 * Injected into every recorded page. Playwright's recordVideo captures page content but not the OS
 * cursor, and synthetic clicks teleport instantly — so we render our own cursor as a DOM element
 * that follows the real (Playwright-driven) mouse events. Combined with interpolated pointer moves
 * (see humanClick), this reproduces the visible glide-and-click a viewer expects from a screen-share.
 */
export const CURSOR_INIT_SCRIPT = `
(() => {
  if (window.__demoCursorInstalled) return;
  window.__demoCursorInstalled = true;
  const install = () => {
    if (!document.body) { requestAnimationFrame(install); return; }
    let x = window.innerWidth / 2, y = window.innerHeight / 2;
    const cursor = document.createElement('div');
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.cssText = 'position:fixed;top:0;left:0;width:24px;height:24px;margin:-3px 0 0 -3px;pointer-events:none;z-index:2147483647;transition:transform 0.04s linear;will-change:transform;';
    cursor.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 2 L3 19 L8 14 L11 21 L14 20 L11 13 L18 13 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cursor);
    const ring = document.createElement('div');
    ring.setAttribute('aria-hidden', 'true');
    ring.style.cssText = 'position:fixed;top:0;left:0;width:34px;height:34px;margin:-17px 0 0 -17px;border:2px solid rgba(37,99,235,0.7);border-radius:50%;pointer-events:none;z-index:2147483646;opacity:0;transition:opacity 0.25s ease, transform 0.25s ease;';
    document.body.appendChild(ring);
    const render = () => {
      cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      ring.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(0.4)';
    };
    render();
    document.addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; render(); }, true);
    document.addEventListener('mousedown', () => {
      ring.style.opacity = '1';
      ring.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(1)';
      setTimeout(() => { ring.style.opacity = '0'; ring.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(0.4)'; }, 220);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
`;

/** Glides the visible pointer to a locator's center, then clicks it (locator.click stays the reliable actuator). */
export async function humanClick(page: Page, locator: Locator, motion: CursorMotion): Promise<void> {
  await glideTo(page, locator, motion);
  await locator.click({ timeout: 5000 });
}

/** Glides to a field, focuses it, then types character-by-character for a realistic keystroke cadence. */
export async function humanType(
  page: Page,
  locator: Locator,
  text: string,
  submit: boolean,
  motion: CursorMotion
): Promise<void> {
  await glideTo(page, locator, motion);
  await locator.click({ timeout: 5000 });
  await locator.fill("");
  await locator.pressSequentially(text, { delay: motion.typeDelayMs });
  if (submit) await locator.press("Enter");
}

async function glideTo(page: Page, locator: Locator, motion: CursorMotion): Promise<void> {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: motion.moveSteps });
  await page.waitForTimeout(motion.clickPauseMs);
}
