/**
 * Route protection middleware - OIDC-Only Mode
 * Protects all routes with OIDC authentication
 */

const { authConfig } = require('../config/auth');

/**
 * Main route protection middleware - OIDC only
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function routeProtection(req, res, next) {
    // Skip protection for these paths
    const skipPaths = [
        '/api/test',
        '/api/auth/config',
        '/public',
        '/favicon.ico',
        '/manifest.json'
    ];

    // Check if path should be skipped
    if (skipPaths.some(path => req.path.startsWith(path))) {
        return next();
    }

    // OIDC Mode: Protect all routes
    return oidcProtection(req, res, next);
}

/**
 * OIDC protection for all routes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function oidcProtection(req, res, next) {
    // Allow API routes (they have their own middleware)
    if (req.path.startsWith('/api/') ||
        req.path.startsWith('/public/') ||
        req.path.startsWith('/static/') ||
        req.path.startsWith('/manifest.json') ||
        req.path.startsWith('/favicon.ico') ||
        req.path.startsWith('/health') ||
        req.path.startsWith('/ping')) {
        return next();
    }

    // For all other routes (including root '/', '/index.html', '/admin.html', etc.)
    // Check if user is authenticated
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    } else {
        // Store the original URL for redirect after login
        req.session.returnTo = req.originalUrl;

        // Redirect to OIDC login
        return res.redirect('/api/auth/oidc/login');
    }
}

/**
 * Create conditional root protection
 * @returns {Function} Middleware function
 */
function createRootProtection() {
    return (req, res, next) => {
        // Protect root and admin pages
        if (req.path === '/' || req.path === '/index.html' || req.path === '/admin.html') {
            if (req.isAuthenticated && req.isAuthenticated()) {
                // Authenticated user - allow access
                return next();
            } else {
                // Unauthenticated user - redirect to OIDC login
                req.session.returnTo = req.originalUrl;
                return res.redirect('/api/auth/oidc/login');
            }
        }
        // Other paths - allow access
        return next();
    };
}

module.exports = {
    routeProtection,
    oidcProtection,
    createRootProtection
};
