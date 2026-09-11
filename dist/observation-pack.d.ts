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
/** Only tool results larger than this participate. 64KB (~16K tokens) — above
 *  it even a 90% mechanical compression leaves thousands of lossy tokens, and
 *  exact paged recall beats a one-shot summary; below it headroom wins. */
export declare const OBSERVATION_THRESHOLD_BYTES: number;
/** Provider requests that still carry the full payload before the placeholder
 *  takes over. */
export declare const FULL_SENDS = 2;
/** Placeholder excerpt budget, split evenly between head and tail, whole
 *  lines only. */
export declare const PLACEHOLDER_EXCERPT_BYTES = 1024;
/** Recall chunks stay below headroom's per-message threshold (~4K chars) so
 *  the exact bytes the model asked for are never mechanically re-compressed. */
export declare const RECALL_MAX_BYTES: number;
export declare const RECALL_MAX_LINES = 60;
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
export declare function hash(value: string | Buffer): string;
export declare function estimateTokens(text: string): number;
export declare function countLines(text: string): number;
/** Pure-text tool results only: anything with errors or non-text blocks
 *  (images, tool calls) is out of scope and passes through untouched. */
export declare function isPureTextResult(message: PackableMessage): boolean;
export declare function isObservationId(id: string): boolean;
/** Per-session storage root: content-addressed objects + the JSONL ledger. */
export declare function observationRoot(sessionId: string): string;
export declare function observationPath(root: string, id: string): string;
export declare function createObservation(message: PackableMessage, root: string): Observation | undefined;
/** Write the payload to its content-addressed path, refusing symlinks and
 *  verifying an existing object byte for byte before reusing it. */
export declare function ensureStored(observation: Observation): Promise<void>;
export declare function placeholderFor(observation: Observation): string;
/** The projection: replace oversized past tool results with placeholders and
 *  return the new array. Stateless send-counting — a message has been part of
 *  exactly as many provider requests as there are assistant messages after
 *  it, so no cross-round state is needed and counts survive restarts. */
export declare function projectObservations<T extends PackableMessage>(messages: T[], root: string): Promise<T[] | undefined>;
export interface RecallChunk {
    readonly text: string;
    readonly bytes: number;
    readonly lines: number;
    readonly nextOffset: number;
    readonly eof: boolean;
}
export declare function readRecallChunk(path: string, offset: number, limits: {
    readonly maxBytes: number;
    readonly maxLines: number;
}): Promise<RecallChunk>;
/** Append-only JSONL record of what the mechanism did, for post-hoc
 *  debugging. Best-effort: ledger failures never break the request path. */
export declare function logLedger(root: string, entry: Record<string, unknown>): Promise<void>;
