/**
 * ObservationPack — keep oversized tool results reachable without replaying
 * them.
 *
 * Adapted from NVLabs/SoL-Pi (MIT, https://github.com/NVlabs/SoL-Pi),
 * src/sol-pi/extensions/observation-pack/. A large tool result is sent in
 * full for its first few provider requests, then replaced with a short,
 * stable placeholder for every later request. The original bytes are archived
 * content-addressed outside the provider context, and the agent pulls exact
 * pages back with the registered `obs_recall` tool.
 *
 * Layering with headroom (the conflict rule this plugin adds on top):
 *  - >= OBSERVATION_THRESHOLD_BYTES: ObservationPack owns the message. For its
 *    first FULL_SENDS requests the full text still reaches the wire (headroom
 *    may lossy-compress those copies for immediate value); afterwards the
 *    ~1KB placeholder replaces it and headroom's per-message threshold skips
 *    it for good.
 *  - below the threshold: headroom's mechanical compression, unchanged.
 *  - Recall chunks are capped below headroom's per-message eligibility
 *    threshold (~1K tokens / 4K chars) so an exact recall is never
 *    re-compressed into something inexact.
 *
 * The mechanism never edits history in place. It rewrites only at the
 * projection layer (pi's `context` event, chained after billion-context-pi),
 * so the stored session stays intact and recall keeps working after native
 * compaction or a session resume. Every step fails open.
 */

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, lstat, mkdir, open, appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Only tool results larger than this participate. 64KB (~16K tokens) — above
 *  it even a 90% mechanical compression leaves thousands of lossy tokens, and
 *  exact paged recall beats a one-shot summary; below it headroom wins. */
export const OBSERVATION_THRESHOLD_BYTES = 64 * 1024;
/** Provider requests that still carry the full payload before the placeholder
 *  takes over. */
export const FULL_SENDS = 2;
/** Placeholder excerpt budget, split evenly between head and tail, whole
 *  lines only. */
export const PLACEHOLDER_EXCERPT_BYTES = 1024;
/** Recall chunks stay below headroom's per-message threshold (~4K chars) so
 *  the exact bytes the model asked for are never mechanically re-compressed. */
export const RECALL_MAX_BYTES = 3 * 1024;
export const RECALL_MAX_LINES = 60;
const RECALL_HEADER_RESERVE_BYTES = 512;
const RECALL_HEADER_LINES = 2;
const RECALL_LIMITS = {
  maxBytes: RECALL_MAX_BYTES - RECALL_HEADER_RESERVE_BYTES,
  maxLines: RECALL_MAX_LINES - RECALL_HEADER_LINES,
};

const CHARS_PER_TOKEN = 4;
const OBSERVATION_ID_PATTERN = /^obs_[a-f0-9]{24}$/u;
const READ_OBJECT_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const CREATE_OBJECT_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

export interface Observation {
  readonly id: string;
  readonly contentHash: string;
  readonly filePath: string;
  readonly toolName: string;
  readonly text: string;
  readonly bytes: number;
  readonly lines: number;
  readonly tokens: number;
}

/** Structural view of a projected context message — roles and shapes vary
 *  across hosts, so everything works on duck-typed records and fails open. */
export interface PackableMessage {
  role?: string;
  isError?: boolean;
  content?: unknown;
}

export function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = text.endsWith("\n") ? 0 : 1;
  for (const character of text) {
    if (character === "\n") lines += 1;
  }
  return lines;
}

function countBufferLines(buffer: Buffer): number {
  if (buffer.length === 0) return 0;
  let lines = buffer[buffer.length - 1] === 0x0a ? 0 : 1;
  for (const byte of buffer) {
    if (byte === 0x0a) lines += 1;
  }
  return lines;
}

/** Pure-text tool results only: anything with errors or non-text blocks
 *  (images, tool calls) is out of scope and passes through untouched. */
export function isPureTextResult(message: PackableMessage): boolean {
  return (
    message.role === "toolResult" &&
    message.isError !== true &&
    Array.isArray(message.content) &&
    message.content.length > 0 &&
    message.content.every((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function textFromResult(message: PackableMessage): string {
  return (message.content as Array<{ text: string }>).map((block) => block.text).join("\n");
}

function toolCallIdOf(message: PackableMessage): string {
  const id = (message as { toolCallId?: unknown }).toolCallId;
  return typeof id === "string" ? id : "";
}

function toolNameOf(message: PackableMessage): string {
  const name = (message as { toolName?: unknown }).toolName;
  return typeof name === "string" ? name : "";
}

export function isObservationId(id: string): boolean {
  return OBSERVATION_ID_PATTERN.test(id);
}

/** Per-session storage root: content-addressed objects + the JSONL ledger. */
export function observationRoot(sessionId: string): string {
  return join(homedir(), ".pi", "acp-headroom", "observations", sessionId || "default");
}

export function observationPath(root: string, id: string): string {
  return join(root, "objects", `${id}.txt`);
}

export function createObservation(
  message: PackableMessage,
  root: string,
): Observation | undefined {
  const text = textFromResult(message);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= OBSERVATION_THRESHOLD_BYTES) return undefined;

  const contentHash = hash(text);
  const id = `obs_${hash(`${toolNameOf(message)}\0${toolCallIdOf(message)}\0${contentHash}`).slice(0, 24)}`;
  return {
    id,
    contentHash,
    filePath: observationPath(root, id),
    toolName: toolNameOf(message),
    text,
    bytes,
    lines: countLines(text),
    tokens: estimateTokens(text),
  };
}

/** Write the payload to its content-addressed path, refusing symlinks and
 *  verifying an existing object byte for byte before reusing it. */
export async function ensureStored(observation: Observation): Promise<void> {
  const directoryPath = dirname(observation.filePath);
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });
  const directoryStats = await lstat(directoryPath);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new Error(`Observation directory is not a regular directory for ${observation.id}`);
  }

  let handle: FileHandle | undefined;
  try {
    handle = await open(observation.filePath, CREATE_OBJECT_FLAGS, 0o600);
    await handle.writeFile(observation.text, { encoding: "utf8" });
  } catch (error) {
    if (!isRecord(error) || error.code !== "EEXIST") throw error;
    const existingHandle = await open(observation.filePath, READ_OBJECT_FLAGS);
    try {
      const existing = await existingHandle.stat();
      if (!existing.isFile()) {
        throw new Error(`Content-addressed observation is not a regular file for ${observation.id}`);
      }
      if (existing.size !== observation.bytes) {
        throw new Error(`Content-addressed observation size mismatch for ${observation.id}`);
      }
      const existingContent = await existingHandle.readFile();
      if (hash(existingContent) !== observation.contentHash) {
        throw new Error(`Content-addressed observation hash mismatch for ${observation.id}`);
      }
    } finally {
      await existingHandle.close();
    }
  } finally {
    await handle?.close();
  }
}

function completeLineExcerpt(text: string, budgetBytes: number, fromEnd: boolean): string {
  const lines = text.split(/(?<=\n)/);
  const selected: string[] = [];
  let selectedBytes = 0;
  let index = fromEnd ? lines.length - 1 : 0;

  while (index >= 0 && index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (selectedBytes + lineBytes > budgetBytes) break;
    if (fromEnd) selected.unshift(line);
    else selected.push(line);
    selectedBytes += lineBytes;
    index += fromEnd ? -1 : 1;
  }

  return selected.join("");
}

export function placeholderFor(observation: Observation): string {
  const headBudget = Math.floor(PLACEHOLDER_EXCERPT_BYTES / 2);
  const tailBudget = PLACEHOLDER_EXCERPT_BYTES - headBudget;
  const head = completeLineExcerpt(observation.text, headBudget, false);
  const tail = completeLineExcerpt(observation.text, tailBudget, true);
  return [
    `[large tool result replaced after its first ${FULL_SENDS} provider requests]`,
    `id: ${observation.id}`,
    `tool: ${observation.toolName}`,
    `original_bytes: ${observation.bytes}`,
    `original_lines: ${observation.lines}`,
    `estimated_tokens: ${observation.tokens}`,
    `retrieve: call obs_recall with {"id":"${observation.id}","offset":0}; continue with returned next_offset`,
    `[first complete lines, up to ${headBudget} bytes]`,
    head,
    `[middle omitted; last complete lines, up to ${tailBudget} bytes]`,
    tail,
    `[${observation.bytes} original bytes omitted]`,
  ].join("\n");
}

/** The projection: replace oversized past tool results with placeholders and
 *  return the new array. Stateless send-counting — a message has been part of
 *  exactly as many provider requests as there are assistant messages after
 *  it, so no cross-round state is needed and counts survive restarts. */
export async function projectObservations<T extends PackableMessage>(
  messages: T[],
  root: string,
): Promise<T[] | undefined> {
  const priorAssistantCounts = new Array<number>(messages.length);
  let assistantCount = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    priorAssistantCounts[index] = assistantCount;
    if (messages[index]?.role === "assistant") assistantCount += 1;
  }

  let changed = false;
  const out = [...messages];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (priorAssistantCounts[index]! < FULL_SENDS) continue;
    if (!isPureTextResult(message)) continue;
    try {
      const observation = createObservation(message, root);
      if (!observation) continue;
      // Archive before replacing: a placeholder without its object would be
      // an unrecoverable loss, so a storage failure (caught below) keeps the
      // full text in context.
      await ensureStored(observation);
      out[index] = { ...message, content: [{ type: "text", text: placeholderFor(observation) }] };
      changed = true;
      void logLedger(root, {
        event: "placeholder",
        id: observation.id,
        tool: observation.toolName,
        originalBytes: observation.bytes,
        originalTokens: observation.tokens,
        priorSends: priorAssistantCounts[index],
      }).catch(() => {});
    } catch (error) {
      // Fail open: a packing failure must never cost the agent its observation.
      void logLedger(root, {
        event: "pack-failed",
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => {});
    }
  }
  return changed ? out : undefined;
}

// --- recall ------------------------------------------------------------------

export interface RecallChunk {
  readonly text: string;
  readonly bytes: number;
  readonly lines: number;
  readonly nextOffset: number;
  readonly eof: boolean;
}

function trimUtf8End(buffer: Buffer, limit: number): number {
  let end = limit;
  while (end > 0 && end < buffer.length && ((buffer[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return end;
}

export async function readRecallChunk(
  path: string,
  offset: number,
  limits: { readonly maxBytes: number; readonly maxLines: number },
): Promise<RecallChunk> {
  const handle = await open(path, READ_OBJECT_FLAGS);
  try {
    const fileStats = await handle.stat();
    if (!fileStats.isFile()) throw new Error("Stored observation is not a regular file");
    if (offset > fileStats.size) throw new Error(`Offset ${offset} exceeds observation size ${fileStats.size}`);

    const available = Math.max(0, fileStats.size - offset);
    const buffer = Buffer.alloc(Math.min(available, limits.maxBytes + 4));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    let end = Math.min(bytesRead, limits.maxBytes);
    let newlineCount = 0;

    for (let index = 0; index < end; index += 1) {
      if (buffer[index] !== 0x0a) continue;
      newlineCount += 1;
      if (newlineCount === limits.maxLines) {
        end = index + 1;
        break;
      }
    }

    end = trimUtf8End(buffer, end);
    const chunk = buffer.subarray(0, end);
    const nextOffset = offset + chunk.length;
    return {
      text: chunk.toString("utf8"),
      bytes: chunk.length,
      lines: countBufferLines(chunk),
      nextOffset,
      eof: nextOffset >= fileStats.size,
    };
  } finally {
    await handle.close();
  }
}

// --- ledger ------------------------------------------------------------------

/** Append-only JSONL record of what the mechanism did, for post-hoc
 *  debugging. Best-effort: ledger failures never break the request path. */
export async function logLedger(root: string, entry: Record<string, unknown>): Promise<void> {
  const path = join(root, "ledger.jsonl");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`, "utf8");
}
