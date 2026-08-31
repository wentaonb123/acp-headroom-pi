import { type ExtensionAPI, type ToolResultEvent } from "@earendil-works/pi-coding-agent";
import type { AcpRuntime } from "./runtime.js";
export type BashToolResultEvent = Extract<ToolResultEvent, {
    toolName: "bash";
}>;
export declare function isBashToolResult(e: ToolResultEvent): e is BashToolResultEvent;
export declare function resolveBashTimeout(input: {
    timeout?: number;
}, defaultTimeout: number | undefined): number | undefined;
export declare function capToolOutput(content: ToolResultEvent["content"], maxBytes: number | undefined, fullPath?: string): ToolResultEvent["content"] | undefined;
export declare function detectBashTimeout(content: ToolResultEvent["content"]): number | undefined;
export declare function appendTimeoutNotice(content: ToolResultEvent["content"], secs: number): ToolResultEvent["content"];
export declare function wireToolGuardrails(pi: ExtensionAPI, runtime: AcpRuntime): void;
