import type { AdapterConfig } from "../config.js";
import { type UpgradeResult } from "./version.js";
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
export declare function runHeadroomUpgrade(getAdapter: () => AdapterConfig): Promise<HeadroomUpgradeReport>;
/** Called from session_start (fire-and-forget): compares the installed engine
 *  against what uv would resolve today, throttled by a 24h state file so
 *  every pi launch does not hit the network. Never throws, never upgrades
 *  automatically — it only informs (notify once per session + log). */
export declare function maybeNotifyHeadroomUpdate(getAdapter: () => AdapterConfig): Promise<void>;
