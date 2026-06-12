"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ScrollingName;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
function ScrollingName({ text, speed = 40, className = "" }) {
    const wrapRef = (0, react_1.useRef)(null);
    const innerRef = (0, react_1.useRef)(null);
    const [scrollNeeded, setScrollNeeded] = (0, react_1.useState)(false);
    const [overflow, setOverflow] = (0, react_1.useState)(0);
    (0, react_1.useLayoutEffect)(() => {
        const wrap = wrapRef.current;
        const inner = innerRef.current;
        if (!wrap || !inner)
            return;
        const measure = () => {
            const wrapWidth = wrap.clientWidth;
            const textWidth = inner.scrollWidth;
            const overflowPx = Math.max(0, textWidth - wrapWidth);
            const needsScroll = overflowPx > 2;
            setOverflow((prev) => (prev === overflowPx ? prev : overflowPx));
            setScrollNeeded((prev) => (prev === needsScroll ? prev : needsScroll));
            wrap.style.justifyContent = needsScroll ? "flex-start" : "center";
            inner.style.willChange = needsScroll ? 'transform' : 'auto';
            if (!needsScroll)
                inner.style.transform = "translate3d(0,0,0)";
        };
        const ro = new ResizeObserver(measure);
        ro.observe(wrap);
        ro.observe(inner);
        if (document.fonts?.ready) {
            document.fonts.ready.then(() => requestAnimationFrame(measure));
        }
        measure();
        return () => ro.disconnect();
    }, [text]);
    (0, react_1.useEffect)(() => {
        if (!scrollNeeded || overflow <= 0)
            return;
        const inner = innerRef.current;
        if (!inner)
            return;
        const baseSpeed = Math.max(22, speed * 0.7);
        const maxSpeed = Math.max(baseSpeed, speed * 1.8);
        const scaleFactor = 0.15;
        const dynamicSpeed = Math.min(maxSpeed, baseSpeed + overflow * scaleFactor);
        let raf = 0;
        let last = performance.now();
        let x = 0;
        let dir = -1;
        const step = (now) => {
            const dt = (now - last) / 1000;
            last = now;
            x += dir * dynamicSpeed * dt;
            if (x < -overflow) {
                x = -overflow;
                dir = +1;
            }
            if (x > 0) {
                x = 0;
                dir = -1;
            }
            inner.style.transform = `translate3d(${x}px, 0, 0)`;
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame((n) => {
            last = n;
            step(n);
        });
        return () => cancelAnimationFrame(raf);
    }, [scrollNeeded, overflow, speed]);
    return ((0, jsx_runtime_1.jsx)("div", { ref: wrapRef, className: `scrolling-name ${className}`, title: text, "aria-label": text, children: (0, jsx_runtime_1.jsx)("div", { ref: innerRef, className: "scrolling-name__inner", children: text }) }));
}
//# sourceMappingURL=ScrollingName.js.map