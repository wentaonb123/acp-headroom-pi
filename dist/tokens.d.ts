import { type CoreMessage } from "acp-kernel";
export declare function collectCoveredMessageIds(state: {
    blocks: {
        active: boolean;
        effectiveMessageIds: string[];
    }[];
}): Set<string>;
export declare function estimateTokens(messages: CoreMessage[], coveredIds?: Set<string>): number;
/** Scale a raw (uncalibrated) sent-view estimate by the per-model density
 *  learned from provider usage (density = real/estimate). Used for nudge /
 *  usage / emergency arbitration at every processTurn site so the decision
 *  runs on the provider-anchored scale; the estimator itself is always fed
 *  the RAW estimate — see density.ts. */
export declare function calibrateTokens(estimate: number, density: number): number;
/** Id of the last user-role entry — used as a per-turn key so a nudge prints at
 *  most once per turn. Returns undefined if there is no user message yet. */
export declare function lastUserMessageId(entries: {
    id: string;
    message?: {
        role?: string;
    };
}[]): string | undefined;
