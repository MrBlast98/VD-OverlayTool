type Status = 'stopped' | 'running' | 'paused';
type S = {
    active: 1 | 2;
    status: Record<1 | 2, Status>;
    clicks: Record<1 | 2, 0 | 1 | 2>;
    select: (n: 1 | 2) => void;
    toggle: () => void;
    reset: (n: 1 | 2) => void;
    elapsed: (n: 1 | 2) => number;
};
export declare const useTimerStore: import("zustand").UseBoundStore<import("zustand").StoreApi<S>>;
export {};
//# sourceMappingURL=timerstore.d.ts.map