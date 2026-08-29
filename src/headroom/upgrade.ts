import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AdapterConfig } from "../config.js";
import { logInfo, logWarn } from "../log.js";
import { resolveHeadroom } from "./config.js";
import { invalidateHealth, proxyHealthy, startProxy, stopSpawnedProxies } from "./client.js";
import {
	CHECK_TTL_MS, stateFile, localHeadroomVersion, latestResolvedHeadroomVersion,
	upgradeHeadroomTool, type UpgradeResult, type VersionCheckState,
} from "./version.js";

export interface HeadroomUpgradeReport {
	/** True when a manually-started proxy is still listening; upgrade aborted
	 *  because replacing the executable while its shim is in use fails
	 *  (uv `os error 32` on Windows). */
	blockedByManualProxy: boolean;
	/** Version before upgrade (local `headroom --version`). */
	before: string | null;
	result: UpgradeResult | null;
	/** Whether the plugin re-spawned and health-checked the proxy after upgrade. */
	proxyRestarted: boolean;
	proxyHealthyNow: boolean;
	message: string;
}

export async function runHeadroomUpgrade(getAdapter: () => AdapterConfig): Promise<HeadroomUpgradeReport> {
	const cfg = resolveHeadroom(getAdapter());
	const before = await localHeadroomVersion();
	if (!cfg.enabled) {
		return { blockedByManualProxy: false, before, result: null, proxyRestarted: false, proxyHealthyNow: false, message: "headroom 未启用 (acp.json 的 headroom.enabled=false)。升级引擎对当前会话没有意义。" };
	}

	// Stop only proxies this pi process spawned. Then confirm nothing else is
	// listening — a manually-started instance holds the shim open and would
	// make `uv tool upgrade` fail (os error 32 on Windows file locks).
	stopSpawnedProxies();
	invalidateHealth();
	if (await proxyHealthy(cfg.proxyUrl, 1500)) {
		return {
			blockedByManualProxy: true, before, result: null, proxyRestarted: false, proxyHealthyNow: true,
			message: `检测到手动启动的 headroom 代理仍在运行 (${cfg.proxyUrl})。升级需要替换可执行文件,请先关闭它(如 headroom proxy 所在进程),然后重跑 /headroom-update。`,
		};
	}

	logInfo("headroom", { event: "upgrade-start", before });
	const result = await upgradeHeadroomTool();

	if (result.status === "error") {
		logWarn("headroom", { event: "upgrade-failed", output: result.output.slice(0, 2000) });
		return {
			blockedByManualProxy: false, before, result, proxyRestarted: false, proxyHealthyNow: false,
			message: `headroom 升级失败 (uv tool upgrade headroom-ai):\n${result.output.trim().slice(0, 400) || "未知错误"}\n请检查网络/uv 配置(镜像)后重试。`,
		};
	}

	// Upgrade succeeded — bring the proxy back up (only if the plugin is
	// configured to manage it; otherwise tell the user to start it).
	invalidateHealth();
	let proxyRestarted = false;
	let proxyHealthyNow = false;
	if (cfg.autoStart) {
		proxyRestarted = await startProxy(cfg.proxyUrl);
		proxyHealthyNow = await proxyHealthy(cfg.proxyUrl);
	}
	const after = result.status === "upgraded" ? result.to : before;
	logInfo("headroom", { event: "upgrade-done", status: result.status, before, after, proxyRestarted, proxyHealthyNow });

	const lines: string[] = [];
	if (result.status === "upgraded") {
		lines.push(`headroom 引擎已更新: ${result.from ?? before ?? "?"} → ${result.to}`);
	} else {
		lines.push(`headroom 引擎已是最新版本 (${before ?? "版本未知"})。`);
	}
	if (cfg.autoStart) {
		lines.push(proxyHealthyNow ? `代理已自动重启并按 /health 验证通过,当前在线。` : `代理重启失败(${cfg.proxyUrl}),请手动执行: headroom proxy --port ${new URL(cfg.proxyUrl).port || "8787"}`);
	} else {
		lines.push(`autoStart 关闭:请手动重启代理(升级前的旧进程已被停止): headroom proxy --port ${new URL(cfg.proxyUrl).port || "8787"}`);
	}
	// Plugin itself may have a newer npm release — surface the next step.
	lines.push(`下一步: pi update npm:acp-headroom-pi (插件更新需重启 pi 生效)`);
	return { blockedByManualProxy: false, before, result, proxyRestarted, proxyHealthyNow, message: lines.join("\n") };
}

/** Called from session_start (fire-and-forget): compares the installed engine
 *  against what uv would resolve today, throttled by a 24h state file so
 *  every pi launch does not hit the network. Never throws, never upgrades
 *  automatically — it only informs (notify once per session + log). */
export async function maybeNotifyHeadroomUpdate(getAdapter: () => AdapterConfig): Promise<void> {
	const cfg = resolveHeadroom(getAdapter());
	if (!cfg.enabled || cfg.checkUpdatesOnStart === false) return;
	try {
		let state: VersionCheckState | null = null;
		try {
			state = JSON.parse(await readFile(stateFile(), "utf8")) as VersionCheckState;
		} catch {
			state = null; // no prior check
		}
		if (state && Date.now() - state.checkedAt < CHECK_TTL_MS) return;

		const local = await localHeadroomVersion();
		const latest = await latestResolvedHeadroomVersion();
		await mkdir(dirname(stateFile()), { recursive: true });
		await writeFile(stateFile(), JSON.stringify({ checkedAt: Date.now(), local, latest }), "utf8");
		if (!local || !latest) return; // unknown side — don't guess
		if (local === latest) return;

		if (latest) {
			logInfo("headroom", { event: "update-available", local, latest, hint: "/headroom-update" });
		}
		// UI hint rides the notify only when the session has a UI (avoids
		// emitting RPC churn on rpc/json modes).
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ctx = (globalThis as any).__ACP_HEADROOM_LAST_CTX__;
		if (ctx?.hasUI) {
			ctx.ui.notify(`[ACP] headroom 引擎有新版本: ${local} → ${latest}。运行 /headroom-update 一键升级并重启代理(或将 ~/.local/bin 的 headroom 升级后手动重启代理)。`);
		}
	} catch (e) {
		logInfo("headroom", { event: "update-check-skipped", error: e instanceof Error ? e.message : String(e) });
	}
}