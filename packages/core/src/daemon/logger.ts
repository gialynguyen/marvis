import * as fs from "node:fs";
import * as path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: unknown): void;
  close(): void;
}
export function createLogger(name: string, logFile?: string): Logger {
  let fileStream: fs.WriteStream | null = null;

  if (logFile) {
    const dir = path.dirname(logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fileStream = fs.createWriteStream(logFile, { flags: "a" });
    fileStream.on("error", (err) => {
      console.error(`Logger file stream error: ${err.message}`);
    });
  }

  const formatMessage = (level: LogLevel, message: string, data?: unknown): string => {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    return `${timestamp} [${name}] [${level.toUpperCase()}] ${message}${dataStr}`;
  };

  const log = (level: LogLevel, message: string, data?: unknown): void => {
    const formatted = formatMessage(level, message, data);

    // Always log to console
    if (level === "error") {
      console.error(formatted);
    } else {
      console.log(formatted);
    }

    // Also write to file if configured
    if (fileStream) {
      fileStream.write(`${formatted}\n`);
    }
  };

  return {
    debug: (message, data) => log("debug", message, data),
    info: (message, data) => log("info", message, data),
    warn: (message, data) => log("warn", message, data),
    error: (message, data) => log("error", message, data),
    close: () => fileStream?.close(),
  };
}
