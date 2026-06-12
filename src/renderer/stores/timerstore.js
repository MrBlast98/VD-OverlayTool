"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useTimerStore = void 0;
const zustand_1 = require("zustand");
const timer_1 = require("../utils/timer");
const t1 = new timer_1.PreciseTimer();
const t2 = new timer_1.PreciseTimer();
exports.useTimerStore = (0, zustand_1.create)((set, get) => ({
    active: 1,
    status: { 1: 'stopped', 2: 'stopped' },
    clicks: { 1: 0, 2: 0 },
    select: (n) => set((s) => ({ active: n, clicks: { ...s.clicks, [n]: s.clicks[n] } })),
    toggle: () => {
        const { active, status, clicks } = get();
        const timer = active === 1 ? t1 : t2;
        if (status[active] === 'running') {
            timer.pause();
            set({ status: { ...status, [active]: 'paused' }, clicks: { ...clicks, [active]: 1 } });
            return;
        }
        if (status[active] === 'paused') {
            if (clicks[active] >= 1) {
                timer.reset();
                set({ status: { ...status, [active]: 'stopped' }, clicks: { ...clicks, [active]: 0 } });
            }
            else {
                timer.start();
                set({ status: { ...status, [active]: 'running' }, clicks: { ...clicks, [active]: 0 } });
            }
            return;
        }
        timer.start();
        set({ status: { ...status, [active]: 'running' }, clicks: { ...clicks, [active]: 0 } });
    },
    reset: (n) => {
        (n === 1 ? t1 : t2).reset();
        set((s) => ({ status: { ...s.status, [n]: 'stopped' }, clicks: { ...s.clicks, [n]: 0 } }));
    },
    elapsed: (n) => (n === 1 ? t1 : t2).elapsedMs
}));
//# sourceMappingURL=timerstore.js.map