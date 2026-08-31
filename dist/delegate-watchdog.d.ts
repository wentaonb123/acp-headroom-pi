import type { Readable } from "node:stream";
export interface WatchdogOptions {
    eofGraceMs: number;
    idleMs: number;
    timeoutMs: number;
    killGraceMs: number;
}
export interface WatchdogHooks {
    /** True once the run is finalized; watchdogs stop firing. */
    isSettled(): boolean;
    /** The child is about to be killed (SIGTERM). reason explains why. */
    onKill(reason: string): void;
    /** stdout EOF passed without the process exiting; force-finalize now. */
    onEofGrace(): void;
}
export interface WatchdogHandle {
    /** Re-arm the idle timer (call on every stdout data). */
    poke(): void;
    /** Stop all timers (call on finalize). */
    dispose(): void;
    /**
     * agent_settled has been received: the agent's full flow (prompt + continue
     * loop + retries) is over and pi emits this exactly once in the finally of
     * _runAgentPrompt, after which the process should exit within milliseconds.
     * If it is still alive after graceMs, the process is stuck in teardown
     * (e.g. a provider call not returning) — kill it via killByWatchdog. graceMs
     * is symmetric with EOF_GRACE_MS (10s): normal exits are millisecond-level,
     * so 10s only hits genuinely hung processes. Idempotent (no-op when already
     * settled or a grace timer is pending); dispose() clears the timer.
     */
    settledGrace(graceMs: number, _killGraceMs: number, reason: string): void;
}
/**
 * Guarantees a hung child process gets killed. A stuck child holds its stdout
 * fd open, so stdout EOF never fires — hence the idle timer (no output for
 * idleMs) is the main defense; the hard time limit and the EOF grace period
 * cover the rest. Kill is SIGTERM, escalated to SIGKILL after killGraceMs.
 */
export declare function attachWatchdogs(child: {
    kill(signal: NodeJS.Signals): boolean;
    stdout: Readable | null;
}, hooks: WatchdogHooks, opts: WatchdogOptions): WatchdogHandle;
