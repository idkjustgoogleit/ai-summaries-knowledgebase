// backend/middleware/apiAuthMiddleware.js
/**
 * API Authentication Middleware - OIDC-Only Mode
 * Session-based authentication using Passport.js OIDC sessions
 * Use with REST APIs like /api/import or admin panel APIs
 */

const { authConfig } = require('../config/auth');
const { sharedAuth } = require('../auth');
const { debugLog, errorLog } = require('../utils/debugUtils');

/**
 * API AUTHENTICATION MIDDLEWARE
 * Handles session-based OIDC authentication
 *
 * Worker mode bypasses authentication for background processing
 */
async function authenticateApiRequest(req, res, next) {
    try {
        debugLog('API_AUTH', '=== API AUTH MIDDLEWARE DEBUG START ===');
        debugLog('API_AUTH', `Request URL: ${req.url}`);
        debugLog('API_AUTH', `Request method: ${req.method}`);
        debugLog('API_AUTH', `appMode: ${authConfig.appMode}`);
        debugLog('API_AUTH', `req.isAuthenticated(): ${req.isAuthenticated()}`);
        debugLog('API_AUTH', `req.user exists: ${!!req.user}`);
        debugLog('API_AUTH', `req.session exists: ${!!req.session}`);

        // Skip authentication for worker mode
        if (authConfig.appMode === 'WORKER') {
            debugLog('API_AUTH', 'Worker mode detected, skipping authentication');
            debugLog('API_AUTH', '=== API AUTH MIDDLEWARE DEBUG END ===');
            return next();
        }

        // OIDC MODE: Use session-based authentication
        if (req.isAuthenticated()) {
            // Preserve complete user object and add convenience fields
            // This ensures all OIDC claims are available for user detection
            const originalUser = req.user;
            req.user = {
                ...originalUser, // Preserve all original user data including OIDC claims
                id: originalUser.id,
                username: originalUser.username,
                email: originalUser.email,
                role: originalUser.role,
                isAdmin: sharedAuth.isAdmin(originalUser)
            };

            debugLog('API_AUTH', '=== OIDC USER PROCESSING ===');
            debugLog('API_AUTH', 'Original user object:', JSON.stringify(originalUser, null, 2));
            debugLog('API_AUTH', 'Modified user object:', JSON.stringify(req.user, null, 2));
            debugLog('API_AUTH', `Username: ${req.user.username}`);
            debugLog('API_AUTH', 'All keys in modified user:', Object.keys(req.user));

            debugLog('API_AUTH', 'OIDC user authenticated:', {
                id: req.user.id,
                username: req.user.username,
                email: req.user.email,
                role: req.user.role,
                hasOriginalData: !!originalUser,
                originalKeys: Object.keys(originalUser)
            });

            debugLog('API_AUTH', '=== API AUTH MIDDLEWARE DEBUG END ===');
            return next();
        } else {
            // No valid OIDC session
            return res.status(401).json({
                error: 'Session authentication required',
                authMethod: 'oidc'
            });
        }
    } catch (error) {
        sharedAuth.logAuthEvent('error', 'API authentication middleware error', {
            error: error.message,
            authMethod: 'oidc'
        });

        res.status(500).json({
            error: 'Authentication error',
            authMethod: 'oidc'
        });
    }
}

module.exports = authenticateApiRequest;
