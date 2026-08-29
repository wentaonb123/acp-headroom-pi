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
export const DEFAULT_PROTECTED_TOOLS = [
	"compress", "decompress", "search_context", "acp_status",
	"headroom_retrieve",
	"acp_delegate", "acp_delegate_wait", "acp_delegate_cancel",
];

export const DEFAULT_HEADROOM_CONFIG: ResolvedHeadroomConfig = {
	enabled: true,
	proxyUrl: "http://127.0.0.1:8787",
	minChars: 4000,
	maxPerTurn: 8,
	timeoutMs: 3000,
	protectedTools: DEFAULT_PROTECTED_TOOLS,
	autoStart: true,
	checkUpdatesOnStart: true,
};

export function resolveHeadroom(adapter: AdapterConfig): ResolvedHeadroomConfig {
	const h = adapter.headroom;
	if (h === false) return { ...DEFAULT_HEADROOM_CONFIG, enabled: false };
	const s = typeof h === "object" && h !== null ? h : {};
	return {
		enabled: s.enabled !== false,
		proxyUrl: normalizeBase(process.env.HEADROOM_PROXY_URL ?? s.proxyUrl ?? DEFAULT_HEADROOM_CONFIG.proxyUrl),
		minChars: posInt(s.minChars, DEFAULT_HEADROOM_CONFIG.minChars),
		maxPerTurn: posInt(s.maxPerTurn, DEFAULT_HEADROOM_CONFIG.maxPerTurn),
		timeoutMs: posInt(s.timeoutMs, DEFAULT_HEADROOM_CONFIG.timeoutMs),
		protectedTools: unique([...DEFAULT_PROTECTED_TOOLS, ...(Array.isArray(s.protectedTools) ? s.protectedTools.filter((t): t is string => typeof t === "string") : [])]),
		autoStart: s.autoStart !== false,
		checkUpdatesOnStart: s.checkUpdatesOnStart !== false,
	};
}

function posInt(v: unknown, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function normalizeBase(url: string): string {
	return url.replace(/\/+$/, "");
}

function unique(items: string[]): string[] {
	return [...new Set(items)];
}
