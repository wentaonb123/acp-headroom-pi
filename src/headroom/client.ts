import { promises as fs } from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { logInfo, logWarn } from "../log.js";

/** HTTP client for the local Headroom compression proxy plus the plugin-side
 *  CCR disk backup. All functions fail-open (return null / false) — the stage
 *  treats any failure as "pass through uncompressed". */

export interface CompressOutcome {
	text: string;
	tokensBefore: number;
	tokensAfter: number;
	hashes: string[];
}

const HEALTH_TTL_MS = 30_000;
let healthyUntil = 0;

export function invalidateHealth(): void {
	healthyUntil = 0;
}

export async function proxyHealthy(baseUrl: string, timeoutMs = 1000): Promise<boolean> {
	if (Date.now() < healthyUntil) return true;
	try {
		const resp = await fetch(new URL("/health", baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
		if (resp.ok) {
			healthyUntil = Date.now() + HEALTH_TTL_MS;
			return true;
		}
	} catch {
		// not reachable
	}
	return false;
}

/** Best-effort proxy startup: `headroom` on PATH first, else
 *  `uv tool run --from "headroom-ai[proxy]" headroom`. Detached spawn; poll
 *  /health up to 20s. Returns true when the proxy answers.
 *  Spawned children are tracked so stopSpawnedProxies() can reclaim them on
 *  session shutdown — manually started proxies are never touched. */
const spawnedProxies = new Set<ChildProcess>();

export function stopSpawnedProxies(): void {
	for (const child of spawnedProxies) {
		try {
			child.kill();
		} catch {
			// already gone
		}
	}
	spawnedProxies.clear();
}

export async function startProxy(baseUrl: string): Promise<boolean> {
	const url = new URL(baseUrl);
	const port = url.port || "8787";
	const commands = [
		{ cmd: "headroom", args: ["proxy", "--port", port] },
		{ cmd: "uv", args: ["tool", "run", "--from", "headroom-ai[proxy]", "headroom", "proxy", "--port", port] },
	];
	let spawned: ChildProcess | undefined;
	for (const { cmd, args } of commands) {
		try {
			// windowsHide is load-bearing on Windows: without it, detached console
			// apps pop up a visible terminal window (headroom/uv are real .exe
			// files, so no shell is needed either).
			const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
			child.on("error", () => spawnedProxies.delete(child));
			spawnedProxies.add(child);
			child.unref();
			spawned = child;
		} catch {
			continue;
		}
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 500));
			if (await proxyHealthy(baseUrl)) return true;
		}
		void spawned?.kill();
		spawnedProxies.delete(spawned!);
	}
	return false;
}

/** Compress ONE tool output via POST /v1/compress (mode=ccr). The synthetic
 *  assistant-tool pair is the minimal OpenAI-shape wrapper the pipeline needs;
 *  protect_recent=0 keeps the lone tool message from being treated as a recent
 *  turn and skipped. Returns null on any failure or when compression gained
 *  nothing. */
export async function compressToolOutput(baseUrl: string, opts: { toolName: string; text: string; model?: string; timeoutMs: number }): Promise<CompressOutcome | null> {
	const body = {
		model: opts.model ?? "default",
		messages: [
			{
				role: "assistant",
				content: null,
				tool_calls: [{ id: "call_headroom_pi", type: "function", function: { name: opts.toolName || "tool", arguments: "{}" } }],
			},
			{ role: "tool", tool_call_id: "call_headroom_pi", content: opts.text },
		],
		config: { mode: "ccr", protect_recent: 0 },
	};
	try {
		const resp = await fetch(new URL("/v1/compress", baseUrl), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(opts.timeoutMs),
		});
		if (!resp.ok) {
			logWarn("headroom", { event: "compress-http-error", status: resp.status });
			return null;
		}
		healthyUntil = Date.now() + HEALTH_TTL_MS;
		const data = (await resp.json()) as {
			messages?: Array<{ role?: string; content?: unknown }>;
			tokens_before?: number;
			tokens_after?: number;
			ccr_hashes?: unknown;
		};
		const msgs = data.messages ?? [];
		let text: string | null = null;
		for (let i = msgs.length - 1; i >= 0; i--) {
			if (msgs[i]!.role === "tool") {
				text = contentToText(msgs[i]!.content);
				break;
			}
		}
		if (!text) return null;
		return {
			text,
			tokensBefore: numOr(data.tokens_before, 0),
			tokensAfter: numOr(data.tokens_after, 0),
			hashes: Array.isArray(data.ccr_hashes) ? data.ccr_hashes.filter((h): h is string => typeof h === "string") : [],
		};
	} catch (e) {
		logWarn("headroom", { event: "compress-failed", error: e instanceof Error ? e.message : String(e) });
		invalidateHealth();
		return null;
	}
}

function numOr(v: unknown, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function contentToText(content: unknown): string | null {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const parts = content
			.map((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text" ? (b as { text?: string }).text : undefined))
			.filter((t): t is string => typeof t === "string");
		return parts.length > 0 ? parts.join("\n") : null;
	}
	return null;
}

export function isValidHash(hash: string): boolean {
	return /^[a-f0-9]{24}$/i.test(hash);
}

// --- CCR disk backup: originals survive the proxy's TTL (~30 min default) ---
// ponytail: full copies per hash, no GC — a session's worth of tool outputs is
// KB-MB scale; add LRU eviction only if the directory ever matters on disk.

function ccrDir(): string {
	return process.env.HEADROOM_CCR_DIR ?? path.join(homedir(), ".pi", "acp-headroom", "ccr");
}

export async function saveOriginals(hashes: string[], original: string): Promise<void> {
	if (hashes.length === 0) return;
	try {
		const dir = ccrDir();
		await fs.mkdir(dir, { recursive: true });
		await Promise.all(hashes.map(async (h) => {
			if (!isValidHash(h)) return;
			const file = path.join(dir, `${h}.txt`);
			try {
				await fs.access(file);
			} catch {
				await fs.writeFile(file, original, "utf8");
			}
		}));
	} catch (e) {
		logWarn("headroom", { event: "ccr-save-failed", error: e instanceof Error ? e.message : String(e) });
	}
}

/** Retrieve by hash: local disk backup first (works past proxy TTL), then the
 *  proxy's /v1/retrieve. Returns null when both miss. */
export async function retrieveOriginal(baseUrl: string, hash: string, timeoutMs = 10_000): Promise<string | null> {
	if (!isValidHash(hash)) return null;
	try {
		return await fs.readFile(path.join(ccrDir(), `${hash}.txt`), "utf8");
	} catch {
		// fall through to the proxy
	}
	try {
		const resp = await fetch(new URL(`/v1/retrieve/${hash}`, baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
		if (!resp.ok) return null;
		const data: unknown = await resp.json();
		if (typeof data === "string") return data;
		if (data && typeof data === "object") {
			// Proxy response shape (server.py ccr_retrieve_get):
			// { hash, original_content, original_tokens, tool_name, ... }
			const obj = data as { original_content?: unknown; content?: unknown };
			if (typeof obj.original_content === "string") return obj.original_content;
			if (typeof obj.content === "string") return obj.content;
			return contentToText(obj.content) ?? JSON.stringify(data);
		}
		return null;
	} catch {
		return null;
	}
}

export function logHeadroomUnavailable(baseUrl: string): void {
	logInfo("headroom", { event: "proxy-unavailable", proxyUrl: baseUrl });
}
