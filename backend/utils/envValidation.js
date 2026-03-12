/**
 * Environment Variable Validation
 *
 * Validates required and optional environment variables on startup.
 * Provides clear error messages for missing or invalid configuration.
 *
 * OIDC-Only Authentication Mode:
 * - All authentication is handled via OIDC (no local JWT auth)
 * - PKCE, State Parameter, and Nonce are required security features
 */

const { debugLog, errorLog } = require('./debugUtils');

/**
 * Validation rules for environment variables
 */
const validationRules = {
    // Database Configuration (Required)
    DB_HOST: { required: true, type: 'string' },
    DB_PORT: { required: false, type: 'number', default: 5432 },
    DB_NAME: { required: true, type: 'string' },
    DB_USER: { required: true, type: 'string' },
    DB_PASSWORD: { required: true, type: 'string', sensitive: true },

    // Admin Configuration (Required for OIDC admin detection)
    ADMIN_USERNAME: {
        required: true,
        type: 'string',
        validator: (value) => {
            if (!value || value.trim().length === 0) {
                throw new Error('ADMIN_USERNAME is required for OIDC admin role assignment');
            }
            return value.trim();
        }
    },

    // CORS Configuration (Required in production)
    FRONTEND_URL: {
        required: false,
        type: 'string',
        validator: (value) => {
            if (!value) return null;
            if (process.env.NODE_ENV === 'production' && (!value || value === '*')) {
                throw new Error('FRONTEND_URL must be set in production mode');
            }
            return value;
        }
    },

    // OIDC Configuration (Required - OIDC-Only Mode)
    OIDC_ISSUER: {
        required: true,
        type: 'string',
        validator: (value) => {
            if (!value || value.trim().length === 0) {
                throw new Error('OIDC_ISSUER is required for OIDC-only authentication');
            }
            return value.trim();
        }
    },
    OIDC_CLIENT_ID: {
        required: true,
        type: 'string',
        validator: (value) => {
            if (!value || value.trim().length === 0) {
                throw new Error('OIDC_CLIENT_ID is required for OIDC-only authentication');
            }
            return value.trim();
        }
    },
    OIDC_CLIENT_SECRET: {
        required: true,
        type: 'string',
        sensitive: true,
        validator: (value) => {
            if (!value || value.trim().length === 0) {
                throw new Error('OIDC_CLIENT_SECRET is required for OIDC-only authentication');
            }
            return value.trim();
        }
    },
    OIDC_REDIRECT_URI: {
        required: true,
        type: 'string',
        validator: (value) => {
            if (!value || value.trim().length === 0) {
                throw new Error('OIDC_REDIRECT_URI is required for OIDC-only authentication');
            }
            return value.trim();
        }
    },
    OIDC_LOGOUT_REDIRECT_URI: { required: false, type: 'string' },

    // Session Configuration (Required for OIDC)
    SESSION_SECRET: {
        required: true,
        type: 'string',
        sensitive: true,
        validator: (value) => {
            if (!value || value.length < 32) {
                throw new Error('SESSION_SECRET must be at least 32 characters long');
            }
            if (value === 'your-session-secret-here' || value === 'fallback_session_secret') {
                throw new Error('SESSION_SECRET is using a default value. Generate a secure random string.');
            }
            return value;
        }
    },

    // OIDC Security Features (Required - Production Hardening)
    OIDC_PKCE_ENABLED: {
        required: false,
        type: 'boolean',
        default: 'true',
        validator: (value) => {
            if (process.env.NODE_ENV === 'production' && value !== true) {
                throw new Error('OIDC_PKCE_ENABLED must be true in production (required for security)');
            }
            return value;
        }
    },
    OIDC_STATE_ENABLED: {
        required: false,
        type: 'boolean',
        default: 'true',
        validator: (value) => {
            if (process.env.NODE_ENV === 'production' && value !== true) {
                throw new Error('OIDC_STATE_ENABLED must be true in production (required for CSRF protection)');
            }
            return value;
        }
    },
    OIDC_NONCE_ENABLED: {
        required: false,
        type: 'boolean',
        default: 'true',
        validator: (value) => {
            if (process.env.NODE_ENV === 'production' && value !== true) {
                throw new Error('OIDC_NONCE_ENABLED must be true in production (required for replay attack prevention)');
            }
            return value;
        }
    },
    
    // OpenAI/AI Configuration (Optional but recommended)
    OPENAI_API_KEY: { required: false, type: 'string', sensitive: true },
    OPENAI_MODEL: { required: false, type: 'string', default: 'gpt-4o-mini' },
    OPENAI_API_URL: { required: false, type: 'string' },
    
    // Application Configuration
    NODE_ENV: { required: false, type: 'string', default: 'development' },
    PORT: { required: false, type: 'number', default: 5000 },
    APP_MODE: { required: false, type: 'string', default: 'WEB' },
    DEBUG_MODE: { required: false, type: 'boolean', default: 'false' },
};

/**
 * Convert string value to appropriate type
 */
function parseValue(value, type) {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    
    switch (type) {
        case 'number':
            const num = parseInt(value, 10);
            return isNaN(num) ? null : num;
        case 'boolean':
            return value.toLowerCase() === 'true';
        default:
            return value;
    }
}

/**
 * Validate a single environment variable
 */
function validateVariable(name, rule) {
    const value = process.env[name];
    const parsedValue = parseValue(value, rule.type);
    
    // Check if required but missing
    if (rule.required && !parsedValue) {
        throw new Error(`Required environment variable ${name} is not set`);
    }
    
    // Use default if not set
    if (!parsedValue && rule.default !== undefined) {
        return typeof rule.default === 'function' ? rule.default() : rule.default;
    }
    
    // Run custom validator
    if (rule.validator && parsedValue !== null) {
        return rule.validator(parsedValue);
    }
    
    return parsedValue;
}

/**
 * Validate all environment variables
 * @returns {Object} Validation result with errors and warnings
 */
function validateEnvironment() {
    const errors = [];
    const warnings = [];
    const config = {};
    
    debugLog('ENV_VALIDATION', 'Starting environment variable validation...');
    
    for (const [name, rule] of Object.entries(validationRules)) {
        try {
            const value = validateVariable(name, rule);
            if (value !== null) {
                config[name] = value;
            }
            
            // Log warnings for unset optional variables
            if (!value && rule.required && !process.env[name]) {
                errors.push(`${name} is required but not set`);
            }
        } catch (error) {
            const errorMsg = error.message;
            if (rule.sensitive) {
                errors.push(`${name}: Security concern (check configuration)`);
            } else {
                errors.push(`${name}: ${errorMsg}`);
            }
        }
    }
    
    // Check for dangerous default values in production
    if (process.env.NODE_ENV === 'production') {
        if (process.env.SESSION_SECRET === 'your-session-secret-here' ||
            process.env.SESSION_SECRET === 'fallback_session_secret') {
            errors.push('SESSION_SECRET is using default value. Generate a secure secret!');
        }
        if (!process.env.OIDC_ISSUER || !process.env.OIDC_CLIENT_ID ||
            !process.env.OIDC_CLIENT_SECRET || !process.env.OIDC_REDIRECT_URI) {
            errors.push('OIDC configuration is incomplete. All OIDC_* variables are required in production.');
        }
        if (process.env.OIDC_PKCE_ENABLED !== 'true' &&
            process.env.OIDC_PKCE_ENABLED !== 'TRUE' &&
            process.env.OIDC_PKCE_ENABLED !== true) {
            errors.push('OIDC_PKCE_ENABLED must be true in production for security.');
        }
        if (process.env.OIDC_STATE_ENABLED !== 'true' &&
            process.env.OIDC_STATE_ENABLED !== 'TRUE' &&
            process.env.OIDC_STATE_ENABLED !== true) {
            errors.push('OIDC_STATE_ENABLED must be true in production for CSRF protection.');
        }
        if (process.env.OIDC_NONCE_ENABLED !== 'true' &&
            process.env.OIDC_NONCE_ENABLED !== 'TRUE' &&
            process.env.OIDC_NONCE_ENABLED !== true) {
            errors.push('OIDC_NONCE_ENABLED must be true in production for replay attack prevention.');
        }
    }
    
    // Check for wildcard CORS in production
    if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
        warnings.push('FRONTEND_URL not set in production. CORS will block all requests.');
    }
    
    // Log results
    if (errors.length > 0) {
        errorLog('ENV_VALIDATION', `Environment validation failed with ${errors.length} errors:`, errors);
    } else {
        debugLog('ENV_VALIDATION', 'Environment validation passed');
    }
    
    if (warnings.length > 0) {
        warnings.forEach(warning => debugLog('ENV_VALIDATION', `Warning: ${warning}`));
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        config
    };
}

/**
 * Validate environment and exit if critical errors found
 */
function validateOrExit() {
    const result = validateEnvironment();
    
    if (!result.valid) {
        console.error('\n============================================');
        console.error('ENVIRONMENT VALIDATION FAILED');
        console.error('============================================\n');
        console.error('Please fix the following errors:\n');
        result.errors.forEach((error, i) => {
            console.error(`  ${i + 1}. ${error}`);
        });
        console.error('\nRefer to .env.example for required variables.\n');
        console.error('============================================\n');
        
        if (process.env.NODE_ENV === 'production') {
            // Don't exit in development, allow for testing
            process.exit(1);
        }
    } else {
        debugLog('ENV_VALIDATION', '✓ All environment variables are valid');
    }
    
    return result;
}

module.exports = {
    validateEnvironment,
    validateOrExit,
    validationRules
};
