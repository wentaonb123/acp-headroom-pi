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
/** Build the compressible projection, or null when this payload must be sent
 *  untouched. The `reason` is logged once per shape so a skipped provider is
 *  diagnosable instead of silently never compressing. */
export declare function projectPayload(payload: unknown): PayloadView | null;
/** Rough character size of the compressible projection, for the minPayloadChars
 *  gate. Cheap: no serialization of the whole payload. */
export declare function payloadChars(messages: OpenAIMessage[]): number;
