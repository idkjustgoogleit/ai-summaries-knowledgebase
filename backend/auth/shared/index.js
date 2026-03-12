// backend/auth/shared/index.js
/**
 * Shared authentication components - OIDC-Only Mode
 * Common utilities and middleware for OIDC authentication with session management
 */

const { authConfig } = require('../../config/auth');
const { debugLog, errorLog } = require('../../utils/debugUtils');

let db = null;

/**
 * Initialize shared authentication components
 * @param {Pool} database - Database connection pool
 */
function initialize(database) {
    db = database;
    debugLog('AUTH_SHARED', 'Shared components initialized');
}

/**
 * Get user by ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} User object or null
 */
async function getUserById(userId) {
    try {
        const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
        return result.rows[0] || null;
    } catch (error) {
        errorLog('AUTH_SHARED', 'Error getting user by ID', error);
        throw error;
    }
}

/**
 * Get user by OIDC subject
 * @param {string} oidcSubject - OIDC subject
 * @param {string} oidcProvider - OIDC provider
 * @returns {Promise<Object|null>} User object or null
 */
async function getUserByOidcSubject(oidcSubject, oidcProvider) {
    try {
        const result = await db.query(
            'SELECT * FROM users WHERE oidc_subject = $1 AND oidc_provider = $2',
            [oidcSubject, oidcProvider]
        );
        return result.rows[0] || null;
    } catch (error) {
        errorLog('AUTH_SHARED', 'Error getting user by OIDC subject', error);
        throw error;
    }
}

/**
 * Create session in database
 * @param {number} userId - User ID
 * @param {string} sessionToken - Session token
 * @param {Date} expiresAt - Expiration time
 * @returns {Promise<Object>} Session object
 */
async function createSession(userId, sessionToken, expiresAt) {
    try {
        const result = await db.query(
            `INSERT INTO sessions (user_id, session_token, expires_at)
             VALUES ($1, $2, $3) RETURNING *`,
            [userId, sessionToken, expiresAt]
        );
        return result.rows[0];
    } catch (error) {
        errorLog('AUTH_SHARED', 'Error creating session', error);
        throw error;
    }
}

/**
 * Get session by token
 * @param {string} sessionToken - Session token
 * @returns {Promise<Object|null>} Session object with user data or null
 */
async function getSessionByToken(sessionToken) {
    try {
        const result = await db.query(
            `SELECT s.*, u.username, u.email, u.role, u.oidc_provider, u.oidc_subject
             FROM sessions s
             JOIN users u ON s.user_id = u.id
             WHERE s.session_token = $1 AND s.expires_at > NOW()`,
            [sessionToken]
        );
        return result.rows[0] || null;
    } catch (error) {
        errorLog('AUTH_SHARED', 'Error getting session by token', error);
        throw error;
    }
}

/**
 * Delete session by token
 * @param {string} sessionToken - Session token
 * @returns {Promise<boolean>} True if session was deleted
 */
async function deleteSession(sessionToken) {
    try {
        const result = await db.query(
            'DELETE FROM sessions WHERE session_token = $1',
            [sessionToken]
        );
        return result.rowCount > 0;
    } catch (error) {
        errorLog('AUTH_SHARED', 'Error deleting session', error);
        throw error;
    }
}

/**
 * Clean up expired sessions
 * @returns {Promise<number>} Number of cleaned up sessions
 */
async function cleanupExpiredSessions() {
    try {
        const result = await db.query(
            'DELETE FROM sessions WHERE expires_at <= NOW()'
        );
        return result.rowCount;
    } catch (error) {
        errorLog('AUTH_SHARED', 'Error cleaning up expired sessions', error);
        throw error;
    }
}

/**
 * Determine admin role based on username and ADMIN_USERNAME mapping
 * Supports multiple detection methods (OIDC groups, username mapping, email domain)
 *
 * @param {string} username - Username to check
 * @param {Object} oidcClaims - Optional OIDC claims for groups-based detection
 * @returns {string} Role to assign ('admin' or 'user')
 */
function determineAdminRole(username, oidcClaims = null) {
    const adminUsername = process.env.ADMIN_USERNAME;
    const normalizedUsername = username?.toLowerCase();
    const normalizedAdminUsername = adminUsername?.toLowerCase();

    debugLog('AUTH_SHARED', `determineAdminRole - Checking: "${normalizedUsername}" against "${normalizedAdminUsername}"`);

    // Method 1: OIDC Groups Claim (preferred)
    if (oidcClaims?.groups && Array.isArray(oidcClaims.groups)) {
        const adminGroups = process.env.ADMIN_OIDC_GROUPS?.split(',').map(g => g.trim().toLowerCase()) || ['admin'];
        const userGroups = oidcClaims.groups.map(g => g.toLowerCase());
        const hasAdminGroup = userGroups.some(g => adminGroups.includes(g));

        if (hasAdminGroup) {
            debugLog('AUTH_SHARED', 'determineAdminRole - MATCH via OIDC groups, assigning admin role');
            logAuthEvent('info', 'Admin role assigned via OIDC groups', {
                username,
                groups: oidcClaims.groups,
                adminGroups
            });
            return authConfig.roles.admin;
        }
    }

    // Method 2: Username Mapping (fallback)
    if (adminUsername && normalizedUsername === normalizedAdminUsername) {
        debugLog('AUTH_SHARED', 'determineAdminRole - MATCH via username, assigning admin role');
        logAuthEvent('info', 'Admin role assigned via username mapping', {
            username,
            adminUsername
        });
        return authConfig.roles.admin;
    }

    // Method 3: Email Domain (optional fallback)
    const adminDomains = process.env.ADMIN_EMAIL_DOMAINS?.split(',').map(d => d.trim().toLowerCase());
    if (adminDomains && adminDomains.length > 0) {
        const userEmail = oidcClaims?.email?.toLowerCase();
        if (userEmail) {
            const userDomain = userEmail.split('@')[1];
            if (adminDomains.includes(userDomain)) {
                debugLog('AUTH_SHARED', 'determineAdminRole - MATCH via email domain, assigning admin role');
                logAuthEvent('info', 'Admin role assigned via email domain', {
                    username,
                    email: userEmail,
                    domain: userDomain
                });
                return authConfig.roles.admin;
            }
        }
    }

    debugLog('AUTH_SHARED', 'determineAdminRole - NO MATCH, assigning user role');
    return authConfig.roles.user;
}

/**
 * Log role changes for debugging
 * @param {string} username - Username
 * @param {string} oldRole - Previous role
 * @param {string} newRole - New role
 * @param {string} reason - Reason for change
 */
function logUserRoleChange(username, oldRole, newRole, reason) {
    debugLog('AUTH_SHARED', `Role change for ${username}: ${oldRole} -> ${newRole} (${reason})`);
}

/**
 * Create or update OIDC user in database
 * @param {Object} userData - User data
 * @returns {Promise<Object>} User object
 */
async function createOrUpdateUser(userData) {
    const {
        username,
        email,
        oidcProvider,
        oidcSubject,
        oidcEmail,
        oidcClaims = null
    } = userData;

    try {
        // Determine role based on username or OIDC groups
        const role = determineAdminRole(username, oidcClaims);

        const query = `
            INSERT INTO users (username, email, role, oidc_provider, oidc_subject, oidc_email)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (oidc_subject)
            DO UPDATE SET
                username = EXCLUDED.username,
                email = EXCLUDED.email,
                oidc_email = EXCLUDED.oidc_email,
                role = EXCLUDED.role,
                updated_at = NOW()
            RETURNING *
        `;
        const params = [username, email, role, oidcProvider, oidcSubject, oidcEmail];

        debugLog('AUTH_SHARED', 'Creating/updating OIDC user', {
            username,
            email,
            role,
            oidcProvider,
            oidcSubject
        });

        const result = await db.query(query, params);
        const user = result.rows[0];

        // Debug logging for role changes
        if (userData.role && userData.role !== user.role) {
            logUserRoleChange(userData.username, userData.role, user.role, 'Role assignment updated');
        }

        // Log admin role assignment
        if (role === authConfig.roles.admin) {
            logAuthEvent('info', 'ADMIN_ROLE_ASSIGNED', {
                userId: user.id,
                username: user.username,
                role: user.role,
                detectionMethod: oidcClaims?.groups ? 'OIDC groups' : 'Username mapping'
            });
        }

        debugLog('AUTH_SHARED', `User ${user.username} (ID: ${user.id}) created/updated with role: ${user.role}`);
        return user;
    } catch (error) {
        errorLog('AUTH_SHARED', 'Error creating/updating user', error);
        throw error;
    }
}

/**
 * Check if user has admin role
 * @param {Object} user - User object
 * @returns {boolean} True if user is admin
 */
function isAdmin(user) {
    return user && user.role === authConfig.roles.admin;
}

/**
 * Log authentication event
 * @param {string} level - Log level (info, warn, error)
 * @param {string} message - Log message
 * @param {Object} metadata - Additional metadata
 */
function logAuthEvent(level, message, metadata = {}) {
    if (!authConfig.logging.enabled) return;

    const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        category: 'auth',
        message,
        ...metadata
    };

    debugLog('AUTH_SHARED', `${level.toUpperCase()}: ${message}`, metadata);
}

/**
 * Log admin audit event
 * @param {string} action - Action being performed (CREATE, UPDATE, DELETE, UPLOAD, etc.)
 * @param {string} resource - Resource being modified (config, cookies, prompt, etc.)
 * @param {Object} details - Details of the action
 * @param {Object} user - User performing the action
 * @param {Object} req - Express request object (for IP, user-agent)
 */
function logAuditEvent(action, resource, details = {}, user = null, req = null) {
    if (!authConfig.logging.enabled) return;

    const auditEntry = {
        timestamp: new Date().toISOString(),
        action,
        resource,
        details,
        user: user || {
            id: req?.user?.id,
            username: req?.user?.username,
            email: req?.user?.email,
            role: req?.user?.role
        },
        ip: req?.ip || req?.connection?.remoteAddress,
        userAgent: req?.get?.('User-Agent')
    };

    debugLog('AUDIT_LOG', `${action} ${resource}`, auditEntry);

    // TODO: Store in database once audit_log table is created
    // storeAuditEntry(auditEntry);
}

module.exports = {
    initialize,
    createOrUpdateUser,
    getUserById,
    getUserByOidcSubject,
    createSession,
    getSessionByToken,
    deleteSession,
    cleanupExpiredSessions,
    isAdmin,
    determineAdminRole,
    logAuthEvent,
    logAuditEvent
};
