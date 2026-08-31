/** HTTP client for the local Headroom compression proxy plus the plugin-side
 *  CCR disk backup. All functions fail-open (return null / false) — the stage
 *  treats any failure as "pass through uncompressed". */
export interface CompressOutcome {
    text: string;
    tokensBefore: number;
    tokensAfter: number;
    hashes: string[];
}
declare function originOf(baseUrl: string): string;
export { originOf };
export declare function invalidateHealth(baseUrl?: string): void;
/** Hysteretic health check (per origin): positive result caches for 30s; a
 *  failure is retried once before counting as down (absorbs event-loop-stall
 *  aborts), and a confirmed outage is negatively cached for 15s. */
export declare function proxyHealthy(baseUrl: string, timeoutMs?: number): Promise<boolean>;
export declare function startProxy(baseUrl: string): Promise<boolean>;
export declare function stopSpawnedProxies(): void;
/** Compress ONE tool output via POST /v1/compress (mode=ccr). The synthetic
 *  assistant-tool pair is the minimal OpenAI-shape wrapper the pipeline needs;
 *  protect_recent=0 keeps the lone tool message from being treated as a recent
 *  turn and skipped. Returns null on any failure or when compression gained
 *  nothing. */
export declare function compressToolOutput(baseUrl: string, opts: {
    toolName: string;
    text: string;
    model?: string;
    timeoutMs: number;
}): Promise<CompressOutcome | null>;
/** Markers carry 24-hex (store default SHA-256[:24]) or 12-hex (SmartCrusher's
 *  Rust row-drop path, mirrored verbatim as the store key — see
 *  compression_store.store explicit_hash docs). */
export declare function isValidHash(hash: string): boolean;
export declare function saveOriginals(hashes: string[], original: string): Promise<void>;
/** Retrieve by hash: local disk backup first (works past proxy TTL), then the
 *  proxy's /v1/retrieve. Returns null when both miss. */
export declare function retrieveOriginal(baseUrl: string, hash: string, timeoutMs?: number): Promise<string | null>;
