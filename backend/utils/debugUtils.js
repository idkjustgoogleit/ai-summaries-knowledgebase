/**
 * Debug utility functions for conditional logging
 * Provides centralized control over debug logging via DEBUG_MODE environment variable
 * Supports both lowercase and uppercase boolean values for robustness
 */

// Case-insensitive DEBUG_MODE detection
const DEBUG_MODE = process.env.DEBUG_MODE === 'true' || process.env.DEBUG_MODE === 'TRUE';

/**
 * Conditional debug logging - only logs when DEBUG_MODE is enabled
 * @param {string} category - Log category for identification (e.g., 'USER_UTILS', 'API_AUTH')
 * @param {string} message - Log message
 * @param {any} data - Optional data to log (objects, arrays, etc.)
 */
function debugLog(category, message, data = null) {
    if (DEBUG_MODE) {
        if (data !== null && data !== undefined) {
            console.log(`[${category}] ${message}:`, data);
        } else {
            console.log(`[${category}] ${message}`);
        }
    }
}

/**
 * Unconditional error logging - always logs regardless of DEBUG_MODE
 * @param {string} category - Log category for identification
 * @param {string} message - Error message
 * @param {Error|any} error - Optional error object or details
 */
function errorLog(category, message, error = null) {
    if (error !== null && error !== undefined) {
        console.error(`[${category}] ${message}:`, error);
    } else {
        console.error(`[${category}] ${message}`);
    }
}

/**
 * Check if debug mode is enabled
 * @returns {boolean} True if debug logging is enabled
 */
function isDebugEnabled() {
    return DEBUG_MODE;
}

module.exports = {
    debugLog,
    errorLog,
    isDebugEnabled
};
