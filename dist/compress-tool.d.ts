import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AcpRuntime } from "./runtime.js";
declare const CompressParams: Type.TObject<{
    topic: Type.TOptional<Type.TString>;
    content: Type.TUnion<[Type.TArray<Type.TObject<{
        startId: Type.TString;
        endId: Type.TString;
        summary: Type.TString;
        topic: Type.TOptional<Type.TString>;
    }>>, Type.TString]>;
    summaryMaxChars: Type.TOptional<Type.TNumber>;
}>;
export declare function makeCompressTool(runtime: AcpRuntime): ToolDefinition<typeof CompressParams>;
/** Success = completed run that created >= 1 block (partial range errors
 *  still count: progress was made). A 0-block panel must NOT be success —
 *  it would reset the retry counter while the emergency nudge re-fires,
 *  looping no-op compressions (issue #6). */
export declare function isCompressSuccessText(text: string): boolean;
/** No-op = completed run that compressed nothing (0-block panel: every
 *  range skipped). Counted as a FAILED attempt by noteCompressOutcomes so
 *  the retry cap applies. Non-panels ("No ranges provided.") stay neutral. */
export declare function isCompressNoopText(text: string): boolean;
/** Terminal failure = the gate rejected the RANGES themselves (already
 *  compressed / batch too small / inside the protected zone). Retrying the
 *  same call can never succeed — only fresh ranges from a new acp_status
 *  read help. Forced retry prompts for these are pure noise: observed in
 *  production as 3x-per-turn injection loops on structurally doomed ranges,
 *  repeating every turn while the stale recommendation persisted.
 *  Transient failures (argument shape, JSON-encoded content) stay
 *  retry-eligible — corrected arguments CAN succeed. */
export declare function isTerminalCompressErrorText(text: string): boolean;
export {};
