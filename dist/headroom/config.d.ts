import type { AdapterConfig } from "../config.js";
/** User-facing headroom config (acp.json `headroom` key). Accepts a boolean
 *  shorthand (`false` disables the stage entirely) or a settings object. */
export interface HeadroomSettings {
    enabled?: boolean;
    /** Base URL of the local Headroom compression proxy. Default:
     *  env HEADROOM_PROXY_URL > "http://127.0.0.1:8787". */
    proxyUrl?: string;
    /** Minimum tool-result text length (chars) before compression is attempted.
     *  Default: 4000 (~1K tokens). */
    minChars?: number;
    /** Max proxy calls per context event (latency cap on the LLM request path).
     *  Largest results are prioritized. Default: 8. */
    maxPerTurn?: number;
    /** Per-request timeout to the proxy. On timeout/absence the original text
     *  passes through uncompressed (fail-open). Default: 3000. */
    timeoutMs?: number;
    /** Extra tool names whose outputs must never be compressed (merged with
     *  the built-in ACP tool list). */
    protectedTools?: string[];
    /** Try to spawn the proxy when it is not reachable at startup.
     *  Default: true. */
    autoStart?: boolean;
    /** On session start, check (throttled to once per 24h) whether the
     *  installed headroom engine has a newer release and surface a hint to
     *  run /headroom-update. Never upgrades automatically. Default: true. */
    checkUpdatesOnStart?: boolean;
}
export interface ResolvedHeadroomConfig {
    enabled: boolean;
    proxyUrl: string;
    minChars: number;
    maxPerTurn: number;
    timeoutMs: number;
    protectedTools: string[];
    autoStart: boolean;
    checkUpdatesOnStart: boolean;
}
/** ACP's own tools whose results are load-bearing metadata or already-lean
 *  summaries — never mechanically compressed. */
export declare const DEFAULT_PROTECTED_TOOLS: string[];
export declare const DEFAULT_HEADROOM_CONFIG: ResolvedHeadroomConfig;
export declare function resolveHeadroom(adapter: AdapterConfig): ResolvedHeadroomConfig;
