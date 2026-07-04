import type { Anthropic } from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import { getClaudeClient, withRetry, type ModelConfig } from "../shared/claude-client.js";
import type { RunLogger } from "../shared/logger.js";
import type { DemoStep } from "../pr-analysis/schema.js";
import { toolDefinitions, createToolExecutors, type ToolExecutors } from "./tools.js";
import { capturePageState } from "./page-state.js";
import type { CursorMotion } from "./cursor.js";
import type { ToolCallLogEntry } from "./manifest.js";

const STEP_SYSTEM_PROMPT = `You are driving a real web browser, one step of a product demo at a time. You will \
be told the step's instruction and expected outcome, and shown the current page as both a screenshot and an \
accessibility snapshot (which includes [ref=e_] ids you can pass back as elementRef for precise clicks/types).

Work the tools to accomplish the instruction, then verify the expectedOutcome is visibly true (use wait_for if \
something needs a moment to appear) before calling finish_step. If you get stuck after a couple of attempts \
(element not found, click had no visible effect), call finish_step with success=false and a brief reason rather \
than looping indefinitely. Always call finish_step exactly once when you are done, whether you succeeded or not.`;

export interface StepAgentResult {
  success: boolean;
  reason: string;
  toolCallLog: ToolCallLogEntry[];
}

function stepContextText(step: DemoStep): string {
  return `Step instruction: ${step.instruction}\nExpected outcome: ${step.expectedOutcome}`;
}

async function pageStateContent(page: Page, step: DemoStep): Promise<Anthropic.ContentBlockParam[]> {
  const state = await capturePageState(page);
  return [
    { type: "image", source: { type: "base64", media_type: "image/png", data: state.screenshotBase64 } },
    {
      type: "text",
      text: `${stepContextText(step)}\n\nCurrent URL: ${state.url}\n\nAccessibility snapshot:\n${state.ariaSnapshot}`,
    },
  ];
}

async function runTool(
  executors: ToolExecutors,
  name: string,
  input: Record<string, unknown>
): Promise<{ content: string; isError?: boolean }> {
  switch (name) {
    case "click":
      return executors.click(input as { description: string; elementRef?: string });
    case "type":
      return executors.type(input as { description: string; text: string; submit?: boolean; elementRef?: string });
    case "navigate":
      return executors.navigate(input as { url: string });
    case "press_key":
      return executors.press_key(input as { key: string });
    case "scroll":
      return executors.scroll(input as { direction: "up" | "down"; amount?: "small" | "page" });
    case "wait_for":
      return executors.wait_for(input as { description: string; timeoutMs?: number });
    case "take_screenshot":
      return executors.take_screenshot();
    default:
      return { content: `Unknown tool ${name}`, isError: true };
  }
}

export async function runStepAgentLoop(params: {
  page: Page;
  step: DemoStep;
  model: ModelConfig;
  maxTurns: number;
  logger: RunLogger;
  motion?: CursorMotion | null;
}): Promise<StepAgentResult> {
  const { page, step, model, maxTurns, logger, motion } = params;
  const client = getClaudeClient();
  const executors = createToolExecutors(page, motion);
  const toolCallLog: ToolCallLogEntry[] = [];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: await pageStateContent(page, step) },
  ];

  for (let turn = 1; turn <= maxTurns; turn++) {
    const response = await withRetry(() =>
      client.messages.create({
        model: model.model,
        max_tokens: model.maxTokens,
        system: STEP_SYSTEM_PROMPT,
        messages,
        tools: toolDefinitions,
        tool_choice: { type: "auto" },
      })
    );

    messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
      return {
        success: false,
        reason: `Model stopped without calling finish_step (stop_reason=${response.stop_reason}): ${
          textBlock?.text ?? "(no text)"
        }`,
        toolCallLog,
      };
    }

    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
    let finishResult: { success: boolean; reason: string } | undefined;

    for (const toolUse of toolUseBlocks) {
      const input = toolUse.input as Record<string, unknown>;
      if (toolUse.name === "finish_step") {
        finishResult = input as { success: boolean; reason: string };
        toolResultBlocks.push({ type: "tool_result", tool_use_id: toolUse.id, content: "Step finished." });
        continue;
      }
      const result = await runTool(executors, toolUse.name, input);
      toolCallLog.push({ turn, tool: toolUse.name, input, resultSummary: result.content.slice(0, 300) });
      logger.info(`  [turn ${turn}] ${toolUse.name}(${JSON.stringify(input)}) -> ${result.content.slice(0, 120)}`);
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result.content,
        is_error: result.isError,
      });
    }

    if (finishResult) {
      return { success: finishResult.success, reason: finishResult.reason, toolCallLog };
    }

    const refreshedState = await pageStateContent(page, step);
    messages.push({ role: "user", content: [...toolResultBlocks, ...refreshedState] });
  }

  return { success: false, reason: `Turn budget (${maxTurns}) exceeded without calling finish_step`, toolCallLog };
}
