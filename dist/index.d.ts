import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { CompressibleRange } from "acp-kernel";
import { type AdapterConfig } from "./config.js";
export declare function createAcpExtension(adapter?: AdapterConfig): ExtensionFactory;
declare const _default: ExtensionFactory;
export default _default;
/** Drop recommended ranges the model can no longer act on:
 *  - either ref no longer resolves in messageRefs (pruned / renumbered since
 *    the snapshot → the kernel rejects the whole batch atomically),
 *  - the range's end ref has slid into the protected tail (last
 *    preserveRecentMessages entries + the most recent user entry) by action
 *    time. Exported for tests. */
export declare function filterActionableRanges(ranges: CompressibleRange[], entries: Array<{
    id: string;
    message?: {
        role?: string;
    };
}>, state: {
    messageRefs?: {
        byRaw: Record<string, string>;
        byRef: Record<string, string>;
    };
} | undefined, preserveRecentMessages: number): CompressibleRange[];
