export declare function setDebugEnabled(enabled: boolean): void;
export type LogLevel = "error" | "warn" | "info" | "debug";
export declare function closeLogStream(): void;
export declare function logError(scope: string, fields: Record<string, unknown>): void;
export declare function logWarn(scope: string, fields: Record<string, unknown>): void;
export declare function logInfo(scope: string, fields: Record<string, unknown>): void;
export declare function logThrow(scope: string, err: unknown, extra?: Record<string, unknown>): void;
export declare const debug: {
    readonly enabled: boolean;
    readonly logFile: string;
    event(scope: string, fields: Record<string, unknown>): void;
};
export declare const logger: {
    error: typeof logError;
    warn: typeof logWarn;
    info: typeof logInfo;
    debug(scope: string, fields: Record<string, unknown>): void;
};
