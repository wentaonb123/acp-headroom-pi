import type { CoreMessage } from "acp-kernel";
import type { AdapterConfig } from "../config.js";
type StageCoreMessage = Pick<CoreMessage, "id" | "role" | "text" | "toolName">;
export interface HeadroomStats {
    applied: number;
    savedTokens: number;
}
export interface HeadroomApplyResult {
    /** coreMessage id → compressed replacement text. Caller substitutes into
     *  the message array BEFORE token estimation / processTurn; patchRefTag
     *  then rebuilds the final AgentMessage body automatically. */
    replacements: Map<string, string>;
    applied: number;
    savedTokens: number;
    /** False only when the proxy was unreachable this round. */
    available: boolean;
}
export declare class HeadroomStage {
    readonly getAdapter: () => AdapterConfig;
    stats: HeadroomStats;
    private cache;
    private proxyTried;
    private unavailableNotified;
    constructor(getAdapter: () => AdapterConfig);
    resetSession(): void;
    /** Compress oversized tool results on the sent-view projection.
     *  Returns id → replacement text; never throws (fail-open). */
    apply(coreMessages: StageCoreMessage[], modelId: string): Promise<HeadroomApplyResult>;
    private applyInner;
    /** Called by session_start after its own spawn attempt so the request-path
     *  ensureProxy() never blocks on startProxy polling (up to 40s when the
     *  binary is absent) — it only fast health-checks afterwards. */
    markProxyAttempted(): void;
    private ensureProxy;
}
export declare function setActiveStage(stage: HeadroomStage | null): void;
export interface ActiveHeadroomSnapshot {
    stats: HeadroomStats;
    proxyUrl: string;
    enabled: boolean;
}
export declare function activeHeadroomSnapshot(): ActiveHeadroomSnapshot | null;
export {};
