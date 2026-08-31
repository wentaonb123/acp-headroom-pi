import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
/**
 * Host compatibility layer for pi vs omp (oh-my-pi) API differences.
 *
 * pi: systemPrompt is string, getSystemPrompt() returns string
 * omp: systemPrompt is string[], getSystemPrompt() returns string[]
 *
 * These helpers normalize the differences so the rest of the codebase
 * can work with a consistent string interface.
 */
/** Normalize systemPrompt to a single string (join with newlines if array). */
export declare function normalizeSystemPrompt(input: string | string[] | undefined): string;
/**
 * Format systemPrompt for before_agent_start event handler.
 * Always returns string to satisfy pi's type definition, but handles
 * both string (pi) and string[] (omp) input types at runtime.
 */
export declare function formatSystemPromptForEvent(base: string | string[], append: string): string;
/**
 * Get the system prompt as a single string, regardless of host type.
 * Handles both pi (string) and omp (string[]) return types.
 */
export declare function getSystemPromptText(ctx: ExtensionContext): string;
