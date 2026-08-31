import { type CompressionState } from "acp-kernel";
export interface LiveRefOrigin {
    rawId: string;
    identity: string;
}
export declare function readParentSessionPath(sessionFile: string): Promise<string | undefined>;
export declare class SessionStateStore {
    private cache;
    load(sessionFile: string | undefined, sessionId: string): Promise<CompressionState>;
    /** Persist state atomically (tmp file + rename). Returns false when the
     *  write failed — callers surface this to the model, because the disk is
     *  the only source of truth and an unsaved block is lost on restart. A
     *  missing session file (in-memory session) counts as success: there is
     *  nothing to lose. */
    save(state: CompressionState, sessionFile: string | undefined, sessionId: string): Promise<boolean>;
    getLiveRefOrigins(sessionFile: string | undefined, sessionId: string): LiveRefOrigin[];
    setLiveRefOrigins(sessionFile: string | undefined, sessionId: string, origins: LiveRefOrigin[]): void;
    invalidate(): void;
    private tryLoadParentState;
}
