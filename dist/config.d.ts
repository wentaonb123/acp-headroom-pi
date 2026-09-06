/** User-facing headroom settings, read from the `headroom` key of acp.json.
 *  Every other key in that file belongs to billion-context-pi — this plugin
 *  claims only this namespace, so the two config surfaces never collide. */
export interface HeadroomSettings {
    /** Set false to bypass the headroom stage entirely (ACP is unaffected). */
    enabled?: boolean;
    /** Base URL of the local headroom proxy. Env HEADROOM_PROXY_URL wins. */
    proxyUrl?: string;
    /** Pipeline mode passed to /v1/compress:
     *  "ccr" (default) — CCR markers + store writes; pairs with the
     *  headroom_retrieve tool.
     *  "lossy_inline" — marker-free, no retrieval round-trip.
     *  "lossless_then_lossy" — alias of lossy_inline. */
    mode?: "ccr" | "lossy_inline" | "lossless_then_lossy";
    /** Skip compression below this many messages (nothing worth optimizing). */
    minMessages?: number;
    /** Skip compression below this many characters of message text. */
    minPayloadChars?: number;
    /** Pin the first N messages byte-for-byte so the provider's prompt-cache
     *  prefix is not rewritten. Omit to let the proxy decide. */
    frozenMessageCount?: number;
    /** Per-request timeout. On timeout the original payload is sent as-is. */
    timeoutMs?: number;
    /** Spawn the proxy when it is not reachable. Default: true. */
    autoStart?: boolean;
}
export interface ResolvedHeadroom {
    enabled: boolean;
    proxyUrl: string;
    mode: "ccr" | "lossy_inline" | "lossless_then_lossy";
    minMessages: number;
    minPayloadChars: number;
    frozenMessageCount: number | undefined;
    timeoutMs: number;
    autoStart: boolean;
}
export declare const HEADROOM_DEFAULTS: ResolvedHeadroom;
export declare function resolveHeadroom(raw: unknown): ResolvedHeadroom;
/** Read only the `headroom` key from acp.json. Project config overrides
 *  global. Never throws — a missing or broken file falls back to defaults. */
export declare function loadHeadroomSettings(cwd: string): Promise<ResolvedHeadroom>;
