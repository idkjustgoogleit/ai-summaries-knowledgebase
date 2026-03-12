// backend/middleware/checkAdminRights.js
/**
 * Admin Rights Check Middleware - OIDC-Only Mode
 * Verifies that the authenticated user has admin privileges
 */

const { authConfig } = require('../config/auth');
const { sharedAuth } = require('../auth');

const checkAdminRights = async (req, res, next) => {
    try {
        // Skip authentication for worker mode
        if (authConfig.appMode === 'WORKER') {
            // In worker mode, assume admin rights for internal processes
            req.user = {
                id: 0,
                username: 'worker',
                role: authConfig.roles.admin,
                isAdmin: true
            };
            return next();
        }

        // Check if user is already authenticated by authenticateApiRequest middleware
        if (!req.user) {
            return res.status(401).json({
                error: 'Access denied. Authentication required.',
                authMethod: 'oidc'
            });
        }

        const user = req.user;

        // Check if user has admin privileges
        if (!sharedAuth.isAdmin(user)) {
            sharedAuth.logAuthEvent('warn', 'Admin access denied', {
                userId: user.id,
                username: user.username,
                role: user.role,
                reason: 'insufficient_role',
                authMethod: 'oidc'
            });

            return res.status(403).json({
                error: 'Access denied. Admin rights required.',
                authMethod: 'oidc'
            });
        }

        // User is admin, proceed
        next();
    } catch (error) {
        sharedAuth.logAuthEvent('error', 'Admin rights check failed', {
            error: error.message,
            authMethod: 'oidc'
        });

        res.status(500).json({
            error: 'Authorization check failed.',
            authMethod: 'oidc'
        });
    }
};

module.exports = checkAdminRights;
