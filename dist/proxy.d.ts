export declare function originOf(baseUrl: string): string;
export declare function invalidateHealth(baseUrl?: string): void;
/** Hysteretic health check: a good result caches for 30s, a failure is retried
 *  once before counting as down, and a confirmed outage is negatively cached
 *  for 15s so we fail open cheaply instead of re-probing every LLM call. */
export declare function proxyHealthy(baseUrl: string, timeoutMs: number): Promise<boolean>;
/** Best-effort proxy startup: `headroom` on PATH first, else
 *  `uv tool run --from "headroom-ai[proxy]" headroom`. Concurrent callers for
 *  the same origin share one attempt. Returns true once /health answers. */
export declare function startProxy(baseUrl: string, timeoutMs: number): Promise<boolean>;
/** Reclaim only proxies this process spawned. A user-launched instance was
 *  never added to `spawned`, so it is never touched. */
export declare function stopSpawnedProxies(): void;
