export interface SpawnResult {
    code: number | null;
    stdout: string;
    stderr: string;
    combined: string;
    timedOut: boolean;
}
/** Capture a command's output with a hard timeout. On Windows, npm-style
 *  `.cmd` shims must be spawned as the .cmd file (raw `npm` hits EINVAL). */
export declare function runCapture(bin: string, args: string[], timeoutMs: number): Promise<SpawnResult>;
/** Parse the first semver-looking token out of `headroom --version` output. */
export declare function parseVersionLine(line: string): string | null;
/** Attempt `headroom --version` (3000ms), then the uv run fallback (15s —
 *  uv may need to resolve/the install a throwaway env on first use). */
export declare function localHeadroomVersion(): Promise<string | null>;
/** Probe the newest release uv would resolve (session-start update check).
 *  Returns null when unreachable (offline / no uv) — callers treat null as
 *  "unknown", never "outdated". */
export declare function latestResolvedHeadroomVersion(): Promise<string | null>;
export interface UpgradeResult {
    status: "upgraded" | "uptodate" | "error";
    version: string | null;
    from: string | null;
    to: string | null;
    output: string;
}
/** Parse `uv tool upgrade headroom-ai` output. Formats vary across uv
 *  releases, so this matches loosely and falls back on the exit code. */
export declare function parseUpgradeOutput(code: number | null, output: string): Omit<UpgradeResult, "output">;
/** Run `uv tool upgrade headroom-ai` (honors the user's own uv index/mirror
 *  config via inherited env). Default 120s — big wheels (scipy/onnxruntime)
 *  can take a while on first download. */
export declare function upgradeHeadroomTool(timeoutMs?: number): Promise<UpgradeResult>;
/** Latest published plugin version from npm (best-effort, UI hint only). */
export declare function latestPluginVersion(): Promise<string | null>;
export interface VersionCheckState {
    checkedAt: number;
    local: string | null;
    latest: string | null;
}
export declare function stateFile(): string;
export declare const CHECK_TTL_MS: number;
