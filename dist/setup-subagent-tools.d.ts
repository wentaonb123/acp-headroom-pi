/** The four ACP tools to ensure on every pi-subagents builtin agent. */
export declare const ACP_TOOLS: readonly ["compress", "decompress", "search_context", "acp_status"];
export interface SetupResult {
    path: string;
    action: "skipped" | "updated" | "failed";
    reason?: string;
}
export interface SetupOptions {
    /** Injectable agent directory (defaults to env PI_CODING_AGENT_DIR or ~/.pi/agent). */
    agentDir?: string;
    /** Injectable cwd for project-scope detection (defaults to process.cwd()). */
    cwd?: string;
    /** Explicit install directory (skips detection; for git installs or forks). */
    installDir?: string;
}
/**
 * Resolve the pi agent config directory (e.g. ~/.pi/agent), honoring the
 * PI_CODING_AGENT_DIR environment variable (mirroring pi's own resolution).
 */
export declare function resolveAgentDir(): string;
interface ParsedBuiltin {
    name: string;
    /** Frontmatter `tools` list; undefined when the agent is unrestricted. */
    tools?: string[];
}
/**
 * Detect an installed pi-subagents package and return its directory, or null
 * when no installation is found.
 *
 * Checked in priority order:
 *  1. user-scope npm install:    <agentDir>/npm/node_modules/pi-subagents
 *  2. project-scope npm install: <cwd>/.pi/npm/node_modules/pi-subagents
 *  3. user-scope extension dir:  <agentDir>/extensions/<name>/package.json where name === "pi-subagents"
 *  4. project-scope extension dir: <cwd>/.pi/extensions/<name>/package.json
 *
 * Git installs and the legacy global npm location are intentionally not
 * checked: a miss there is a safe no-op (ACP tools stay un-injected).
 */
export declare function findPiSubagentsInstall(agentDir: string, cwd: string): string | null;
/**
 * Discover the builtin agents shipped by the detected pi-subagents package
 * from its agents/*.md frontmatter (name + tools). Returns an empty list
 * when the package ships no agents directory.
 */
export declare function discoverBuiltinAgents(installDir: string): ParsedBuiltin[];
/**
 * Ensure ACP context tools are present in pi-subagents' agent overrides.
 * No-op (skipped) unless a pi-subagents installation is detected.
 */
export declare function ensureSubagentAcpTools(settingsPath?: string, options?: SetupOptions): SetupResult;
export {};
