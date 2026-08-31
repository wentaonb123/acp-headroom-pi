export declare const OVERFLOW_MARKER: RegExp;
export interface OverflowInfo {
    isOverflow: boolean;
    /** The real context window, when the provider stated it in the error. */
    window?: number;
    message: string;
}
export declare function inspectOverflowMessage(haystack: string | undefined | null): OverflowInfo;
/**
 * Reserve the model's output budget from the context window, so the kernel's
 * nudge/truncate bands sit below (window - maxOutput) and the context always
 * leaves room for the model's reply. This prevents the "context + output >
 * window" overflow on a small window (agents routinely set a large max output).
 * Returns the window unchanged when maxOutput is not usable (non-positive,
 * non-finite, or >= window — a maxOutput >= window request is degenerate and is
 * left to the overflow self-heal).
 */
export declare function reserveOutputHeadroom(window: number, maxOutput: number): number;
/**
 * Whether the OUTPUT budget should be reserved from the context window at
 * all. Anthropic's Messages API enforces the input limit INDEPENDENTLY of
 * max_tokens (the output budget is separate — input up to the window works
 * with any max_tokens), so reserving the model's output capability would
 * shift the nudge/truncate bands down by maxTokens on every session with no
 * safety gain (e.g. a 200k model with a 64k output budget would start
 * compressing around 136k). The OpenAI-family APIs count output against the
 * window, so the reservation is only needed there. Unknown APIs reserve
 * (conservative — a missed reservation at worst overflows once and the
 * self-heal corrects it).
 */
export declare function shouldReserveOutputHeadroom(api: string | undefined): boolean;
export declare class OverflowEpisode {
    /** Real windows learned from overflow errors, keyed by model id. A learned
     *  window is model-specific: switching to a bigger model mid-session must
     *  not inherit the smaller model's learned limit (that would re-center the
     *  bands below the new model's real window → premature compression). */
    private learned;
    learnedWindowFor(modelId: string): number | null;
    setLearnedWindow(modelId: string, window: number): void;
    /** When true, the next context event forces usage >=95% (emergency). Kept
     *  session-scoped (not per-model): the context did not shrink, so the next
     *  turn needs the emergency regardless of which model answers it. */
    armed: boolean;
    reset(): void;
}
