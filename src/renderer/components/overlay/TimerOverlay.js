"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TimerOverlay;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = __importDefault(require("react"));
const timerstore_1 = require("../../stores/timerstore");
const timer_1 = require("../../utils/timer");
const MAX_CHARS = 8;
const DIFF20 = 20000;
const DIFF10 = 10000;
function cleanName(value, fallback) {
    const text = String(value ?? "").trim();
    return text ? text.slice(0, 32) : fallback;
}
/** Write formatted timer string directly into pre-allocated span elements */
function writeTimerSpans(spans, ms) {
    if (spans.length === 0)
        return;
    const fmt = (0, timer_1.formatMillisDynamic)(ms);
    let i = 0;
    for (; i < fmt.length && i < spans.length; i++) {
        const ch = fmt[i];
        const span = spans[i];
        if (span.textContent !== ch)
            span.textContent = ch;
        const isSep = ch === ':' || ch === '.';
        const want = isSep ? 'timer-char separator' : 'timer-char';
        if (span.className !== want)
            span.className = want;
        if (span.style.display === 'none')
            span.style.display = '';
    }
    for (; i < spans.length; i++) {
        if (spans[i].style.display !== 'none')
            spans[i].style.display = 'none';
    }
}
function TimerOverlay() {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "pointer-events-none select-none timer-overlay-placeholder-shell", children: [(0, jsx_runtime_1.jsx)("div", { className: "timer-overlay-placeholder-card", children: [(0, jsx_runtime_1.jsx)("div", { className: "timer-overlay-placeholder-kicker", children: "1v1 TIMER" }), (0, jsx_runtime_1.jsx)("div", { className: "timer-overlay-placeholder-title", children: "Currently being reworked." }), (0, jsx_runtime_1.jsx)("div", { className: "timer-overlay-placeholder-copy", children: "The 1v1 timer is temporarily unavailable while we rebuild the flow and visuals." })] })] }));
}
//# sourceMappingURL=TimerOverlay.js.map