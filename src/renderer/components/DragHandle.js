"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const cn_1 = require("../utils/cn");
const DragHandle = ({ isVisible, className }) => {
    return ((0, jsx_runtime_1.jsx)("div", { className: (0, cn_1.cn)('absolute top-0 left-0 right-0 h-8 z-50 transition-all duration-300', 'bg-gradient-to-r from-purple-500/20 via-purple-400/30 to-purple-500/20', 'border-b-2 border-purple-400/40', 'shadow-lg shadow-purple-500/30', 'flex items-center justify-center', 'select-none cursor-move', 'animate-pulse-glow', isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none', className), style: {
            WebkitAppRegion: 'drag'
        }, children: (0, jsx_runtime_1.jsxs)("div", { className: "flex items-center space-x-2 text-purple-300 text-xs font-semibold uppercase tracking-wider", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex space-x-1", children: [(0, jsx_runtime_1.jsx)("div", { className: "w-1 h-1 bg-purple-400 rounded-full animate-pulse" }), (0, jsx_runtime_1.jsx)("div", { className: "w-1 h-1 bg-purple-400 rounded-full animate-pulse", style: { animationDelay: '0.2s' } }), (0, jsx_runtime_1.jsx)("div", { className: "w-1 h-1 bg-purple-400 rounded-full animate-pulse", style: { animationDelay: '0.4s' } })] }), (0, jsx_runtime_1.jsx)("span", { children: "Drag to Move" }), (0, jsx_runtime_1.jsxs)("div", { className: "flex space-x-1", children: [(0, jsx_runtime_1.jsx)("div", { className: "w-1 h-1 bg-purple-400 rounded-full animate-pulse", style: { animationDelay: '0.6s' } }), (0, jsx_runtime_1.jsx)("div", { className: "w-1 h-1 bg-purple-400 rounded-full animate-pulse", style: { animationDelay: '0.8s' } }), (0, jsx_runtime_1.jsx)("div", { className: "w-1 h-1 bg-purple-400 rounded-full animate-pulse", style: { animationDelay: '1s' } })] })] }) }));
};
exports.default = DragHandle;
//# sourceMappingURL=DragHandle.js.map