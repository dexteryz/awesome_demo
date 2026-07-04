import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

export function getClaudeClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in, or export it in your shell."
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export interface ModelConfig {
  model: string;
  maxTokens: number;
}

/** Retries transient (429/5xx/network) errors with exponential backoff. Does not retry 4xx client errors. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 3, baseDelayMs = 1000 }: { retries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable || attempt === retries) throw err;
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
