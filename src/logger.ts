import { Effect, Logger, Layer, LogLevel } from "effect";
import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { homedir } from "node:os";
import { join } from "node:path";

const LOG_DIR = join(homedir(), ".devpulse");
const LOG_FILE = join(LOG_DIR, "devpulse.log");

const fileLogger = Logger.make(({ date, logLevel, message }) => {
  const timestamp = date.toISOString();
  const line = `[${timestamp}] [${logLevel.label}] ${
    typeof message === "string" ? message : JSON.stringify(message)
  }\n`;
  try {
    require("node:fs").appendFileSync(LOG_FILE, line);
  } catch {
    // swallow - can't log about logging failures
  }
});

const ensureLogDir = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(LOG_DIR, { recursive: true });
});

export const FileLoggerLive = Layer.merge(
  Logger.replace(Logger.defaultLogger, fileLogger),
  Layer.provide(Layer.effectDiscard(ensureLogDir), NodeContext.layer)
);

export { LOG_FILE };
