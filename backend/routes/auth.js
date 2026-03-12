
// backend/routes/auth.js
/**
 * Authentication routes - OIDC-Only Mode
 * All authentication routes use OIDC SSO with session management
 */

const express = require('express');
const { authConfig } = require('../config/auth');
const { oidcAuth } = require('../auth');
const { debugLog, errorLog } = require('../utils/debugUtils');
const asyncHandler = require('../middleware/asyncHandler');
const { getCsrfToken } = require('../middleware/csrf');

module.exports = function () {
    const router = express.Router();

    // Get authentication configuration for frontend
    router.get('/config', (req, res) => {
        res.json({
            authMethod: 'oidc',
            appMode: authConfig.appMode,
            oidcIssuer: authConfig.oidc.issuer
        });
    });

    // Get CSRF token (required for OIDC session-based authentication)
    router.get('/csrf-token', (req, res) => {
        const token = getCsrfToken(req);
        res.json({
            csrfToken: token,
            authMethod: 'oidc'
        });
    });

    // OIDC authentication routes
    const oidcRouter = oidcAuth.createRouter();
    router.use('/oidc', oidcRouter);

    // Redirect /login to OIDC login
    router.get('/login', (req, res) => {
        res.redirect('/api/auth/oidc/login');
    });

    // Logout endpoint
    router.post('/logout', asyncHandler(async (req, res) => {
        if (req.isAuthenticated()) {
            const sharedAuth = require('../auth/shared');

            sharedAuth.logAuthEvent('info', 'OIDC logout', {
                userId: req.user.id,
                username: req.user.username,
                authMethod: 'oidc'
            });

            const logoutUrl = authConfig.oidc.logoutRedirectUri;

            req.logout((err) => {
                if (err) {
                    errorLog('AUTH_ROUTE', 'Logout error', err);
                }
                req.session.destroy(() => {
                    res.json({
                        message: 'Logged out successfully',
                        logoutUrl,
                        authMethod: 'oidc'
                    });
                });
            });
        } else {
            res.json({
                message: 'Not logged in',
                authMethod: 'oidc'
            });
        }
    }));

    // Verify authentication endpoint
    router.get('/verify', (req, res) => {
        debugLog('AUTH_ROUTE', 'Verify called - req.isAuthenticated()', req.isAuthenticated());
        debugLog('AUTH_ROUTE', 'Verify called - req.user', req.user);

        if (req.isAuthenticated()) {
            const sharedAuth = require('../auth/shared');
            const isAdminResult = sharedAuth.isAdmin(req.user);
            const adminCheck = {
                userRole: req.user.role,
                isAdminCheck: isAdminResult,
                user: req.user
            };

            debugLog('AUTH_ROUTE', 'Verify - Admin check result', adminCheck);

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
                    adminCheck,
                    authMethod: 'oidc'
                },
                authMethod: 'oidc'
            });
        } else {
            debugLog('AUTH_ROUTE', 'Verify - Not authenticated');
            res.status(401).json({
                valid: false,
                error: 'Not authenticated',
                authMethod: 'oidc'
            });
        }
    });

    return router;
};
