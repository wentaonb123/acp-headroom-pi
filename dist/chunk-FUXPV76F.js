import {
  invalidateHealth,
  logInfo,
  logWarn,
  proxyHealthy,
  startProxy,
  stopSpawnedProxies
} from "./chunk-MRXTI3AT.js";

// src/headroom/upgrade.ts
import { readFile, mkdir, writeFile } from "fs/promises";
import { dirname } from "path";

// src/headroom/config.ts
var DEFAULT_PROTECTED_TOOLS = [
  "compress",
  "decompress",
  "search_context",
  "acp_status",
  "headroom_retrieve",
  "acp_delegate",
  "acp_delegate_wait",
  "acp_delegate_cancel"
];
var DEFAULT_HEADROOM_CONFIG = {
  enabled: true,
  proxyUrl: "http://127.0.0.1:8787",
  minChars: 4e3,
  maxPerTurn: 8,
  timeoutMs: 3e3,
  protectedTools: DEFAULT_PROTECTED_TOOLS,
  autoStart: true,
  checkUpdatesOnStart: true
};
function resolveHeadroom(adapter) {
  const h = adapter.headroom;
  if (h === false) return { ...DEFAULT_HEADROOM_CONFIG, enabled: false };
  const s = typeof h === "object" && h !== null ? h : {};
  return {
    enabled: s.enabled !== false,
    proxyUrl: normalizeBase(process.env.HEADROOM_PROXY_URL ?? s.proxyUrl ?? DEFAULT_HEADROOM_CONFIG.proxyUrl),
    minChars: posInt(s.minChars, DEFAULT_HEADROOM_CONFIG.minChars),
    maxPerTurn: posInt(s.maxPerTurn, DEFAULT_HEADROOM_CONFIG.maxPerTurn),
    timeoutMs: posInt(s.timeoutMs, DEFAULT_HEADROOM_CONFIG.timeoutMs),
    protectedTools: unique([...DEFAULT_PROTECTED_TOOLS, ...Array.isArray(s.protectedTools) ? s.protectedTools.filter((t) => typeof t === "string") : []]),
    autoStart: s.autoStart !== false,
    checkUpdatesOnStart: s.checkUpdatesOnStart !== false
  };
}
function posInt(v, fallback) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}
function normalizeBase(url) {
  return url.replace(/\/+$/, "");
}
function unique(items) {
  return [...new Set(items)];
}

// src/headroom/version.ts
import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
var UV_TOOL_RUN = ["tool", "run", "--from", "headroom-ai[proxy]"];
function runCapture(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(bin, args, { windowsHide: true });
    child.stdout?.on("data", (d) => stdout += d.toString());
    child.stderr?.on("data", (d) => stderr += d.toString());
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
      }
      resolve({ code: null, stdout, stderr, combined: stdout + stderr, timedOut: true });
    }, timeoutMs);
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${e.message}
`, combined: `${stdout}${stderr}${e.message}
`, timedOut: false });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, combined: stdout + stderr, timedOut: false });
    });
  });
}
function parseVersionLine(line) {
  const m = /v?(\d+\.\d+(?:\.\d+)?)/.exec(line.trim());
  return m ? m[1] : null;
}
async function localHeadroomVersion() {
  const direct = await runCapture("headroom", ["--version"], 3e3);
  if (direct.code === 0 && !direct.timedOut) {
    const v = parseVersionLine(direct.stdout || direct.stderr);
    if (v) return v;
  }
  const viaUv = await runCapture("uv", [...UV_TOOL_RUN, "headroom", "--version"], 15e3);
  if (viaUv.code === 0 && !viaUv.timedOut) return parseVersionLine(viaUv.stdout || viaUv.stderr);
  return null;
}
async function latestResolvedHeadroomVersion() {
  const viaUv = await runCapture("uv", [...UV_TOOL_RUN, "headroom", "--version"], 15e3);
  if (viaUv.code === 0 && !viaUv.timedOut) return parseVersionLine(viaUv.stdout || viaUv.stderr);
  return null;
}
function parseUpgradeOutput(code, output) {
  const toMatch = /(?:^|[\r\n])Installed[^\n]*headroom-ai\s*v?(\d+\.\d+(?:\.\d+)?)/.exec(output);
  const fromMatch = /(?:^|[\r\n])Uninstalled[^\n]*headroom-ai\s*v?(\d+\.\d+(?:\.\d+)?)/.exec(output);
  const already = /already up to date/i.test(output) || /audited/i.test(output);
  if (toMatch) return { status: "upgraded", version: toMatch[1], from: fromMatch?.[1] ?? null, to: toMatch[1] };
  if (code === 0 && (already || fromMatch)) return { status: "uptodate", version: fromMatch?.[1] ?? null, from: null, to: null };
  if (code === 0 && toMatch === null) return { status: "uptodate", version: null, from: null, to: null };
  return { status: "error", version: null, from: fromMatch?.[1] ?? null, to: null };
}
async function upgradeHeadroomTool(timeoutMs = 12e4) {
  const res = await runCapture("uv", ["tool", "upgrade", "headroom-ai"], timeoutMs);
  const parsed = parseUpgradeOutput(res.code, res.combined);
  return { ...parsed, output: res.combined };
}
function stateFile() {
  return join(homedir(), ".pi", "acp-headroom", "version-check.json");
}
var CHECK_TTL_MS = 24 * 60 * 60 * 1e3;

// src/headroom/upgrade.ts
async function runHeadroomUpgrade(getAdapter) {
  const cfg = resolveHeadroom(getAdapter());
  const before = await localHeadroomVersion();
  if (!cfg.enabled) {
    return { blockedByManualProxy: false, before, result: null, proxyRestarted: false, proxyHealthyNow: false, message: "headroom \u672A\u542F\u7528 (acp.json \u7684 headroom.enabled=false)\u3002\u5347\u7EA7\u5F15\u64CE\u5BF9\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u610F\u4E49\u3002" };
  }
  stopSpawnedProxies();
  invalidateHealth();
  if (await proxyHealthy(cfg.proxyUrl, 1500)) {
    return {
      blockedByManualProxy: true,
      before,
      result: null,
      proxyRestarted: false,
      proxyHealthyNow: true,
      message: `\u68C0\u6D4B\u5230\u624B\u52A8\u542F\u52A8\u7684 headroom \u4EE3\u7406\u4ECD\u5728\u8FD0\u884C (${cfg.proxyUrl})\u3002\u5347\u7EA7\u9700\u8981\u66FF\u6362\u53EF\u6267\u884C\u6587\u4EF6,\u8BF7\u5148\u5173\u95ED\u5B83(\u5982 headroom proxy \u6240\u5728\u8FDB\u7A0B),\u7136\u540E\u91CD\u8DD1 /headroom-update\u3002`
    };
  }
  logInfo("headroom", { event: "upgrade-start", before });
  const result = await upgradeHeadroomTool();
  if (result.status === "error") {
    logWarn("headroom", { event: "upgrade-failed", output: result.output.slice(0, 2e3) });
    return {
      blockedByManualProxy: false,
      before,
      result,
      proxyRestarted: false,
      proxyHealthyNow: false,
      message: `headroom \u5347\u7EA7\u5931\u8D25 (uv tool upgrade headroom-ai):
${result.output.trim().slice(0, 400) || "\u672A\u77E5\u9519\u8BEF"}
\u8BF7\u68C0\u67E5\u7F51\u7EDC/uv \u914D\u7F6E(\u955C\u50CF)\u540E\u91CD\u8BD5\u3002`
    };
  }
  invalidateHealth();
  let proxyRestarted = false;
  let proxyHealthyNow = false;
  if (cfg.autoStart) {
    proxyRestarted = await startProxy(cfg.proxyUrl);
    proxyHealthyNow = await proxyHealthy(cfg.proxyUrl);
  }
  const after = result.status === "upgraded" ? result.to : before;
  logInfo("headroom", { event: "upgrade-done", status: result.status, before, after, proxyRestarted, proxyHealthyNow });
  const lines = [];
  if (result.status === "upgraded") {
    lines.push(`headroom \u5F15\u64CE\u5DF2\u66F4\u65B0: ${result.from ?? before ?? "?"} \u2192 ${result.to}`);
  } else {
    lines.push(`headroom \u5F15\u64CE\u5DF2\u662F\u6700\u65B0\u7248\u672C (${before ?? "\u7248\u672C\u672A\u77E5"})\u3002`);
  }
  if (cfg.autoStart) {
    lines.push(proxyHealthyNow ? `\u4EE3\u7406\u5DF2\u81EA\u52A8\u91CD\u542F\u5E76\u6309 /health \u9A8C\u8BC1\u901A\u8FC7,\u5F53\u524D\u5728\u7EBF\u3002` : `\u4EE3\u7406\u91CD\u542F\u5931\u8D25(${cfg.proxyUrl}),\u8BF7\u624B\u52A8\u6267\u884C: headroom proxy --port ${new URL(cfg.proxyUrl).port || "8787"}`);
  } else {
    lines.push(`autoStart \u5173\u95ED:\u8BF7\u624B\u52A8\u91CD\u542F\u4EE3\u7406(\u5347\u7EA7\u524D\u7684\u65E7\u8FDB\u7A0B\u5DF2\u88AB\u505C\u6B62): headroom proxy --port ${new URL(cfg.proxyUrl).port || "8787"}`);
  }
  lines.push(`\u4E0B\u4E00\u6B65: pi update npm:acp-headroom-pi (\u63D2\u4EF6\u66F4\u65B0\u9700\u91CD\u542F pi \u751F\u6548)`);
  return { blockedByManualProxy: false, before, result, proxyRestarted, proxyHealthyNow, message: lines.join("\n") };
}
async function maybeNotifyHeadroomUpdate(getAdapter) {
  const cfg = resolveHeadroom(getAdapter());
  if (!cfg.enabled || cfg.checkUpdatesOnStart === false) return;
  try {
    let state = null;
    try {
      state = JSON.parse(await readFile(stateFile(), "utf8"));
    } catch {
      state = null;
    }
    if (state && Date.now() - state.checkedAt < CHECK_TTL_MS) return;
    const local = await localHeadroomVersion();
    const latest = await latestResolvedHeadroomVersion();
    await mkdir(dirname(stateFile()), { recursive: true });
    await writeFile(stateFile(), JSON.stringify({ checkedAt: Date.now(), local, latest }), "utf8");
    if (!local || !latest) return;
    if (local === latest) return;
    if (latest) {
      logInfo("headroom", { event: "update-available", local, latest, hint: "/headroom-update" });
    }
    const ctx = globalThis.__ACP_HEADROOM_LAST_CTX__;
    if (ctx?.hasUI) {
      ctx.ui.notify(`[ACP] headroom \u5F15\u64CE\u6709\u65B0\u7248\u672C: ${local} \u2192 ${latest}\u3002\u8FD0\u884C /headroom-update \u4E00\u952E\u5347\u7EA7\u5E76\u91CD\u542F\u4EE3\u7406(\u6216\u5C06 ~/.local/bin \u7684 headroom \u5347\u7EA7\u540E\u624B\u52A8\u91CD\u542F\u4EE3\u7406)\u3002`);
    }
  } catch (e) {
    logInfo("headroom", { event: "update-check-skipped", error: e instanceof Error ? e.message : String(e) });
  }
}

export {
  resolveHeadroom,
  localHeadroomVersion,
  runHeadroomUpgrade,
  maybeNotifyHeadroomUpdate
};
//# sourceMappingURL=chunk-FUXPV76F.js.map