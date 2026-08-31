export interface MatchRange {
    candidateStart: number;
    liveStart: number;
    length: number;
}
export declare function findUniqueLongestRun<Key>(candidates: readonly Key[], live: readonly Key[]): MatchRange | undefined;
