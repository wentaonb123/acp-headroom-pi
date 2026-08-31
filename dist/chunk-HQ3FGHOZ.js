var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/headroom/client.ts
import { promises as fs } from "fs";
import * as path2 from "path";
import { homedir as homedir2 } from "os";
import { spawn, execFile } from "child_process";

// src/log.ts
import { appendFileSync, mkdirSync, statSync, renameSync, existsSync } from "fs";
import * as path from "path";
import { homedir } from "os";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
var MAX_BYTES = 10 * 1024 * 1024;
var ENV_DEBUG = process.env.ACP_DEBUG === "1" || process.env.ACP_DEBUG === "true";
function resolveLogFile() {
  return process.env.ACP_LOG_FILE ?? path.join(homedir(), CONFIG_DIR_NAME, "acp.log");
}
var runtimeDebug = null;
function setDebugEnabled(enabled) {
  runtimeDebug = enabled;
}
function debugOn() {
  return runtimeDebug ?? ENV_DEBUG;
}
function fmt(v) {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.stack || String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
function ts() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function writeLine(level, scope, fields) {
  const file = resolveLogFile();
  try {
    if (existsSync(file) && statSync(file).size >= MAX_BYTES) {
      renameSync(file, file + ".old");
    }
  } catch {
  }
  const body = Object.keys(fields).map((k) => `${k}=${fmt(fields[k])}`).join(" ");
  const line = `${ts()} [${level}] [${scope}] ${body}
`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, line);
  } catch {
  }
}
function closeLogStream() {
}
function logError(scope, fields) {
  writeLine("error", scope, fields);
}
function logWarn(scope, fields) {
  writeLine("warn", scope, fields);
}
function logInfo(scope, fields) {
  writeLine("info", scope, fields);
}
function logThrow(scope, err, extra = {}) {
  const fields = { ...extra };
  if (err instanceof Error) {
    fields.error = err.message;
    fields.stack = err.stack ?? "";
  } else {
    fields.error = String(err);
  }
  writeLine("error", scope, fields);
}
var debug = {
  get enabled() {
    return debugOn();
  },
  get logFile() {
    return resolveLogFile();
  },
  event(scope, fields) {
    if (debugOn()) writeLine("debug", scope, fields);
  }
};

// src/headroom/client.ts
var HEALTH_TTL_MS = 3e4;
var HEALTH_TIMEOUT_MS = 3e3;
var NEGATIVE_TTL_MS = 15e3;
var healthStates = /* @__PURE__ */ new Map();
function originOf(baseUrl) {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}
function healthStateFor(baseUrl) {
  const key = originOf(baseUrl);
  let state = healthStates.get(key);
  if (!state) {
    state = { healthyUntil: 0, unhealthyUntil: 0 };
    healthStates.set(key, state);
  }
  return state;
}
function invalidateHealth(baseUrl) {
  if (baseUrl) {
    healthStates.delete(originOf(baseUrl));
    return;
  }
  healthStates.clear();
}
async function healthOnce(baseUrl, timeoutMs) {
  let ok = false;
  try {
    const resp = await fetch(new URL("/health", baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
    ok = resp.ok;
  } catch {
    ok = false;
  }
  return ok;
}
async function proxyHealthy(baseUrl, timeoutMs = HEALTH_TIMEOUT_MS) {
  const now = Date.now();
  const state = healthStateFor(baseUrl);
  if (now < state.healthyUntil) return true;
  if (now < state.unhealthyUntil) return false;
  if (await healthOnce(baseUrl, timeoutMs) || await healthOnce(baseUrl, timeoutMs)) {
    state.healthyUntil = Date.now() + HEALTH_TTL_MS;
    state.unhealthyUntil = 0;
    return true;
  }
  state.unhealthyUntil = Date.now() + NEGATIVE_TTL_MS;
  return false;
}
var spawnedProxies = /* @__PURE__ */ new Set();
var startingProxies = /* @__PURE__ */ new Map();
function startProxy(baseUrl) {
  const key = originOf(baseUrl);
  const inFlight = startingProxies.get(key);
  if (inFlight) return inFlight;
  const attempt = startProxyInner(baseUrl).finally(() => startingProxies.delete(key));
  startingProxies.set(key, attempt);
  return attempt;
}
function killProxyTree(child) {
  try {
    if (process.platform === "win32" && child.pid) {
      execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {
      });
    } else {
      child.kill();
    }
  } catch {
    try {
      child.kill();
    } catch {
    }
  }
}
function stopSpawnedProxies() {
  for (const child of spawnedProxies) killProxyTree(child);
  spawnedProxies.clear();
}
async function startProxyInner(baseUrl) {
  const url = new URL(baseUrl);
  const port = url.port || "8787";
  const commands = [
    { cmd: "headroom", args: ["proxy", "--port", port] },
    { cmd: "uv", args: ["tool", "run", "--from", "headroom-ai[proxy]", "headroom", "proxy", "--port", port] }
  ];
  for (const { cmd, args } of commands) {
    let failed = false;
    let child;
    try {
      child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    } catch {
      continue;
    }
    child.on("error", () => {
      failed = true;
      spawnedProxies.delete(child);
    });
    spawnedProxies.add(child);
    child.unref();
    const deadline = Date.now() + 2e4;
    while (!failed && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      if (await healthOnce(baseUrl, HEALTH_TIMEOUT_MS)) {
        const state = healthStateFor(baseUrl);
        state.healthyUntil = Date.now() + HEALTH_TTL_MS;
        state.unhealthyUntil = 0;
        return true;
      }
    }
    killProxyTree(child);
    spawnedProxies.delete(child);
  }
  return false;
}
async function compressToolOutput(baseUrl, opts) {
  const body = {
    model: opts.model ?? "default",
    messages: [
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_headroom_pi", type: "function", function: { name: opts.toolName || "tool", arguments: "{}" } }]
      },
      { role: "tool", tool_call_id: "call_headroom_pi", content: opts.text }
    ],
    config: { mode: "ccr", protect_recent: 0 }
  };
  try {
    const resp = await fetch(new URL("/v1/compress", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs)
    });
    if (!resp.ok) {
      logWarn("headroom", { event: "compress-http-error", status: resp.status });
      void resp.body?.cancel().catch(() => {
      });
      return null;
    }
    const data = await resp.json();
    healthStateFor(baseUrl).healthyUntil = Date.now() + HEALTH_TTL_MS;
    const msgs = data.messages ?? [];
    let text = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "tool") {
        text = contentToText(msgs[i].content);
        break;
      }
    }
    if (!text) return null;
    return {
      text,
      tokensBefore: numOr(data.tokens_before, 0),
      tokensAfter: numOr(data.tokens_after, 0),
      hashes: Array.isArray(data.ccr_hashes) ? data.ccr_hashes.filter((h) => typeof h === "string") : []
    };
  } catch (e) {
    logWarn("headroom", { event: "compress-failed", error: e instanceof Error ? e.message : String(e) });
    healthStateFor(baseUrl).healthyUntil = 0;
    return null;
  }
}
function numOr(v, fallback) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.map((b) => b && typeof b === "object" && b.type === "text" ? b.text : void 0).filter((t) => typeof t === "string");
    return parts.length > 0 ? parts.join("\n") : null;
  }
  return null;
}
function isValidHash(hash) {
  return /^[a-f0-9]{12,24}$/i.test(hash);
}
function ccrDir() {
  return path2.resolve(process.env.HEADROOM_CCR_DIR ?? path2.join(homedir2(), ".pi", "acp-headroom", "ccr"));
}
async function saveOriginals(hashes, original) {
  if (hashes.length === 0) return;
  try {
    const dir = ccrDir();
    await fs.mkdir(dir, { recursive: true });
    await Promise.all(hashes.map(async (h) => {
      if (!isValidHash(h)) return;
      const file = path2.join(dir, `${h.toLowerCase()}.txt`);
      await fs.writeFile(file, original, { encoding: "utf8", mode: 384 });
    }));
  } catch (e) {
    logWarn("headroom", { event: "ccr-save-failed", error: e instanceof Error ? e.message : String(e) });
  }
}
async function retrieveOriginal(baseUrl, hash, timeoutMs = 1e4) {
  if (!isValidHash(hash)) return null;
  const fileHash = hash.toLowerCase();
  try {
    return await fs.readFile(path2.join(ccrDir(), `${fileHash}.txt`), "utf8");
  } catch {
  }
  try {
    const resp = await fetch(new URL(`/v1/retrieve/${hash}`, baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) {
      void resp.body?.cancel().catch(() => {
      });
      return null;
    }
    const data = await resp.json();
    if (typeof data === "string") return data;
    if (data && typeof data === "object") {
      const obj = data;
      if (typeof obj.original_content === "string") return obj.original_content;
      const viaContent = typeof obj.content === "string" ? obj.content : contentToText(obj.content);
      if (viaContent) return viaContent;
    }
    logWarn("headroom", { event: "retrieve-unexpected-shape", sample: JSON.stringify(data).slice(0, 200) });
    return null;
  } catch {
    return null;
  }
}

export {
  __export,
  setDebugEnabled,
  closeLogStream,
  logError,
  logWarn,
  logInfo,
  logThrow,
  debug,
  originOf,
  invalidateHealth,
  proxyHealthy,
  startProxy,
  stopSpawnedProxies,
  compressToolOutput,
  isValidHash,
  saveOriginals,
  retrieveOriginal
};
//# sourceMappingURL=chunk-HQ3FGHOZ.js.map