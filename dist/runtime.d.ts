import type { ExtensionContext, SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { type CompressionCore, type CompressionState, type Config, type Prompts } from "acp-kernel";
import { type AdapterConfig } from "./config.js";
import { DensityEstimator } from "./density.js";
import { entriesToCoreMessages } from "./messages.js";
import { SessionStateStore } from "./state.js";
import { ThrottleEpisode } from "./throttle-retry.js";
import { OverflowEpisode } from "./overflow-selfheal.js";
type AgentMessage = SessionMessageEntry["message"];
export declare function readContextEntries(sm: ExtensionContext["sessionManager"]): SessionEntry[];
export declare function isPiHost(sm: ExtensionContext["sessionManager"]): boolean;
export interface AcpRuntime {
    core: CompressionCore;
    /** Per-session provider-throttle retry episode (attempt budget + kick
     *  pacing), keyed by session id so concurrent sessions in one extension
     *  instance cannot share an episode. Reset on session_start and on any
     *  real progress / user input. */
    throttleFor: (sid: string) => ThrottleEpisode;
    /** Drop a session's throttle episode entirely (session_shutdown): aborts a
     *  pending kick sleep and releases the map entry so a long-lived process
     *  that cycles through many sessions doesn't accumulate them. */
    throttleDrop: (sid: string) => void;
    store: SessionStateStore;
    density: DensityEstimator;
    /** 设置 countTokens 闭包使用的 modelId（每轮 context 事件调用）。 */
    setCountModel(sid: string, modelId: string): void;
    /** Run fn inside this session's count-model scope (AsyncLocalStorage):
     *  every kernel countTokens call during synchronous fn execution resolves
     *  the session's density-calibrated model. */
    runInCountScope<T>(sid: string, fn: () => T): T;
    /** Record this session's active block ids for the current context round;
     *  returns true when a new active block appeared since the previous round
     *  (i.e. a compress happened out-of-band — blocks are created by the
     *  compress tool between context events, so they can never be detected by
     *  comparing a single processTurn's input/output state). */
    noteActiveBlocks(sid: string, activeBlockIds: string[]): boolean;
    /** Drop per-session tracking state (session_start). */
    clearSessionTracking(sid: string): void;
    adapter: AdapterConfig;
    setAdapter(adapter: AdapterConfig): void;
    prompts: Prompts;
    setPrompts(prompts: Prompts): void;
    markNudgeShown(turnKey: string): void;
    nudgeShownFor(turnKey: string): boolean;
    /** Process compress toolResults for the CURRENT user turn only (the caller
     *  scopes the list — see collectCompressOutcomes in src/index.ts); idempotent
     *  per toolCallId. Outcome classes: isError or noop (0-block panel) →
     *  failure (count++), success panel (>= 1 block) → reset, other non-error
     *  text → neutral (count unchanged). Returns the failure count, the
     *  toolCallId of the newest failure that still needs a retry prompt (null
     *  when none, capped, or count 0), and whether the cap was just reached. */
    noteCompressOutcomes(sid: string, turnKey: string, outcomes: ReadonlyArray<{
        toolCallId: string;
        isError: boolean;
        success: boolean;
        noop?: boolean;
    }>): {
        count: number;
        retryFor: string | null;
        cappedNow: boolean;
    };
    /** True when this turn already burned MAX_COMPRESS_ATTEMPTS failed/no-op
     *  compress calls — used to stop re-injecting the (dedup-exempt) emergency
     *  nudge that would otherwise keep looping no-op compressions (issue #6). */
    compressRetryCappedFor(sid: string, turnKey: string): boolean;
    clearNudgeTracking(): void;
    clearCompressRetryTracking(): void;
    liveContextLimit(ctx: ExtensionContext): number;
    configFor(ctx: ExtensionContext): Config;
    /** Re-read ~/.<dir>/acp.json + <cwd>/<dir>/acp.json and re-derive the adapter
     *  config when the contents change. Cheap no-op when unchanged. Called at
     *  session_start and on every context event so config edits apply live. */
    reloadConfig(cwd: string): Promise<void>;
    stateFor(ctx: ExtensionContext, liveMessages?: AgentMessage[]): Promise<{
        state: CompressionState;
        coreMessages: ReturnType<typeof entriesToCoreMessages>;
        entries: SessionEntry[];
    }>;
    save(state: CompressionState, ctx: ExtensionContext): Promise<void>;
    acquireLock(sid: string): Promise<() => void>;
    /** Per-session overflow self-heal state (learned window + armed emergency).
     *  Keyed by session id so concurrent sessions cannot share an episode. */
    overflowFor(sid: string): OverflowEpisode;
    /** Drop a session's overflow episode entirely (session_shutdown): releases
     *  the map entry so a long-lived process cycling through many sessions
     *  doesn't accumulate them. */
    overflowDrop(sid: string): void;
}
/** Max FAILED compress calls that get a retry prompt per user turn. */
export declare const MAX_COMPRESS_ATTEMPTS = 3;
export declare function createRuntime(adapter: AdapterConfig): AcpRuntime;
export {};
