export interface Usage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheWrite1h?: number;
    reasoning?: number;
    totalTokens: number;
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        total: number;
    };
}
export interface UsageUpdateEvent {
    kind: "usage-update";
    usage: Usage;
}
export interface AgentSettledEvent {
    kind: "agent-settled";
}
export declare function handleMessageEnd(event: Record<string, unknown>): UsageUpdateEvent | null;
export interface ToolStartEvent {
    kind: "tool-start";
    toolName: string;
    argsText: string;
}
export interface ToolUpdateEvent {
    kind: "tool-update";
    toolCallId: string;
    text: string;
}
export interface ToolEndEvent {
    kind: "tool-end";
    toolName: string;
    isError: boolean;
}
export interface ReplyDeltaEvent {
    kind: "reply-delta";
    delta: string;
}
export interface ReplyCompleteEvent {
    kind: "reply-complete";
    content: string;
}
export interface ThinkingDeltaEvent {
    kind: "thinking-delta";
    delta: string;
}
export type ParsedEvent = ToolStartEvent | ToolUpdateEvent | ToolEndEvent | ReplyDeltaEvent | ReplyCompleteEvent | ThinkingDeltaEvent | ThinkingEndEvent | RetryStartEvent | RetryEndEvent | UsageUpdateEvent | AgentSettledEvent;
export interface ThinkingEndEvent {
    kind: "thinking-end";
}
/**
 * Accumulates thinking_delta tokens and emits one human-readable line per
 * thinking segment (a segment ends at thinking_end / text_start). Nothing is
 * emitted when showThinking is off.
 */
export declare class ThinkingCollector {
    private readonly showThinking;
    private buf;
    private usage;
    constructor(showThinking: boolean);
    push(delta: string): void;
    process(ev: ParsedEvent): void;
    flush(): string;
    getUsage(): Usage | undefined;
}
export interface RetryStartEvent {
    kind: "retry-start";
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    errorMessage: string;
}
export interface RetryEndEvent {
    kind: "retry-end";
    success: boolean;
    attempt: number;
}
export declare function parseEventLine(line: string): ParsedEvent | null;
/** Join `content[].text` blocks from a tool result / partialResult payload. */
export declare function extractContentText(payload: unknown): string;
/** Format a parsed event as human-readable activity file lines (each with a
 *  trailing newline; empty when none). */
export declare function activityLines(ev: ParsedEvent, opts: {
    showThinking: boolean;
}): string[];
/**
 * partialResult is an accumulated snapshot (not a delta), so each update
 * carries everything so far. Return only the newly-appended portion.
 */
export declare function newPortion(text: string, prev: string): string;
