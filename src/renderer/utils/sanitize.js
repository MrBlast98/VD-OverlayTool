"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizePlayerName = sanitizePlayerName;
/**
 * Sanitize player names to prevent XSS and other issues
 * Removes special characters but keeps spaces and common symbols
 */
function sanitizePlayerName(name) {
    if (!name)
        return '';
    // Remove leading/trailing whitespace
    let sanitized = String(name).trim();
    // Limit length to reasonable size
    if (sanitized.length > 32) {
        sanitized = sanitized.substring(0, 32);
    }
    // Keep only safe characters: letters, numbers, spaces, and common symbols
    sanitized = sanitized.replace(/[^\w\s\-._~]/gu, '');
    return sanitized;
}
//# sourceMappingURL=sanitize.js.map