import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
/** Mirrors pi's footer.js formatTokens: lowercase k/M, thresholds <1000/<10000/<1e6/<1e7. */
export declare function formatCompactTokens(count: number): string;
export declare function initFooterStatus(ctx: ExtensionContext): void;
/** Refresh the footer delegate-usage line. Cheap: reads the accumulated total
 *  and no-ops when the rendered text is unchanged (called on a 500ms tick). */
export declare function updateFooterStatus(): void;
export declare function disposeFooterStatus(): void;
