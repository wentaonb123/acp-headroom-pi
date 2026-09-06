export declare function setDebugEnabled(v: boolean): void;
export declare const log: {
    info: (event: Record<string, unknown>) => void;
    warn: (event: Record<string, unknown>) => void;
    error: (event: Record<string, unknown>) => void;
    debug: (event: Record<string, unknown>) => void;
};
