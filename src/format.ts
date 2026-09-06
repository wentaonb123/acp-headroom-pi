import { log } from "./log.js";

/** Payload adapter between Pi's provider request and headroom's /v1/compress.
 *
 *  /v1/compress speaks OpenAI chat format. Pi hands us whatever shape the
 *  active provider uses (openai-completions, openai-responses,
 *  anthropic-messages, ...). Rather than guess at a lossy conversion, we only
 *  compress payloads we can round-trip exactly, and fail open on everything
 *  else — a missed optimization is recoverable, a mangled request is not.
 *
 *  Supported today: every message's content is a plain string (the common case
 *  for OpenAI-compatible providers). Structured content blocks (tool_use,
 *  thinking, images) are detected and skipped as a whole payload. */

export interface OpenAIMessage {
  role: string;
  content: string;
}

export interface PayloadView {
  /** OpenAI-shaped projection handed to the proxy. */
  messages: OpenAIMessage[];
  /** Write compressed text back into a clone of the original payload. */
  apply: (compressed: OpenAIMessage[]) => unknown;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Extract text from a content field we consider safe to round-trip.
 *  Returns undefined when the content carries structure we would not restore
 *  faithfully (tool calls, thinking blocks, images, ...). */
function plainText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    // All-text block arrays are safe (they are just a split string); anything
    // with a non-text block means the payload is out of scope.
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        parts.push(block);
        continue;
      }
      if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
        continue;
      }
      return undefined;
    }
    return parts.join("\n");
  }
  return undefined;
}

/** Build the compressible projection, or null when this payload must be sent
 *  untouched. The `reason` is logged once per shape so a skipped provider is
 *  diagnosable instead of silently never compressing. */
export function projectPayload(payload: unknown): PayloadView | null {
  if (!isRecord(payload)) return reject("payload-not-object");
  if (!Array.isArray(payload.messages)) return reject("no-messages-array");

  const messages: OpenAIMessage[] = [];
  const roles: string[] = [];
  for (const m of payload.messages) {
    if (!isRecord(m) || typeof m.role !== "string") return reject("message-missing-role");
    const text = plainText(m.content);
    if (text === undefined) return reject("structured-content");
    roles.push(m.role);
    messages.push({ role: m.role, content: text });
  }

  const original = payload.messages as unknown[];
  return {
    messages,
    apply: (compressed: OpenAIMessage[]): unknown => {
      // Preserve every non-role field of the original messages (tool_call_id,
      // name, ...) by index; only content is replaced. When the proxy returns a
      // different message count it merged or dropped entries, so we fall back
      // to the compressed array itself rather than mismatching indices.
      const next =
        compressed.length === original.length
          ? compressed.map((c, i) => {
              const src = original[i];
              if (isRecord(src)) return { ...src, content: c.content };
              return { role: roles[i] ?? c.role, content: c.content };
            })
          : compressed.map((c) => ({ role: c.role, content: c.content }));
      return { ...payload, messages: next };
    },
  };
}

let lastRejectReason: string | null = null;

function reject(reason: string): null {
  if (lastRejectReason !== reason) {
    lastRejectReason = reason;
    log.debug({ event: "payload-skipped", reason });
  }
  return null;
}

/** Rough character size of the compressible projection, for the minPayloadChars
 *  gate. Cheap: no serialization of the whole payload. */
export function payloadChars(messages: OpenAIMessage[]): number {
  let n = 0;
  for (const m of messages) n += m.content.length;
  return n;
}
