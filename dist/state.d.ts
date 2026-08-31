import { type CompressionState } from "acp-kernel";
export interface LiveRefOrigin {
    rawId: string;
    identity: string;
}
export declare function readParentSessionPath(sessionFile: string): Promise<string | undefined>;
export declare class SessionStateStore {
    private cache;
    load(sessionFile: string | undefined, sessionId: string): Promise<CompressionState>;
    save(state: CompressionState, sessionFile: string | undefined, sessionId: string): Promise<void>;
    getLiveRefOrigins(sessionFile: string | undefined, sessionId: string): LiveRefOrigin[];
    setLiveRefOrigins(sessionFile: string | undefined, sessionId: string, origins: LiveRefOrigin[]): void;
    invalidate(): void;
    private tryLoadParentState;
}
