import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
/** Mirrors pi's footer.js formatTokens: lowercase k/M, thresholds <1000/<10000/<1e6/<1e7. */
export declare function formatCompactTokens(count: number): string;
export declare function initFooterStatus(ctx: ExtensionContext): void;
/** Refresh the footer status line (delegate usage + headroom state). Cheap:
 *  cached reads only; no-ops when the rendered text is unchanged (called on
 *  a 500ms tick). Async only for the headroom health probe, which is itself
 *  cached in client.ts. Concurrent ticks are harmless — lastFooterText
 *  dedupes the ui.setStatus call. */
export declare function updateFooterStatus(): Promise<void>;
export declare function disposeFooterStatus(): void;
