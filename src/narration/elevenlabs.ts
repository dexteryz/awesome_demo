import { writeFile } from "node:fs/promises";

const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export interface TtsConfig {
  voiceId: string;
  modelId: string;
}

/**
 * A text-to-speech provider. Only ElevenLabs is implemented today, but the narrate stage depends
 * on this interface (not ElevenLabs directly) so another provider can be dropped in later without
 * touching the pipeline.
 */
export interface TtsProvider {
  synthesizeToFile(text: string, outputPath: string): Promise<void>;
}

export class ElevenLabsProvider implements TtsProvider {
  private readonly apiKey: string;
  private readonly config: TtsConfig;

  constructor(config: TtsConfig) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ELEVENLABS_API_KEY is not set. Add it to your .env (see .env.example) or export it before running narration."
      );
    }
    if (!config.voiceId) {
      throw new Error(
        "narration.voiceId is not set in demo-gen.config.json. Set it to your ElevenLabs voice id " +
          "(a cloned voice of yourself, or a stock voice) before running narration."
      );
    }
    this.apiKey = apiKey;
    this.config = config;
  }

  async synthesizeToFile(text: string, outputPath: string): Promise<void> {
    const maxRetries = 4;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetch(`${ELEVENLABS_TTS_URL}/${this.config.voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: this.config.modelId,
        }),
      });

      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        await writeFile(outputPath, buffer);
        return;
      }

      const detail = await res.text().catch(() => "");
      // 429 "system_busy" and 5xx are transient — back off and retry. 4xx (bad key/voice) are not.
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxRetries) {
        throw new Error(`ElevenLabs TTS failed (${res.status} ${res.statusText}): ${detail.slice(0, 300)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
    }
  }
}
