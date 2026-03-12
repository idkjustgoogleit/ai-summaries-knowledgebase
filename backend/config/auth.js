// backend/config/auth.js
/**
 * Authentication configuration - OIDC-Only Mode
 * Centralizes all authentication-related configuration and environment variables
 *
 * SIMPLIFIED: Local JWT authentication removed, OIDC-only mode enforced
 */

const pgSession = require('connect-pg-simple')(require('express-session'));

const authConfig = {
    // Application mode
    appMode: process.env.APP_MODE || 'WEB',

    // OIDC-only mode (always true after conversion from dual-mode)
    ssoOidc: true,

    // Admin role detection (for OIDC username mapping)
    adminUsername: process.env.ADMIN_USERNAME,

    // OIDC configuration (REQUIRED for WEB mode)
    oidc: {
        issuer: process.env.OIDC_ISSUER,
        clientId: process.env.OIDC_CLIENT_ID,
        clientSecret: process.env.OIDC_CLIENT_SECRET,
        redirectUri: process.env.OIDC_REDIRECT_URI,
        logoutRedirectUri: process.env.OIDC_LOGOUT_REDIRECT_URI,
        scope: 'openid profile email'
    },

    // OIDC Security Enhancements
    oidcSecurity: {
        pkceEnabled: process.env.OIDC_PKCE_ENABLED !== 'false', // Default: true
        stateEnabled: process.env.OIDC_STATE_ENABLED !== 'false', // Default: true
        nonceEnabled: process.env.OIDC_NONCE_ENABLED !== 'false', // Default: true
        stateExpiryMs: 10 * 60 * 1000 // 10 minutes
    },

    // Session configuration
    session: {
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        }
    },

    // Role configuration
    roles: {
        admin: 'admin',
        user: 'user'
    },

    // Logging configuration
    logging: {
        enabled: true,
        level: process.env.LOG_LEVEL || 'info'
    }
};

/**
 * Validate authentication configuration
 * @returns {boolean} True if configuration is valid
 */
function validateConfig() {
    const errors = [];

    // Skip validation for worker mode
    if (authConfig.appMode === 'WORKER') {
        const { debugLog } = require('../utils/debugUtils');
        debugLog('AUTH_CONFIG', 'Worker mode: authentication configuration skipped');
        return true;
    }

    // Validate OIDC configuration (now required)
    if (!authConfig.oidc.issuer) {
        errors.push('OIDC_ISSUER is required');
    }
    if (!authConfig.oidc.clientId) {
        errors.push('OIDC_CLIENT_ID is required');
    }
    if (!authConfig.oidc.clientSecret) {
        errors.push('OIDC_CLIENT_SECRET is required');
    }
    if (!authConfig.oidc.redirectUri) {
        errors.push('OIDC_REDIRECT_URI is required');
    }

    // Validate session secret
    if (!authConfig.session.secret) {
        errors.push('SESSION_SECRET environment variable is required');
    }

    // Warn if admin username not set (optional, but recommended)
    if (!authConfig.adminUsername) {
        const { debugLog } = require('../utils/debugUtils');
        debugLog('AUTH_CONFIG', 'Warning: ADMIN_USERNAME not set - admin role detection will rely on OIDC groups only');
    }

    if (errors.length > 0) {
        const { errorLog } = require('../utils/debugUtils');
        errorLog('AUTH_CONFIG', 'Configuration validation failed');
        errors.forEach(error => errorLog('AUTH_CONFIG', `- ${error}`));
        return false;
    }

    return true;
}

/**
 * Get authentication mode for logging
 * @returns {string} Authentication mode description
 */
function getAuthMode() {
    if (authConfig.appMode === 'WORKER') {
        return 'WORKER (no authentication)';
    }
    return 'OIDC (SSO)';
}

// Validate configuration on module load
if (!validateConfig()) {
    throw new Error('Authentication configuration validation failed');
}

const { debugLog } = require('../utils/debugUtils');
debugLog('AUTH_CONFIG', `Configuration loaded successfully - Mode: ${getAuthMode()}`);

/**
 * Create session configuration with Postgres store
 * This must be called after the database pool is available
 * @param {object} pool - PostgreSQL connection pool
 * @returns {object} Session configuration for express-session
 */
function createSessionConfig(pool) {
    return {
        secret: authConfig.session.secret,
        resave: authConfig.session.resave,
        saveUninitialized: authConfig.session.saveUninitialized,
        store: new pgSession({
            pool: pool,
            tableName: 'connect_pg_sessions'  // Separate from 'sessions' table (OIDC security params)
        }),
        cookie: authConfig.session.cookie
    };
}

module.exports = {
    authConfig,
    validateConfig,
    getAuthMode,
    createSessionConfig
};
