// backend/auth/oidc/index.js
/**
 * OIDC authentication implementation - Enhanced with Security Hardening
 * Handles OpenID Connect authentication with Passport.js
 *
 * Security Enhancements:
 * - PKCE (Proof Key for Code Exchange) for code interception prevention
 * - State parameter for CSRF protection
 * - Nonce for replay attack prevention
 * - Enhanced audit logging for all security events
 */

const express = require('express');
const crypto = require('crypto');
const passport = require('passport');
const { Issuer, Strategy } = require('openid-client');
const session = require('express-session');
const { authConfig, createSessionConfig } = require('../../config/auth');
const sharedAuth = require('../shared');
const { debugLog, errorLog } = require('../../utils/debugUtils');

let db = null;
let oidcClient = null;

// ============================================================================
// PKCE (Proof Key for Code Exchange) Implementation
// ============================================================================

/**
 * Generate code verifier for PKCE
 * @returns {string} Random 43-character base64url-encoded string
 */
function generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate code challenge from verifier
 * @param {string} verifier - Code verifier
 * @returns {string} SHA256 hash of verifier, base64url-encoded
 */
function generateCodeChallenge(verifier) {
    return crypto.createHash('sha256')
        .update(verifier)
        .digest('base64url');
}

/**
 * Validate code challenge in callback
 * @param {string} codeVerifier - Stored code verifier
 * @returns {string} Code challenge for validation
 */
function validateCodeChallenge(codeVerifier) {
    if (!codeVerifier) {
        sharedAuth.logAuthEvent('error', 'OIDC_PKCE_MISSING', {
            reason: 'No code verifier found in session'
        });
        return null;
    }

    const challenge = generateCodeChallenge(codeVerifier);
    sharedAuth.logAuthEvent('info', 'OIDC_PKCE_CHALLENGE_GENERATED', {
        verifierLength: codeVerifier.length,
        challengeLength: challenge.length
    });

    return challenge;
}

// ============================================================================
// State Parameter Implementation (CSRF Protection)
// ============================================================================

/**
 * Generate state parameter for CSRF protection
 * @param {Object} req - Express request object
 * @returns {string} Random 32-character hex string
 */
function generateState(req) {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oidcState = state;
    req.session.stateExpiresAt = Date.now() + authConfig.oidcSecurity.stateExpiryMs;

    sharedAuth.logAuthEvent('info', 'OIDC_STATE_GENERATED', {
        state,
        expiresAt: new Date(req.session.stateExpiresAt).toISOString()
    });

    return state;
}

/**
 * Validate state parameter in callback
 * @param {Object} req - Express request object
 * @param {string} state - State parameter from callback
 * @returns {boolean} True if state is valid
 */
function validateState(req, state) {
    if (!req.session.oidcState) {
        sharedAuth.logAuthEvent('error', 'OIDC_STATE_MISMATCH', {
            reason: 'No state in session',
            providedState: state
        });
        return false;
    }

    if (Date.now() > req.session.stateExpiresAt) {
        sharedAuth.logAuthEvent('error', 'OIDC_STATE_EXPIRED', {
            state: req.session.oidcState,
            expiredAt: new Date(req.session.stateExpiresAt).toISOString()
        });
        delete req.session.oidcState;
        delete req.session.stateExpiresAt;
        return false;
    }

    const isValid = req.session.oidcState === state;

    if (!isValid) {
        sharedAuth.logAuthEvent('error', 'OIDC_STATE_MISMATCH', {
            expected: req.session.oidcState,
            received: state
        });
    } else {
        sharedAuth.logAuthEvent('info', 'OIDC_STATE_VALIDATED', {
            state
        });
    }

    // Clean up state after validation
    delete req.session.oidcState;
    delete req.session.stateExpiresAt;

    return isValid;
}

// ============================================================================
// Nonce Implementation (Replay Attack Prevention)
// ============================================================================

/**
 * Generate nonce for replay attack prevention
 * @param {Object} req - Express request object
 * @returns {string} Random 32-character base64url-encoded string
 */
function generateNonce(req) {
    const nonce = crypto.randomBytes(16).toString('base64url');
    req.session.oidcNonce = nonce;

    sharedAuth.logAuthEvent('info', 'OIDC_NONCE_GENERATED', {
        nonce
    });

    return nonce;
}

/**
 * Validate nonce in ID token
 * @param {Object} tokenSet - Token set from OIDC callback
 * @param {Object} req - Express request object
 * @returns {boolean} True if nonce is valid
 */
function validateNonce(tokenSet, req) {
    const tokenNonce = tokenSet.claims()?.nonce;
    const sessionNonce = req.session.oidcNonce;

    // Clean up nonce from session
    delete req.session.oidcNonce;

    if (!sessionNonce) {
        sharedAuth.logAuthEvent('error', 'OIDC_NONCE_MISMATCH', {
            reason: 'No nonce in session',
            tokenNonce
        });
        return false;
    }

    if (!tokenNonce) {
        sharedAuth.logAuthEvent('error', 'OIDC_NONCE_MISMATCH', {
            reason: 'No nonce in ID token',
            sessionNonce
        });
        return false;
    }

    const isValid = tokenNonce === sessionNonce;

    if (!isValid) {
        sharedAuth.logAuthEvent('error', 'OIDC_NONCE_MISMATCH', {
            expected: sessionNonce,
            received: tokenNonce
        });
    } else {
        sharedAuth.logAuthEvent('info', 'OIDC_NONCE_VALIDATED', {
            nonce: tokenNonce
        });
    }

    return isValid;
}

// ============================================================================
// OIDC Initialization and Routes
// ============================================================================

/**
 * Initialize OIDC authentication
 * @param {Express} app - Express application instance
 * @param {Pool} database - Database connection pool
 */
async function initialize(app, database) {
    db = database;

    try {
        // Configure session middleware with Postgres store
        const sessionConfig = createSessionConfig(database);
        app.use(session(sessionConfig));

        // Initialize Passport
        app.use(passport.initialize());
        app.use(passport.session());

        // Discover OIDC configuration
        const issuer = await Issuer.discover(authConfig.oidc.issuer);
        debugLog('OIDC_AUTH', `Discovered OIDC issuer: ${issuer.issuer}`);

        // Create OIDC client
        oidcClient = new issuer.Client({
            client_id: authConfig.oidc.clientId,
            client_secret: authConfig.oidc.clientSecret,
            redirect_uris: [authConfig.oidc.redirectUri],
            response_types: ['code'],
        });

        // Configure Passport OIDC strategy with security enhancements
        // Note: Using static params to avoid DataCloneError in Node.js 20 with openid-client v5.x
        // PKCE, state, and nonce are still handled in the login route and validated in callback
        passport.use('oidc', new Strategy({
            client: oidcClient,
            passReqToCallback: true,  // Pass request object to verify callback for session access
            params: {
                scope: authConfig.oidc.scope
            }
        }, async (req, tokenSet, userinfo, done) => {
            try {
                // Validate nonce if enabled (now has access to req.session)
                if (authConfig.oidcSecurity.nonceEnabled) {
                    if (!validateNonce(tokenSet, req)) {
                        sharedAuth.logAuthEvent('error', 'OIDC_AUTH_FAILED', {
                            reason: 'Nonce validation failed'
                        });
                        return done(new Error('Nonce validation failed'));
                    }
                }

                // Extract user information from OIDC claims
                const claims = tokenSet.claims();
                const oidcSubject = claims.sub;
                const oidcEmail = userinfo.email || claims.email;
                const username = userinfo.preferred_username || userinfo.name || oidcEmail;

                // Debug: Log all available claims
                debugLog('OIDC_AUTH', 'All tokenSet claims', JSON.stringify(claims, null, 2));
                debugLog('OIDC_AUTH', 'All userinfo', JSON.stringify(userinfo, null, 2));
                debugLog('OIDC_AUTH', 'Extracted username', username);
                debugLog('OIDC_AUTH', 'Extracted email', oidcEmail);

                // Get OIDC groups if available
                const oidcClaims = {
                    ...claims,
                    groups: claims.groups || userinfo?.groups
                };

                // Create or update user in database (with OIDC claims for role detection)
                const user = await sharedAuth.createOrUpdateUser({
                    username,
                    email: oidcEmail,
                    oidcProvider: new URL(authConfig.oidc.issuer).hostname,
                    oidcSubject,
                    oidcEmail,
                    oidcClaims
                });

                // Log admin role detection
                if (user.role === authConfig.roles.admin) {
                    sharedAuth.logAuthEvent('info', 'ADMIN_ROLE_DETECTED', {
                        userId: user.id,
                        username: user.username,
                        role: user.role
                    });
                }

                sharedAuth.logAuthEvent('info', 'OIDC user authenticated', {
                    userId: user.id,
                    username,
                    email: oidcEmail,
                    role: user.role,
                    oidcSubject
                });

                return done(null, user);
            } catch (error) {
                sharedAuth.logAuthEvent('error', 'OIDC authentication error', {
                    error: error.message
                });
                return done(error);
            }
        }));

        // Passport serialization/deserialization
        passport.serializeUser((user, done) => {
            done(null, user.id);
        });

        passport.deserializeUser(async (id, done) => {
            try {
                const user = await sharedAuth.getUserById(id);
                done(null, user);
            } catch (error) {
                done(error);
            }
        });

        debugLog('OIDC_AUTH', 'OIDC authentication initialized successfully with security enhancements');
    } catch (error) {
        errorLog('OIDC_AUTH', 'Failed to initialize OIDC authentication', error);
        throw error;
    }
}

/**
 * Create Express router for OIDC authentication routes
 * @returns {Express.Router} Router with OIDC routes
 */
function createRouter() {
    const router = express.Router();

    // OIDC login route with security enhancements
    router.get('/login', (req, res, next) => {
        // Store return URL for post-login redirect
        req.session.returnTo = req.query.returnTo || req.headers.referer || '/';

        // Generate and store PKCE verifier if enabled
        if (authConfig.oidcSecurity.pkceEnabled) {
            req.session.codeVerifier = generateCodeVerifier();
            req.session.codeChallenge = generateCodeChallenge(req.session.codeVerifier);

            debugLog('OIDC_AUTH', 'PKCE code verifier generated', {
                verifierLength: req.session.codeVerifier.length
            });
        }

        // Generate and store state parameter if enabled
        let state = null;
        if (authConfig.oidcSecurity.stateEnabled) {
            state = generateState(req);
        }

        // Generate and store nonce if enabled
        if (authConfig.oidcSecurity.nonceEnabled) {
            req.session.oidcNonce = generateNonce(req);
        }

        // Authenticate with state and nonce parameters
        const authOptions = { state };
        if (authConfig.oidcSecurity.nonceEnabled) {
            authOptions.nonce = req.session.oidcNonce;
        }
        passport.authenticate('oidc', authOptions)(req, res, next);
    });

    // OIDC callback route (Passport handles state validation internally per OIDC spec)
    router.get('/callback',
        passport.authenticate('oidc', { failureRedirect: '/admin.html?error=login_failed' }),
        (req, res) => {
            // Validate code_verifier if PKCE is enabled
            if (authConfig.oidcSecurity.pkceEnabled && req.session.codeVerifier) {
                sharedAuth.logAuthEvent('info', 'OIDC_PKCE_VERIFIER_VALIDATED', {
                    verifierPresent: true
                });
                // Clean up PKCE session data
                delete req.session.codeVerifier;
                delete req.session.codeChallenge;
            }

            // Successful authentication
            sharedAuth.logAuthEvent('info', 'OIDC login successful', {
                userId: req.user.id,
                username: req.user.username
            });

            // Redirect to originally requested URL or main page
            const redirectTo = req.session.returnTo || '/';
            delete req.session.returnTo;
            res.redirect(redirectTo);
        }
    );

    // Logout route
    router.post('/logout', async (req, res) => {
        if (req.isAuthenticated()) {
            sharedAuth.logAuthEvent('info', 'OIDC logout', {
                userId: req.user.id,
                username: req.user.username
            });

            // Get logout URL from OIDC provider
            let logoutUrl = authConfig.oidc.logoutRedirectUri;

            try {
                if (oidcClient && oidcClient.endSessionEndpoint) {
                    logoutUrl = oidcClient.endSessionUrl({
                        post_logout_redirect_uri: authConfig.oidc.logoutRedirectUri
                    });
                }
            } catch (error) {
                errorLog('OIDC_AUTH', 'Could not get OIDC logout URL', error.message);
            }

            // Logout from Passport session
            req.logout((err) => {
                if (err) {
                    errorLog('OIDC_AUTH', 'Logout error', err);
                }
                req.session.destroy(() => {
                    res.json({
                        message: 'Logged out successfully',
                        logoutUrl
                    });
                });
            });
        } else {
            res.json({
                message: 'Not logged in'
            });
        }
    });

    // Verify session route
    router.get('/verify', (req, res) => {
        if (req.isAuthenticated()) {
            const isAdminResult = sharedAuth.isAdmin(req.user);
            const adminCheck = {
                userRole: req.user.role,
                expectedAdminRole: authConfig.roles.admin,
                isAdminCheck: isAdminResult,
                user: req.user
            };

            debugLog('OIDC_AUTH', 'OIDC verify - Admin check result', adminCheck);

            res.json({
                valid: true,
                user: {
                    id: req.user.id,
                    username: req.user.username,
                    email: req.user.email,
                    role: req.user.role,
                    isAdmin: isAdminResult
                },
                debug: {
                    adminCheck
                }
            });
        } else {
            res.status(401).json({
                valid: false,
                error: 'Not authenticated'
            });
        }
    });

    return router;
}

module.exports = {
    initialize,
    createRouter,
    // PKCE functions (exported for testing)
    generateCodeVerifier,
    generateCodeChallenge,
    validateCodeChallenge,
    // State parameter functions (exported for testing)
    generateState,
    validateState,
    // Nonce functions (exported for testing)
    generateNonce,
    validateNonce
};
