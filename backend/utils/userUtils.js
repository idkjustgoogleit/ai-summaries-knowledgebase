/**
 * User utility functions for authentication and user detection
 * OIDC-Only Authentication Mode
 */

const { debugLog, errorLog } = require('./debugUtils');

/**
 * Get current username from request (OIDC-Only Mode)
 * @param {Object} req - Express request object
 * @returns {string} Username of current user
 */
function getCurrentUsername(req) {
    debugLog('USER_UTILS', '=== USER DETECTION DEBUG START ===');
    debugLog('USER_UTILS', `Request URL: ${req.url}`);
    debugLog('USER_UTILS', `Request method: ${req.method}`);
    debugLog('USER_UTILS', 'Request headers:', JSON.stringify(req.headers, null, 2));

    // Enhanced debugging: Deep dive into req.user
    debugLog('USER_UTILS', '=== REQ.USER ANALYSIS ===');
    if (req.user) {
        debugLog('USER_UTILS', 'req.user exists: TRUE');
        debugLog('USER_UTILS', `req.user type:`, typeof req.user);
        debugLog('USER_UTILS', `req.user constructor:`, req.user.constructor.name);
        debugLog('USER_UTILS', 'All req.user fields:', Object.keys(req.user));
        debugLog('USER_UTILS', `req.user.username:`, req.user.username);
        debugLog('USER_UTILS', `req.user.preferred_username:`, req.user.preferred_username);
        debugLog('USER_UTILS', `req.user.email:`, req.user.email);
        debugLog('USER_UTILS', `req.user.oidc_email:`, req.user.oidc_email);
        debugLog('USER_UTILS', `req.user.oidc_subject:`, req.user.oidc_subject);
        debugLog('USER_UTILS', `req.user.name:`, req.user.name);
        debugLog('USER_UTILS', `req.user.sub:`, req.user.sub);
        debugLog('USER_UTILS', 'Full req.user object:', JSON.stringify(req.user, null, 2));
    } else {
        debugLog('USER_UTILS', 'req.user exists: FALSE');
    }

    // Enhanced debugging: Deep dive into req.session
    debugLog('USER_UTILS', '=== REQ.SESSION ANALYSIS ===');
    if (req.session) {
        debugLog('USER_UTILS', 'req.session exists: TRUE');
        debugLog('USER_UTILS', 'All session fields:', Object.keys(req.session));
        debugLog('USER_UTILS', 'session.passport:', JSON.stringify(req.session.passport, null, 2));
        debugLog('USER_UTILS', 'session.passport.user:', JSON.stringify(req.session.passport?.user, null, 2));
        debugLog('USER_UTILS', `session.username:`, req.session.username);
        debugLog('USER_UTILS', 'Full session object:', JSON.stringify(req.session, null, 2));
    } else {
        debugLog('USER_UTILS', 'req.session exists: FALSE');
    }

    // OIDC-Only mode - extract from authenticated session
    // Try multiple sources for username in OIDC mode with enhanced extraction
    let username = null;
    let source = 'unknown';

    // Try direct user object first
    if (req.user) {
        debugLog('USER_UTILS', '=== TRYING REQ.USER ===');
        const candidates = [
            { field: 'username', value: req.user.username },
            { field: 'email_split', value: req.user.email?.split('@')[0] },
            { field: 'preferred_username', value: req.user.preferred_username },
            { field: 'preferred_username_bracket', value: req.user['preferred_username'] },
            { field: 'name', value: req.user.name },
            { field: 'sub', value: req.user.sub }
        ];

        for (const candidate of candidates) {
            if (candidate.value) {
                username = candidate.value;
                source = `req.user.${candidate.field}`;
                debugLog('USER_UTILS', `✓ FOUND via ${source}: ${username}`);
                break;
            } else {
                debugLog('USER_UTILS', `✗ ${candidate.field} is null/undefined`);
            }
        }
    }

    // Try session passport user
    if (!username && req.session?.passport?.user) {
        debugLog('USER_UTILS', '=== TRYING SESSION.PASSPORT.USER ===');
        const passportUser = req.session.passport.user;
        const candidates = [
            { field: 'username', value: passportUser.username },
            { field: 'email_split', value: passportUser.email?.split('@')[0] },
            { field: 'preferred_username', value: passportUser.preferred_username },
            { field: 'preferred_username_bracket', value: passportUser['preferred_username'] },
            { field: 'name', value: passportUser.name },
            { field: 'sub', value: passportUser.sub }
        ];

        for (const candidate of candidates) {
            if (candidate.value) {
                username = candidate.value;
                source = `session.passport.user.${candidate.field}`;
                debugLog('USER_UTILS', `✓ FOUND via ${source}: ${username}`);
                break;
            } else {
                debugLog('USER_UTILS', `✗ ${candidate.field} is null/undefined`);
            }
        }
    }

    // Try direct session username
    if (!username && req.session?.username) {
        username = req.session.username;
        source = 'req.session.username';
        debugLog('USER_UTILS', `✓ FOUND via ${source}: ${username}`);
    }

    // Fallback to admin if no username found
    if (!username) {
        username = 'admin';
        source = 'fallback';
        debugLog('USER_UTILS', `✗ NO USERNAME FOUND - using fallback: ${username}`);
    }

    debugLog('USER_UTILS', '=== FINAL RESULT ===');
    debugLog('USER_UTILS', `Final username: ${username}`);
    debugLog('USER_UTILS', `Source: ${source}`);
    debugLog('USER_UTILS', '=== USER DETECTION DEBUG END ===');

    return username;
}

/**
 * Check if request is authenticated (OIDC-Only Mode)
 * @param {Object} req - Express request object
 * @returns {boolean} True if user is authenticated
 */
function isAuthenticated(req) {
    // OIDC-Only mode - check for authenticated session
    return !!(req.user || req.session?.passport?.user);
}

/**
 * Get user information from request (OIDC-Only Mode)
 * @param {Object} req - Express request object
 * @returns {Object|null} User object or null if not authenticated
 */
function getUserFromRequest(req) {
    // OIDC-Only mode
    return req.user || req.session?.passport?.user || null;
}

module.exports = {
    getCurrentUsername,
    isAuthenticated,
    getUserFromRequest
};
