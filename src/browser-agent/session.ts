import type { Page } from "playwright";
import { createToolExecutors } from "./tools.js";
import type { RunLogger } from "../shared/logger.js";

export interface SeedStep {
  action: "navigate" | "click" | "type" | "press_key" | "wait_for";
  target?: string;
  value?: string;
  key?: string;
}

function interpolateEnv(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
    const envVal = process.env[name];
    if (envVal === undefined) {
      throw new Error(`Seed step references env var \${${name}} which is not set.`);
    }
    return envVal;
  });
}

/**
 * Runs config.auth.seedSteps deterministically (not LLM-driven) through the same tool executors
 * used by the per-step agent loop, for speed/reliability on the well-known login flow. Reusing
 * the executors keeps description->locator resolution consistent between seeding and demo steps.
 */
export async function runSeedSteps(
  page: Page,
  seedSteps: SeedStep[],
  baseUrl: string,
  logger: RunLogger
): Promise<void> {
  const executors = createToolExecutors(page);
  for (const step of seedSteps) {
    switch (step.action) {
      case "navigate": {
        const target = step.target ?? "/";
        const url = /^https?:\/\//.test(target) ? target : new URL(target, baseUrl).toString();
        const result = await executors.navigate({ url });
        logger.info(`seed: navigate -> ${result.content}`);
        break;
      }
      case "click": {
        const result = await executors.click({ description: step.target ?? "" });
        logger.info(`seed: click -> ${result.content}`);
        break;
      }
      case "type": {
        const result = await executors.type({
          description: step.target ?? "",
          text: interpolateEnv(step.value ?? ""),
        });
        logger.info(`seed: type -> ${result.content}`);
        break;
      }
      case "press_key": {
        const result = await executors.press_key({ key: step.key ?? "Enter" });
        logger.info(`seed: press_key -> ${result.content}`);
        break;
      }
      case "wait_for": {
        const result = await executors.wait_for({ description: step.target ?? "" });
        logger.info(`seed: wait_for -> ${result.content}`);
        break;
      }
    }
  }
}
