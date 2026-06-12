export declare class PreciseTimer {
    private _running;
    private _startedAt;
    private _accum;
    start(): void;
    pause(): void;
    reset(): void;
    get running(): boolean;
    get elapsedMs(): number;
}
export declare function formatMillis(ms: number): string;
export declare function formatMillisDynamic(ms: number): string;
//# sourceMappingURL=timer.d.ts.map