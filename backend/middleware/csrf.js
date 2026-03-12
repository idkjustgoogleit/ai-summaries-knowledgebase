/**
 * CSRF Protection Middleware
 * 
 * Modern CSRF protection using token-based validation.
 * Compatible with both session-based (OIDC) and JWT-based (local) authentication.
 * 
 * For session-based auth: Uses session to store CSRF token
 * For JWT-based auth: CSRF is not needed (Bearer tokens are not vulnerable to CSRF)
 * but we still provide token for consistency with state-changing endpoints
 */

const crypto = require('crypto');

/**
 * Generate a random CSRF token
 * @returns {string} Random token
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * CSRF middleware that validates tokens for state-changing requests
 * 
 * Endpoints can skip CSRF validation by setting req.skipCsrf = true
 */
function csrfProtection(req, res, next) {
    const { authConfig } = require('../config/auth');
    
    // Skip CSRF for JWT-based auth (not vulnerable to CSRF)
    // Bearer tokens in Authorization header are not subject to CSRF
    if (!authConfig.ssoOidc) {
        return next();
    }
    
    // Skip CSRF if explicitly requested
    if (req.skipCsrf) {
        return next();
    }
    
    // Skip CSRF for safe methods (GET, HEAD, OPTIONS)
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    
    // For session-based auth (OIDC), validate CSRF token
    const token = req.get('x-csrf-token') || req.body._csrf;
    const sessionToken = req.session?.csrfToken;
    
    if (!token) {
        return res.status(403).json({
            error: 'CSRF token missing',
            hint: 'Include X-CSRF-Token header in your request'
        });
    }
    
    if (!sessionToken || token !== sessionToken) {
        return res.status(403).json({
            error: 'CSRF token invalid',
            hint: 'Get a fresh CSRF token from /api/auth/csrf-token'
        });
    }
    
    next();
}

/**
 * Generate and store CSRF token in session
 * Used for GET /api/auth/csrf-token endpoint
 */
function getCsrfToken(req) {
    if (!req.session) {
        return null;
    }
    
    // Generate new token if not exists
    if (!req.session.csrfToken) {
        req.session.csrfToken = generateToken();
    }
    
    return req.session.csrfToken;
}

/**
 * Regenerate CSRF token (e.g., after login)
 */
function regenerateCsrfToken(req) {
    if (req.session) {
        req.session.csrfToken = generateToken();
        return req.session.csrfToken;
    }
    return null;
}

module.exports = {
    csrfProtection,
    getCsrfToken,
    regenerateCsrfToken,
    generateToken
};
