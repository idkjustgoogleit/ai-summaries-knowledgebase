// backend/auth/index.js
/**
 * Main authentication module entry point - OIDC-Only Mode
 * Handles initialization of OIDC authentication with session management
 */

const authConfig = require('../config/auth');
const oidcAuth = require('./oidc');
const sharedAuth = require('./shared');

// Session cleanup interval storage
let sessionCleanupInterval = null;

/**
 * Initialize authentication system
 * @param {Express} app - Express application instance
 * @param {Pool} db - Database connection pool
 */
function initializeAuth(app, db) {
    const { debugLog } = require('../utils/debugUtils');
    debugLog('AUTH_INIT', 'Initializing OIDC-only authentication system...');
    debugLog('AUTH_INIT', `APP_MODE: ${process.env.APP_MODE}`);

    // Initialize shared components
    sharedAuth.initialize(db);

    // Initialize OIDC authentication
    debugLog('AUTH_INIT', 'Using OIDC authentication');
    oidcAuth.initialize(app, db);

    // Start session cleanup job (cleanup expired sessions every hour)
    const cleanupIntervalMs = parseInt(process.env.SESSION_CLEANUP_INTERVAL_MS || '3600000', 10); // Default: 1 hour
    sessionCleanupInterval = setInterval(async () => {
        try {
            const deletedCount = await sharedAuth.cleanupExpiredSessions();
            if (deletedCount > 0) {
                debugLog('AUTH_INIT', `Session cleanup: Removed ${deletedCount} expired session(s)`);
            }
        } catch (error) {
            const { errorLog } = require('../utils/debugUtils');
            errorLog('AUTH_INIT', 'Session cleanup failed', error);
        }
    }, cleanupIntervalMs);

    debugLog('AUTH_INIT', `Session cleanup job started (interval: ${cleanupIntervalMs}ms)`);

    // Run initial cleanup on startup
    sharedAuth.cleanupExpiredSessions().then(count => {
        if (count > 0) {
            debugLog('AUTH_INIT', `Initial session cleanup: Removed ${count} expired session(s)`);
        }
    }).catch(error => {
        const { errorLog } = require('../utils/debugUtils');
        errorLog('AUTH_INIT', 'Initial session cleanup failed', error);
    });

    debugLog('AUTH_INIT', 'Authentication system initialized successfully');
}

/**
 * Shutdown authentication system (cleanup intervals)
 */
function shutdownAuth() {
    const { debugLog } = require('../utils/debugUtils');
    if (sessionCleanupInterval) {
        clearInterval(sessionCleanupInterval);
        sessionCleanupInterval = null;
        debugLog('AUTH_INIT', 'Session cleanup job stopped');
    }
}

module.exports = {
    initializeAuth,
    shutdownAuth,
    // Export individual modules for direct access if needed
    oidcAuth,
    sharedAuth
};
