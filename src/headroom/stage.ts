import { createHash } from "node:crypto";
import type { CoreMessage } from "acp-kernel";
import type { AdapterConfig } from "../config.js";
import { resolveHeadroom, type ResolvedHeadroomConfig } from "./config.js";
import { compressToolOutput, proxyHealthy, saveOriginals, startProxy } from "./client.js";
import { debug, logInfo, logWarn } from "../log.js";

type StageCoreMessage = Pick<CoreMessage, "id" | "role" | "text" | "toolName">;

/** Canonical CCR retrieval-marker prefixes the proxy embeds in compressed
 *  text (see headroom transforms/content_router.py). A tool result carrying
 *  one is already compressed — never send it again. */
const ALREADY_COMPRESSED = ["Retrieve more: hash=", "Retrieve original: hash=", "<<ccr:"];

export interface HeadroomStats {
	applied: number;
	savedTokens: number;
}

export interface HeadroomApplyResult {
	/** coreMessage id → compressed replacement text. Caller substitutes into
	 *  the message array BEFORE token estimation / processTurn; patchRefTag
	 *  then rebuilds the final AgentMessage body automatically. */
	replacements: Map<string, string>;
	applied: number;
	savedTokens: number;
	/** False only when the proxy was unreachable this round. */
	available: boolean;
}

const EMPTY: HeadroomApplyResult = { replacements: new Map(), applied: 0, savedTokens: 0, available: true };

interface CacheEntry {
	text: string;
	tokensBefore: number;
	tokensAfter: number;
	hashes: string[];
}

// ponytail: naive clear at 500 entries — a session's candidates are far fewer;
// swap for LRU only if a months-long session ever shows re-compression cost.
const CACHE_MAX = 500;

export class HeadroomStage {
	stats: HeadroomStats = { applied: 0, savedTokens: 0 };
	private cache = new Map<string, CacheEntry>();
	private proxyTried = false;
	private unavailableNotified = false;

	constructor(readonly getAdapter: () => AdapterConfig) {}

	resetSession(): void {
		this.stats = { applied: 0, savedTokens: 0 };
		this.cache.clear();
		this.proxyTried = false;
		this.unavailableNotified = false;
	}

	/** Compress oversized tool results on the sent-view projection.
	 *  Returns id → replacement text; never throws (fail-open). */
	async apply(coreMessages: StageCoreMessage[], modelId: string): Promise<HeadroomApplyResult> {
		const cfg = resolveHeadroom(this.getAdapter());
		if (!cfg.enabled || coreMessages.length === 0) return EMPTY;
		try {
			return await this.applyInner(coreMessages, modelId, cfg);
		} catch (e) {
			logWarn("headroom", { event: "stage-error", error: e instanceof Error ? e.message : String(e) });
			return EMPTY;
		}
	}

	private async applyInner(coreMessages: StageCoreMessage[], modelId: string, cfg: ResolvedHeadroomConfig): Promise<HeadroomApplyResult> {
		if (!(await this.ensureProxy(cfg))) return { ...EMPTY, available: false };

		// Current-turn results are the model's active working set — never touched.
		let lastUserIdx = -1;
		for (let i = coreMessages.length - 1; i >= 0; i--) {
			if (coreMessages[i]!.role === "user") { lastUserIdx = i; break; }
		}

		const candidates = coreMessages
			.map((m, index) => ({ m, index }))
			.filter(({ m, index }) =>
				m.role === "tool"
				&& typeof m.text === "string"
				&& m.text.length >= cfg.minChars
				&& !cfg.protectedTools.includes(m.toolName ?? "")
				&& index < lastUserIdx
				&& !ALREADY_COMPRESSED.some((marker) => m.text!.includes(marker)));

		if (candidates.length === 0) return EMPTY;

		// Latency cap: only the largest results within the per-turn budget.
		const budget = new Set(
			[...candidates]
				.sort((a, b) => b.m.text!.length - a.m.text!.length)
				.slice(0, cfg.maxPerTurn)
				.map(({ index }) => index),
		);

		const result: HeadroomApplyResult = { replacements: new Map(), applied: 0, savedTokens: 0, available: true };
		for (const { m, index } of candidates) {
			if (!budget.has(index)) continue;
			const text = m.text!;
			const key = sha256(text);
			let entry = this.cache.get(key);
			if (!entry) {
				const outcome = await compressToolOutput(cfg.proxyUrl, { toolName: m.toolName ?? "", text, model: modelId, timeoutMs: cfg.timeoutMs });
				if (!outcome || outcome.text.length >= text.length) continue;
				entry = { text: outcome.text, tokensBefore: outcome.tokensBefore, tokensAfter: outcome.tokensAfter, hashes: outcome.hashes };
				if (this.cache.size >= CACHE_MAX) this.cache.clear();
				this.cache.set(key, entry);
				await saveOriginals(entry.hashes, text);
			}
			result.replacements.set(m.id, entry.text);
			result.applied += 1;
			result.savedTokens += Math.max(0, estimate(entry.tokensBefore, text) - estimate(entry.tokensAfter, entry.text));
		}
		if (result.applied > 0) {
			this.stats.applied += result.applied;
			this.stats.savedTokens += result.savedTokens;
			debug.event("headroom-applied", { applied: result.applied, savedTokens: result.savedTokens });
			logInfo("headroom", { event: "applied", count: result.applied, savedTokens: result.savedTokens });
		}
		return result;
	}

	/** Called by session_start after its own spawn attempt so the request-path
	 *  ensureProxy() never blocks on startProxy polling (up to 40s when the
	 *  binary is absent) — it only fast health-checks afterwards. */
	markProxyAttempted(): void {
		this.proxyTried = true;
	}

	private async ensureProxy(cfg: ResolvedHeadroomConfig): Promise<boolean> {
		if (await proxyHealthy(cfg.proxyUrl)) return true;
		if (cfg.autoStart && !this.proxyTried) {
			this.proxyTried = true;
			if (await startProxy(cfg.proxyUrl)) return true;
		}
		if (!this.unavailableNotified) {
			this.unavailableNotified = true;
			logWarn("headroom", { event: "proxy-unavailable", proxyUrl: cfg.proxyUrl, effect: "pass-through-uncompressed" });
		}
		return false;
	}
}

/** Prefer the proxy's tokenizer-backed counts; fall back to chars/4. */
function estimate(tokens: number, text: string): number {
	return tokens > 0 ? tokens : Math.ceil(text.length / 4);
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

// Factory-bound singleton so tools/commands that only receive `runtime`
// can still render headroom stats (same pattern as delegate-tool's usage).
let activeStage: HeadroomStage | null = null;

export function setActiveStage(stage: HeadroomStage | null): void {
	activeStage = stage;
}

export interface ActiveHeadroomSnapshot {
	stats: HeadroomStats;
	proxyUrl: string;
	enabled: boolean;
}

export function activeHeadroomSnapshot(): ActiveHeadroomSnapshot | null {
	if (!activeStage) return null;
	const cfg = resolveHeadroom(activeStage.getAdapter());
	return { stats: activeStage.stats, proxyUrl: cfg.proxyUrl, enabled: cfg.enabled };
}
