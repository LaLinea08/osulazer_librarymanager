import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export class StructuredLogger {
  public constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.rotateIfNeeded();
  }

  private rotateIfNeeded(): void {
    try {
      if (statSync(this.path).size > 2 * 1024 * 1024) {
        renameSync(this.path, `${this.path}.previous`);
      }
    } catch {
      // A missing or temporarily inaccessible log does not block startup.
    }
  }

  public write(
    level: LogLevel,
    event: string,
    details: Record<string, unknown> = {},
  ): void {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...details,
    });
    try {
      appendFileSync(this.path, `${entry}\n`, { encoding: "utf8" });
    } catch {
      // Diagnostics must never make an otherwise healthy application unusable.
    }
  }
}

export function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}
