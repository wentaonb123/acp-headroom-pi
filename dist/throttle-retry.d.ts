export declare const THROTTLE_RETRY_ERROR_MESSAGE = "429 rate limit: Too many tokens, please wait before trying again.";
export declare const THROTTLE_KICK_SENTINEL = "[ACP:provider-throttle]";
export declare const THROTTLE_KICK_TEXT = "[ACP:provider-throttle] The previous assistant response was interrupted by a provider rate limit (transient, not a real failure). Resume the task exactly where it left off \u2014 do not re-run completed steps and do not discuss the interruption unless asked.";
export interface ThrottleErrorProbe {
    role: string;
    stopReason?: string;
    errorMessage?: string;
    content: unknown;
}
export declare function isThrottleError(msg: ThrottleErrorProbe): boolean;
export declare function isKickMessage(msg: {
    role: string;
    content: unknown;
}): boolean;
export interface ThrottleRetryConfig {
    enabled?: boolean;
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffMode?: "exponential" | "fixed";
}
export interface ResolvedThrottleRetry {
    enabled: boolean;
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffMode: "exponential" | "fixed";
}
export declare const DEFAULT_THROTTLE_RETRY: ResolvedThrottleRetry;
export declare function resolveThrottleRetry(cfg: boolean | ThrottleRetryConfig | undefined): ResolvedThrottleRetry;
export declare function throttleDelayMs(kickNumber: number, r: ResolvedThrottleRetry): number;
export interface ThrottleEpisodeState {
    attempts: number;
    kicks: number;
    candidate: boolean;
}
export declare const INITIAL_THROTTLE_STATE: ThrottleEpisodeState;
export declare class ThrottleEpisode {
    state: ThrottleEpisodeState;
    private cancel;
    reset(): void;
    onProgress(): void;
    onUserMessage(kick: boolean): void;
    onThrottleError(maxRetries: number): "rewrite" | "exhausted";
    onNonThrottleError(): void;
    readyToKick(maxRetries: number): boolean;
    onKickStarted(): void;
    onKickCancelled(): void;
    sleepController(): AbortController;
    cancelSleep(): void;
}
export declare function abortableSleep(ms: number, signal: AbortSignal): Promise<"ok" | "aborted">;
