import type { ResolvedHeadroom } from "./config.js";
/** The headroom half of the fusion: mechanical compression of the provider
 *  payload, applied in pi's `before_provider_request` event.
 *
 *  Placement is the whole design. billion-context-pi has already finished its
 *  work by then (prune, ref tags, model-written summaries), so headroom sees
 *  the exact bytes about to go on the wire and only has to optimize them —
 *  no patching of the upstream extension, no duplicated state, and the two
 *  layers can be upgraded independently. */
export interface HeadroomStats {
    /** Payloads the proxy actually shrank. */
    applied: number;
    savedTokens: number;
    /** Times we sent the payload untouched (proxy down, tiny payload, ...). */
    skipped: number;
}
export declare class HeadroomStage {
    private readonly getConfig;
    stats: HeadroomStats;
    /** Consecutive rounds with an unreachable proxy — the UI notice fires only
     *  on a confirmed outage, not a single stalled probe. */
    private downRounds;
    private notifiedUnavailable;
    private proxyTried;
    constructor(getConfig: () => ResolvedHeadroom);
    resetSession(): void;
    /** Called by session_start after its own spawn attempt so the request path
     *  never blocks on startup polling — it only fast health-checks afterwards. */
    markProxyAttempted(): void;
    get unavailableStreak(): number;
    /** Compress a provider payload. Returns the original on any failure — the
     *  request must always go through, compressed or not. */
    compress(payload: unknown): Promise<unknown>;
    private compressInner;
    private skip;
    private noteDown;
}
