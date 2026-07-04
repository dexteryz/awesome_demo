import type Anthropic from "@anthropic-ai/sdk";
import { getClaudeClient, withRetry, type ModelConfig } from "../shared/claude-client.js";
import type { RunLogger } from "../shared/logger.js";
import { fetchPr, truncateDiffForPrompt } from "./fetch-pr.js";
import { DemoScriptSchema, demoScriptJsonSchema, type DemoScript } from "./schema.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";

const RECORD_TOOL_NAME = "record_demo_script";

export interface AnalyzeOptions {
  prRef: string;
  appBaseUrl: string;
  appStartPath: string;
  model: ModelConfig;
  logger: RunLogger;
}

export async function analyzePr(options: AnalyzeOptions): Promise<DemoScript> {
  const { prRef, appBaseUrl, appStartPath, model, logger } = options;

  logger.info(`Fetching PR data for ${prRef}`);
  const pr = await fetchPr(prRef);
  const diffForPrompt = truncateDiffForPrompt(pr.diff);
  if (diffForPrompt.truncated) {
    logger.warn("Diff was truncated to UI-relevant hunks before sending to Claude");
  }

  const userPrompt = buildUserPrompt(pr, diffForPrompt, { baseUrl: appBaseUrl, startPath: appStartPath });

  const client = getClaudeClient();
  logger.info(`Calling Claude (${model.model}) to script the demo flow`);

  const response = await withRetry(() =>
    client.messages.create({
      model: model.model,
      max_tokens: model.maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      tools: [
        {
          name: RECORD_TOOL_NAME,
          description: "Record the structured demo script for this PR.",
          input_schema: demoScriptJsonSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: RECORD_TOOL_NAME },
    })
  );

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === RECORD_TOOL_NAME
  );
  if (!toolUse) {
    throw new Error(
      `Claude did not call ${RECORD_TOOL_NAME}. stop_reason=${response.stop_reason}, content=${JSON.stringify(
        response.content
      )}`
    );
  }

  const rawScript = {
    ...(toolUse.input as Omit<DemoScript, "meta">),
    meta: {
      ...(toolUse.input as DemoScript).meta,
      prTitle: pr.title,
      prUrl: pr.url,
      generatedAt: new Date().toISOString(),
    },
  };

  const parsed = DemoScriptSchema.safeParse(rawScript);
  if (!parsed.success) {
    throw new Error(`Claude's demo script failed schema validation: ${parsed.error.message}`);
  }

  logger.info(`Demo script has ${parsed.data.steps.length} step(s): ${parsed.data.meta.featureName}`);
  return parsed.data;
}
