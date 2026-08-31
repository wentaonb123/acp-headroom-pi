import { type ChildProcess, type SpawnOptions } from "node:child_process";
import { Type, type Static } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Usage } from "./delegate-events.js";
export declare function delegateSpawnOptions(cwd: string, env: NodeJS.ProcessEnv): SpawnOptions;
/** Resolve the pi CLI entry for delegate child processes.
 *  argv[1] is only the pi CLI under a CLI host; embedded hosts (e.g. pi-web)
 *  run the SDK inside another node process, so probe instead. Non-pi hosts
 *  (omp) keep argv[1] untouched. */
export declare function resolvePiCliEntry(argv1: string, env?: NodeJS.ProcessEnv, piHost?: boolean): string;
type RunStatus = "running" | "completed" | "failed" | "cancelled";
interface DelegateRun {
    runId: string;
    agent: string;
    task: string;
    cwd: string;
    startedAt: number;
    finishedAt?: number;
    status: RunStatus;
    exitCode?: number | null;
    child?: ChildProcess;
    result?: {
        code: number | null;
        file: string;
        body: string;
    };
    consumed?: boolean;
    /** True once the close handler injected the result as a system
     *  notification (sendUserMessage succeeded). Lets a later wait() avoid
     *  re-delivering the same payload. */
    injected?: boolean;
    /** Watchdog reason string when the run was force-terminated ("no output for
     *  5m", "30m limit"); surfaced in completion headers as "(timed out: ...)". */
    timedOut?: string;
    waiter?: () => void;
    /** Accumulated LLM usage from the delegate (from message_end events). */
    usage?: Usage;
    /** True once a wait/cancel tool has returned usage — prevents double-count. */
    usageReported?: boolean;
    /** True once agent_settled fired; a watchdog kill after this is stuck teardown, not a timeout. */
    agentSettled?: boolean;
}
export declare function addDelegateUsage(u: Usage): void;
export declare function getDelegateUsage(): Usage | undefined;
export declare function resetDelegateUsage(): void;
export declare function setDelegateDisplayUsage(mode: "merged" | "separate"): void;
/** Snapshot of currently-running delegate runs, for the TUI status widget. */
export declare function runningRunsSnapshot(): {
    runId: string;
    agent: string;
    task: string;
    startedAt: number;
}[];
/** Minimal writable surface accepted by makeEventApplier — real WriteStreams
 *  in production, in-memory collectors in tests. */
export interface EventApplierWriters {
    reply: {
        write(chunk: string): void;
    };
    activity: {
        write(chunk: string): void;
    } | null;
}
export interface EventApplier {
    handleEventLine(line: string): void;
    getReplyText(): string;
    /** omp fallback: `-p` prints the plain reply as raw stdout; append it
     *  straight through (no event parsing). */
    appendRaw(text: string): void;
}
/** Applies parsed delegate JSON-event lines to the live reply/activity files.
 *  Extracted from the spawn closure so the write logic is unit-testable.
 *
 *  reply-delta (text_delta) is streamed to the reply file as it arrives;
 *  reply-complete (text_end) carries the authoritative full content of the
 *  text block — any portion not already written is appended (tracked via
 *  msgWritten) so a final answer that arrives without preceding deltas is
 *  never lost from the file. */
export declare function makeEventApplier(opts: {
    showThinking: boolean;
    onUsage?: (usage: Usage) => void;
    onSettled?: () => void;
}, writers: EventApplierWriters): EventApplier;
/** Resolve a wait timeout to ms. Agents frequently pass seconds (e.g. 180)
 *  instead of milliseconds; values below the 1s floor make no sense as a wait
 *  duration, so rescale them to seconds before clamping — otherwise 180 clamps
 *  to 1000ms and the wait times out in 1s. */
export declare function resolveWaitTimeoutMs(raw: number | undefined): number;
declare const DelegateParams: Type.TObject<{
    agent: Type.TString;
    task: Type.TString;
    cwd: Type.TOptional<Type.TString>;
    model: Type.TOptional<Type.TString>;
    async: Type.TOptional<Type.TBoolean>;
    showThinking: Type.TOptional<Type.TBoolean>;
}>;
type DelegateArgs = Static<typeof DelegateParams>;
declare const CancelParams: Type.TObject<{
    runId: Type.TString;
}>;
declare const WaitParams: Type.TObject<{
    runId: Type.TString;
    timeout: Type.TOptional<Type.TInteger>;
}>;
export declare function accumulateUsage(a: Usage | undefined, b: Usage): Usage;
export declare function makeDelegateTool(pi: ExtensionAPI): ToolDefinition<typeof DelegateParams>;
/** If the delegate already delivered its result via a system notification
 *  (the close handler injected before this wait was called), return a short
 *  "already delivered" message pointing at the result file, so the model
 *  never sees the same result twice (once via the injected notification,
 *  once via this tool result). Returns null when the run was NOT injected,
 *  in which case the caller delivers the full payload via formatRunResult(). */
export declare function injectedWaitMessage(run: {
    injected?: boolean;
    result?: {
        file: string;
    };
}, runId: string, remainingLine: string): string | null;
/** Build usage-aware return payload. Sets usageReported=true so subsequent
 *  waits on the same run skip usage. */
export declare function buildWaitResult(run: DelegateRun, content: string, mode?: "merged" | "separate", contentType?: "text"): {
    details: undefined;
    content: {
        type: "text";
        text: string;
    }[];
    usage?: AgentToolResult<unknown>["usage"];
};
/** Build usage-aware result for cancel tool. */
export declare function buildCancelResult(run: DelegateRun, content: string, mode?: "merged" | "separate"): {
    details: undefined;
    content: {
        type: "text";
        text: string;
    }[];
    usage?: AgentToolResult<unknown>["usage"];
};
export declare function makeDelegateWaitTool(_pi: ExtensionAPI): ToolDefinition<typeof WaitParams>;
export declare function makeDelegateCancelTool(_pi: ExtensionAPI): ToolDefinition<typeof CancelParams>;
export declare function buildChildArgs(args: DelegateArgs, rolePrompt: string, ctx: ExtensionContext): Promise<{
    cliArgs: string[];
    tmpDir: string;
    isAsync: boolean;
    useJsonStream: boolean;
}>;
export declare function injectResult(pi: ExtensionAPI, agent: string, runId: string, task: string, code: number | null, file: string, timedOut?: string, usage?: Usage, mode?: "merged" | "separate", usageAlreadyReported?: boolean): boolean;
export {};
