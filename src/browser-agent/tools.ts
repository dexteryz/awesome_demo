import type { Anthropic } from "@anthropic-ai/sdk";
import type { Locator, Page } from "playwright";

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "click",
    description:
      "Click an element on the page. Describe it the way a user would see it (e.g. \"the 'Export' button in " +
      "the top-right of the table\"). If the accessibility snapshot showed a [ref=e_] id for this exact " +
      "element, pass it as elementRef for a faster, unambiguous match.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Human description of the element to click." },
        elementRef: { type: "string", description: "Optional ref id copied from the accessibility snapshot, e.g. 'e12'." },
      },
      required: ["description"],
    },
  },
  {
    name: "type",
    description: "Focus a text input/textarea and type text into it, optionally submitting with Enter afterward.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Human description of the input field." },
        text: { type: "string", description: "Text to type into the field." },
        submit: { type: "boolean", description: "If true, press Enter after typing." },
        elementRef: { type: "string", description: "Optional ref id copied from the accessibility snapshot." },
      },
      required: ["description", "text"],
    },
  },
  {
    name: "navigate",
    description: "Navigate the browser directly to a URL. Rarely needed once inside the app's flow.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "press_key",
    description: "Press a keyboard key (e.g. 'Escape', 'Tab', 'Enter') without targeting a specific element.",
    input_schema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "scroll",
    description: "Scroll the page viewport.",
    input_schema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"] },
        amount: { type: "string", enum: ["small", "page"] },
      },
      required: ["direction"],
    },
  },
  {
    name: "wait_for",
    description:
      "Wait until an element matching the description becomes visible (e.g. a modal appearing, a toast " +
      "confirmation). Use this to confirm a step's expectedOutcome before calling finish_step.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["description"],
    },
  },
  {
    name: "take_screenshot",
    description: "Take an extra screenshot right now if you need to double-check something. Rarely needed.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "finish_step",
    description:
      "Call this exactly once you are done attempting the step, whether it succeeded or not. success=true " +
      "only if the expectedOutcome is now visibly true on screen.",
    input_schema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        reason: { type: "string", description: "Brief explanation of why the step succeeded or failed." },
      },
      required: ["success", "reason"],
    },
  },
];

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface ToolExecutors {
  click(input: { description: string; elementRef?: string }): Promise<ToolResult>;
  type(input: { description: string; text: string; submit?: boolean; elementRef?: string }): Promise<ToolResult>;
  navigate(input: { url: string }): Promise<ToolResult>;
  press_key(input: { key: string }): Promise<ToolResult>;
  scroll(input: { direction: "up" | "down"; amount?: "small" | "page" }): Promise<ToolResult>;
  wait_for(input: { description: string; timeoutMs?: number }): Promise<ToolResult>;
  take_screenshot(): Promise<ToolResult>;
}

const CANDIDATE_ROLES = [
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "menuitem",
  "tab",
  "option",
  "combobox",
  "switch",
  "heading",
] as const;

function extractNameHint(description: string): string {
  const quoted = description.match(/["'‘’“”]([^"'‘’“”]+)["'‘’“”]/);
  return quoted ? quoted[1] : description;
}

/**
 * Resolves a natural-language element description against the live page, since the demo-script's
 * steps deliberately avoid hardcoded selectors. Tries an explicit ref first (fast path when the
 * agent quotes a [ref=e_] id straight from the ai-mode accessibility snapshot), then role-based
 * locators (most robust), then text/placeholder/label fallbacks. Returns null if nothing unique
 * was found so the caller can report a clear "element not found" tool_result back to the model.
 */
export async function resolveLocator(page: Page, description: string, elementRef?: string): Promise<Locator | null> {
  if (elementRef) {
    const refLocator = page.locator(`aria-ref=${elementRef}`);
    if ((await refLocator.count()) === 1) return refLocator;
  }

  const nameHint = extractNameHint(description);
  const candidates: Locator[] = [];

  for (const role of CANDIDATE_ROLES) {
    const locator = page.getByRole(role as never, { name: nameHint, exact: false });
    const count = await locator.count();
    if (count === 1) return locator;
    if (count > 1) candidates.push(locator.first());
  }

  const textLocator = page.getByText(nameHint, { exact: false });
  const textCount = await textLocator.count();
  if (textCount === 1) return textLocator;
  if (textCount > 1) candidates.push(textLocator.first());

  const placeholderLocator = page.getByPlaceholder(nameHint, { exact: false });
  if ((await placeholderLocator.count()) >= 1) return placeholderLocator.first();

  const labelLocator = page.getByLabel(nameHint, { exact: false });
  if ((await labelLocator.count()) >= 1) return labelLocator.first();

  if (candidates.length > 0) return candidates[0];
  return null;
}

export function createToolExecutors(page: Page): ToolExecutors {
  return {
    async click({ description, elementRef }) {
      const locator = await resolveLocator(page, description, elementRef);
      if (!locator) {
        return { content: `No element found matching description: "${description}"`, isError: true };
      }
      try {
        await locator.click({ timeout: 5000 });
        return { content: `Clicked element matching "${description}".` };
      } catch (err) {
        return { content: `Click failed: ${(err as Error).message}`, isError: true };
      }
    },

    async type({ description, text, submit, elementRef }) {
      const locator = await resolveLocator(page, description, elementRef);
      if (!locator) {
        return { content: `No input found matching description: "${description}"`, isError: true };
      }
      try {
        await locator.fill(text, { timeout: 5000 });
        if (submit) await locator.press("Enter");
        return { content: `Typed into field matching "${description}"${submit ? " and pressed Enter" : ""}.` };
      } catch (err) {
        return { content: `Type failed: ${(err as Error).message}`, isError: true };
      }
    },

    async navigate({ url }) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
        return { content: `Navigated to ${url}.` };
      } catch (err) {
        return { content: `Navigation failed: ${(err as Error).message}`, isError: true };
      }
    },

    async press_key({ key }) {
      try {
        await page.keyboard.press(key);
        return { content: `Pressed key ${key}.` };
      } catch (err) {
        return { content: `Key press failed: ${(err as Error).message}`, isError: true };
      }
    },

    async scroll({ direction, amount }) {
      const delta = (amount === "page" ? 800 : 200) * (direction === "up" ? -1 : 1);
      await page.mouse.wheel(0, delta);
      return { content: `Scrolled ${direction} (${amount ?? "small"}).` };
    },

    async wait_for({ description, timeoutMs }) {
      const nameHint = extractNameHint(description);
      const timeout = timeoutMs ?? 8000;
      try {
        await page.getByText(nameHint, { exact: false }).first().waitFor({ state: "visible", timeout });
        return { content: `Element matching "${description}" became visible.` };
      } catch {
        return { content: `Timed out waiting for element matching "${description}".`, isError: true };
      }
    },

    async take_screenshot() {
      return { content: "Screenshot will be attached in the next turn's page state." };
    },
  };
}
