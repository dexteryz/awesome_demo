import { appendFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface LogEntry {
  ts: string;
  [key: string]: unknown;
}

export class RunLogger {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
  }

  async log(entry: Record<string, unknown>): Promise<void> {
    const line: LogEntry = { ts: new Date().toISOString(), ...entry };
    await appendFile(this.filePath, JSON.stringify(line) + "\n", "utf8");
  }

  info(message: string, extra: Record<string, unknown> = {}): void {
    console.log(`[demo-gen] ${message}`);
    void this.log({ level: "info", message, ...extra });
  }

  warn(message: string, extra: Record<string, unknown> = {}): void {
    console.warn(`[demo-gen] WARN: ${message}`);
    void this.log({ level: "warn", message, ...extra });
  }

  error(message: string, extra: Record<string, unknown> = {}): void {
    console.error(`[demo-gen] ERROR: ${message}`);
    void this.log({ level: "error", message, ...extra });
  }
}
