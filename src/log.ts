import { appendFileSync, statSync, renameSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

/** Structured one-line-per-event log. Kept separate from billion-context-pi's
 *  log file so the two layers stay greppable independently
 *  (`grep '[headroom]' ~/.pi/acp-headroom.log`). All writes are best-effort —
 *  logging must never break the request path. */

const LOG_FILE = process.env.ACP_HEADROOM_LOG ?? path.join(homedir(), ".pi", "acp-headroom.log");
const MAX_BYTES = 10 * 1024 * 1024;

type Level = "info" | "warn" | "error";

let debugEnabled = process.env.ACP_DEBUG === "1" || process.env.ACP_DEBUG === "true";

export function setDebugEnabled(v: boolean): void {
  debugEnabled = v;
}

function rotateIfNeeded(): void {
  try {
    if (statSync(LOG_FILE).size > MAX_BYTES) renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    // missing file: nothing to rotate
  }
}

function write(level: Level, event: Record<string, unknown>): void {
  try {
    mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    rotateIfNeeded();
    appendFileSync(
      LOG_FILE,
      `${JSON.stringify({ ts: new Date().toISOString(), level, ...event })}\n`,
      "utf8",
    );
  } catch {
    // never throw from logging
  }
}

export const log = {
  info: (event: Record<string, unknown>) => write("info", event),
  warn: (event: Record<string, unknown>) => write("warn", event),
  error: (event: Record<string, unknown>) => write("error", event),
  debug: (event: Record<string, unknown>) => {
    if (debugEnabled) write("info", event);
  },
};
