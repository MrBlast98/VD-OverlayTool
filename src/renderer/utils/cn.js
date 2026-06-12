"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cn = cn;
/**
 * Class name utility function (tailwind classname merger)
 * Combines multiple classnames, filtering out falsy values
 */
function cn(...classes) {
    return classes.filter(Boolean).join(' ');
}
//# sourceMappingURL=cn.js.map