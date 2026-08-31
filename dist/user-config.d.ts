import type { Prompts } from "acp-kernel";
import type { AdapterConfig, CompressConfig, DelegateConfig } from "./config.js";
import type { HeadroomSettings } from "./headroom/config.js";
import type { ThrottleRetryConfig } from "./throttle-retry.js";
/** User-facing config keys (subset of AdapterConfig). Loaded from
 *  ~/.<CONFIG_DIR_NAME>/acp.json (global) and <cwd>/.<CONFIG_DIR_NAME>/acp.json
 *  (project-local overrides project-global). Project wins over global. */
export interface UserAcpConfig {
    debug?: boolean;
    autoUpdate?: boolean;
    modelContextLimit?: number;
    toolBashDefaultTimeout?: number;
    toolOutputMaxBytes?: number;
    delegate?: boolean | DelegateConfig;
    compress?: CompressConfig;
    throttleRetry?: boolean | ThrottleRetryConfig;
    headroom?: boolean | HeadroomSettings;
    displayUsage?: "merged" | "separate";
    prompts?: Partial<Prompts>;
    acknowledgePromptsRisk?: boolean;
}
/** Read global + project acp.json, project overrides global. Returns {} on any
 *  error (missing file, bad JSON) — never throws. */
export declare function loadUserConfig(cwd: string): Promise<UserAcpConfig>;
/** Merge user config onto an adapter config: user config wins for the keys it
 *  sets. Used at session_start to apply runtime-discovered config. */
export declare function applyUserConfig(adapter: AdapterConfig, user: UserAcpConfig): AdapterConfig;
