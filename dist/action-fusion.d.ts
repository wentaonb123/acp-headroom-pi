/**
 * Action Fusion — fuse a file mutation and its follow-up command into one turn.
 *
 * Adapted from NVLabs/SoL-Pi (MIT, https://github.com/NVlabs/SoL-Pi),
 * src/sol-pi/extensions/action-fusion/. Base rollouts repeatedly show the
 * same pair of turns: edit or write a file, then run a command to build, test,
 * or start it. The fused tools take an optional `then_run` parameter, apply
 * the mutation, run the command, and return one combined observation — the
 * model decision between the two turns disappears (one model round-trip saved
 * per edit+validate pair).
 *
 * Everything else about `edit` and `write` is inherited from pi's built-in
 * definitions: schemas, prompt text, argument shims, and renderers. On by
 * default; the acp.json `actionFusion` key (set false) restores pi's stock
 * tools.
 */
import { type AgentToolResult, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
export declare const THEN_RUN_SUCCEEDED = "[then_run:succeeded]";
export declare const THEN_RUN_FAILED = "[then_run:failed]";
export declare const THEN_RUN_SKIPPED = "[then_run:skipped]";
export interface ThenRunInput {
    command: string;
    timeout?: number;
}
export declare function createThenRunSchema(description: string): Type.TOptional<Type.TObject<{
    command: Type.TString;
    timeout: Type.TOptional<Type.TNumber>;
}>>;
/** Normalize whatever the model passed as a tool path (relative, `@`-prefixed,
 *  `file://` URL, `~/...`) to the absolute target the queue and hash guard
 *  must both agree on. */
export declare function resolveToolPath(cwd: string, filePath: string): string;
/** Serialize fused operations for one canonical file path, so two fused
 *  mutations of the same file cannot interleave mutation + command. This
 *  queue is ours and intentionally does not nest pi's built-in mutation
 *  queue. */
export declare function withFusedFileQueue<T>(filePath: string, work: () => Promise<T>): Promise<T>;
/** Detect interference between the fused mutation and the command: hash the
 *  target, yield once (letting any queued writer land), then hash again.
 *  A mismatch means something else touched the file — running the command
 *  now would validate the wrong content. */
export declare function assertUnchangedBeforeCommand(path: string, yieldForInterference?: () => Promise<void>): Promise<void>;
export interface ExecuteMutationThenRunOptions<TDetails> {
    toolCallId: string;
    absolutePath: string;
    thenRun: ThenRunInput | undefined;
    mutate: () => Promise<AgentToolResult<TDetails>>;
    /** Bash executor for the follow-up command. Defaults to pi's built-in bash
     *  tool; injectable so tests never spawn a shell. */
    runBash?: (thenRun: ThenRunInput) => Promise<AgentToolResult<unknown>>;
    signal?: AbortSignal;
    ctx: ExtensionContext;
}
/** Apply a file mutation and, when the model asked for one, run its follow-up
 *  command before returning a single observation. Mutation failure skips the
 *  command (`[then_run:skipped]`); command failure is reported but keeps the
 *  mutation (`[then_run:failed]`). */
export declare function executeMutationThenRun<TDetails>({ toolCallId, absolutePath, thenRun, mutate, runBash, signal, ctx, }: ExecuteMutationThenRunOptions<TDetails>): Promise<AgentToolResult<TDetails>>;
/** Replace pi's built-in `edit` and `write` with fused versions. Call once
 *  per session, only when the acp.json `actionFusion` key enables it. */
export declare function registerActionFusionTools(pi: ExtensionAPI): void;
