import { spawn, execFile, type ChildProcess } from "node:child_process";
import { HeadroomClient } from "headroom-ai";
import { log } from "./log.js";

/** Proxy lifecycle: the only piece this plugin owns outright. The headroom
 *  SDK speaks HTTP but does not manage the proxy process, and a missing proxy
 *  must not break a pi session — so we probe, optionally spawn, and reclaim
 *  only what we started. */

const HEALTH_TTL_MS = 30_000;
/** Health probes run inside pi's request path, where the event loop can stall
 *  on token estimation. A stalled loop fires AbortSignal late-but-immediately
 *  and would kill a healthy request, so a single failure is retried before we
 *  declare the proxy down. */
const NEGATIVE_TTL_MS = 15_000;
const STARTUP_POLL_MS = 500;
const STARTUP_DEADLINE_MS = 20_000;

interface HealthState {
  healthyUntil: number;
  unhealthyUntil: number;
}

const healthByOrigin = new Map<string, HealthState>();
/** Children this process spawned — the only ones we ever kill. */
const spawned = new Set<ChildProcess>();
const starting = new Map<string, Promise<boolean>>();

function stateFor(baseUrl: string): HealthState {
  const origin = originOf(baseUrl);
  let s = healthByOrigin.get(origin);
  if (!s) {
    s = { healthyUntil: 0, unhealthyUntil: 0 };
    healthByOrigin.set(origin, s);
  }
  return s;
}

export function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

export function invalidateHealth(baseUrl?: string): void {
  if (baseUrl) healthByOrigin.delete(originOf(baseUrl));
  else healthByOrigin.clear();
}

async function healthOnce(baseUrl: string, timeoutMs: number): Promise<boolean> {
  try {
    const client = new HeadroomClient({ baseUrl, timeout: timeoutMs, retries: 0, fallback: false });
    await client.health();
    return true;
  } catch {
    return false;
  }
}

/** Hysteretic health check: a good result caches for 30s, a failure is retried
 *  once before counting as down, and a confirmed outage is negatively cached
 *  for 15s so we fail open cheaply instead of re-probing every LLM call. */
export async function proxyHealthy(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const now = Date.now();
  const s = stateFor(baseUrl);
  if (now < s.healthyUntil) return true;
  if (now < s.unhealthyUntil) return false;
  if ((await healthOnce(baseUrl, timeoutMs)) || (await healthOnce(baseUrl, timeoutMs))) {
    s.healthyUntil = Date.now() + HEALTH_TTL_MS;
    s.unhealthyUntil = 0;
    return true;
  }
  s.unhealthyUntil = Date.now() + NEGATIVE_TTL_MS;
  return false;
}

/** Best-effort proxy startup: `headroom` on PATH first, else
 *  `uv tool run --from "headroom-ai[proxy]" headroom`. Concurrent callers for
 *  the same origin share one attempt. Returns true once /health answers. */
export function startProxy(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const key = originOf(baseUrl);
  const inFlight = starting.get(key);
  if (inFlight) return inFlight;
  const attempt = spawnProxy(baseUrl, timeoutMs).finally(() => starting.delete(key));
  starting.set(key, attempt);
  return attempt;
}

async function spawnProxy(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const port = portOf(baseUrl);
  const commands = [
    { cmd: "headroom", args: ["proxy", "--port", port] },
    { cmd: "uv", args: ["tool", "run", "--from", "headroom-ai[proxy]", "headroom", "proxy", "--port", port] },
  ];
  for (const { cmd, args } of commands) {
    let failed = false;
    let child: ChildProcess;
    try {
      // windowsHide is load-bearing: without it a detached console app pops a
      // visible terminal window on every launch.
      child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    } catch {
      continue;
    }
    // spawn() does not throw synchronously for ENOENT/EINVAL — failure arrives
    // on this event, so bail out instead of waiting the full deadline.
    child.on("error", () => {
      failed = true;
      spawned.delete(child);
    });
    spawned.add(child);
    child.unref();
    const deadline = Date.now() + STARTUP_DEADLINE_MS;
    while (!failed && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, STARTUP_POLL_MS));
      // Raw probe: the negative cache would short-circuit these polls right
      // after the failed pre-spawn check.
      if (await healthOnce(baseUrl, timeoutMs)) {
        const s = stateFor(baseUrl);
        s.healthyUntil = Date.now() + HEALTH_TTL_MS;
        s.unhealthyUntil = 0;
        return true;
      }
    }
    killTree(child);
    spawned.delete(child);
  }
  log.warn({ event: "proxy-start-failed", baseUrl });
  return false;
}

/** Kill a spawned child AND its process tree. On Windows child.kill() only
 *  terminates the direct child — with the `uv tool run` fallback the real
 *  server is a grandchild that would otherwise survive holding the port. */
function killTree(child: ChildProcess): void {
  try {
    if (process.platform === "win32" && child.pid) {
      // windowsHide: taskkill is a console app; without the flag its window
      // flashes on screen every time pi shuts down and reclaims a proxy.
      execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
    } else {
      child.kill();
    }
  } catch {
    try {
      child.kill();
    } catch {
      // already gone
    }
  }
}

/** Reclaim only proxies this process spawned. A user-launched instance was
 *  never added to `spawned`, so it is never touched. */
export function stopSpawnedProxies(): void {
  for (const child of spawned) killTree(child);
  spawned.clear();
}

function portOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).port || "8787";
  } catch {
    return "8787";
  }
}
