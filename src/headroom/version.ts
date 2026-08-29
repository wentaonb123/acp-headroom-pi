import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

/** Headroom engine discovery mirrors client.ts startProxy: prefer the
 *  `headroom` binary (uv tool shim on PATH), fall back to uv's ephemeral
 *  `tool run`. The fallback also serves as the canonical "latest version"
 *  probe — uv resolves and installs the newest compatible release into a
 *  throwaway env, honoring the user's own index/mirror configuration. */

const UV_TOOL_RUN = ["tool", "run", "--from", "headroom-ai[proxy]"];

export interface SpawnResult {
	code: number | null;
	stdout: string;
	stderr: string;
	combined: string;
	timedOut: boolean;
}

/** Capture a command's output with a hard timeout. On Windows, npm-style
 *  `.cmd` shims must be spawned as the .cmd file (raw `npm` hits EINVAL). */
export function runCapture(bin: string, args: string[], timeoutMs: number): Promise<SpawnResult> {
	return new Promise((resolve) => {
		let settled = false;
		let stdout = "";
		let stderr = "";
		const child = spawn(bin, args, { windowsHide: true });
		child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
		child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			try { child.kill(); } catch { /* already gone */ }
			resolve({ code: null, stdout, stderr, combined: stdout + stderr, timedOut: true });
		}, timeoutMs);
		child.on("error", (e) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ code: null, stdout, stderr: `${stderr}${e.message}\n`, combined: `${stdout}${stderr}${e.message}\n`, timedOut: false });
		});
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ code, stdout, stderr, combined: stdout + stderr, timedOut: false });
		});
	});
}

/** Parse the first semver-looking token out of `headroom --version` output. */
export function parseVersionLine(line: string): string | null {
	const m = /v?(\d+\.\d+(?:\.\d+)?)/.exec(line.trim());
	return m ? m[1]! : null;
}

/** Attempt `headroom --version` (3000ms), then the uv run fallback (15s —
 *  uv may need to resolve/the install a throwaway env on first use). */
export async function localHeadroomVersion(): Promise<string | null> {
	const direct = await runCapture("headroom", ["--version"], 3000);
	if (direct.code === 0 && !direct.timedOut) {
		const v = parseVersionLine(direct.stdout || direct.stderr);
		if (v) return v;
	}
	const viaUv = await runCapture("uv", [...UV_TOOL_RUN, "headroom", "--version"], 15_000);
	if (viaUv.code === 0 && !viaUv.timedOut) return parseVersionLine(viaUv.stdout || viaUv.stderr);
	return null;
}

/** Probe the newest release uv would resolve (session-start update check).
 *  Returns null when unreachable (offline / no uv) — callers treat null as
 *  "unknown", never "outdated". */
export async function latestResolvedHeadroomVersion(): Promise<string | null> {
	const viaUv = await runCapture("uv", [...UV_TOOL_RUN, "headroom", "--version"], 15_000);
	if (viaUv.code === 0 && !viaUv.timedOut) return parseVersionLine(viaUv.stdout || viaUv.stderr);
	return null;
}

export interface UpgradeResult {
	status: "upgraded" | "uptodate" | "error";
	version: string | null;
	from: string | null;
	to: string | null;
	output: string;
}

/** Parse `uv tool upgrade headroom-ai` output. Formats vary across uv
 *  releases, so this matches loosely and falls back on the exit code. */
export function parseUpgradeOutput(code: number | null, output: string): Omit<UpgradeResult, "output"> {
	// Line-anchored and case-sensitive: "Uninstalled headroom-ai v0.35.0"
	// must never be mistaken for the new version (it contains "installed").
	const toMatch = /(?:^|[\r\n])Installed[^\n]*headroom-ai\s*v?(\d+\.\d+(?:\.\d+)?)/.exec(output);
	const fromMatch = /(?:^|[\r\n])Uninstalled[^\n]*headroom-ai\s*v?(\d+\.\d+(?:\.\d+)?)/.exec(output);
	const already = /already up to date/i.test(output) || /audited/i.test(output);
	if (toMatch) return { status: "upgraded", version: toMatch[1]!, from: fromMatch?.[1] ?? null, to: toMatch[1]! };
	if (code === 0 && (already || fromMatch)) return { status: "uptodate", version: fromMatch?.[1] ?? null, from: null, to: null };
	if (code === 0 && toMatch === null) return { status: "uptodate", version: null, from: null, to: null };
	return { status: "error", version: null, from: fromMatch?.[1] ?? null, to: null };
}

/** Run `uv tool upgrade headroom-ai` (honors the user's own uv index/mirror
 *  config via inherited env). Default 120s — big wheels (scipy/onnxruntime)
 *  can take a while on first download. */
export async function upgradeHeadroomTool(timeoutMs = 120_000): Promise<UpgradeResult> {
	const res = await runCapture("uv", ["tool", "upgrade", "headroom-ai"], timeoutMs);
	const parsed = parseUpgradeOutput(res.code, res.combined);
	return { ...parsed, output: res.combined };
}

/** Latest published plugin version from npm (best-effort, UI hint only). */
export async function latestPluginVersion(): Promise<string | null> {
	const bin = process.platform === "win32" ? "npm.cmd" : "npm";
	const res = await runCapture(bin, ["view", "acp-headroom-pi", "version"], 15_000);
	if (res.code !== 0 || res.timedOut) return null;
	const v = parseVersionLine(res.stdout.trim());
	return v;
}

// ---------------------------------------------------------------------------
// Session-start update check state (throttled so every pi launch does not
// hit the network or spin up a uv resolve).

export interface VersionCheckState {
	checkedAt: number;
	local: string | null;
	latest: string | null;
}

export function stateFile(): string {
	return join(homedir(), ".pi", "acp-headroom", "version-check.json");
}

export const CHECK_TTL_MS = 24 * 60 * 60 * 1000;