const express = require('express');
const authenticateApiRequest = require('../middleware/apiAuthMiddleware');
const { debugLog, errorLog } = require('../utils/debugUtils');
const { getCurrentUsername } = require('../utils/userUtils');
const asyncHandler = require('../middleware/asyncHandler');

module.exports = function(pool) {
  const router = express.Router();

  // Test endpoint for user detection - requires authentication
  router.get('/username', authenticateApiRequest, asyncHandler(async (req, res) => {
    debugLog('USER_DETECTION_TEST', '=== TEST USER DETECTION ENDPOINT ===');

    const username = getCurrentUsername(req);

    debugLog('USER_DETECTION_TEST', 'Detected username', { username });
    debugLog('USER_DETECTION_TEST', 'Full request analysis');
    debugLog('USER_DETECTION_TEST', 'req.isAuthenticated()', { isAuthenticated: req.isAuthenticated() });
    debugLog('USER_DETECTION_TEST', 'req.user exists', { userExists: !!req.user });
    debugLog('USER_DETECTION_TEST', 'req.session exists', { sessionExists: !!req.session });
    debugLog('USER_DETECTION_TEST', 'SSO_OIDC', { ssoOidc: process.env.SSO_OIDC });

    if (req.user) {
      debugLog('USER_DETECTION_TEST', 'req.user keys', { keys: Object.keys(req.user) });
      debugLog('USER_DETECTION_TEST', 'req.user.username', { username: req.user.username });
      debugLog('USER_DETECTION_TEST', 'req.user.email', { email: req.user.email });
    }

    if (req.session) {
      debugLog('USER_DETECTION_TEST', 'req.session keys', { keys: Object.keys(req.session) });
      debugLog('USER_DETECTION_TEST', 'req.session.passport', { hasPassport: !!req.session.passport });
      if (req.session.passport?.user) {
        debugLog('USER_DETECTION_TEST', 'session.passport.user keys', { keys: Object.keys(req.session.passport.user) });
        debugLog('USER_DETECTION_TEST', 'session.passport.user.username', { username: req.session.passport.user.username });
      }
    }

    debugLog('USER_DETECTION_TEST', '=== TEST USER DETECTION ENDPOINT END ===');

    res.json({
      success: true,
      username: username,
      authMode: process.env.SSO_OIDC === 'true' ? 'OIDC' : 'Local',
      isAuthenticated: req.isAuthenticated(),
      hasUser: !!req.user,
      hasSession: !!req.session,
      debug: {
        userKeys: req.user ? Object.keys(req.user) : null,
        sessionKeys: req.session ? Object.keys(req.session) : null,
        passportUser: req.session?.passport?.user || null
      }
    });
  }));

  // Test endpoint without authentication - for comparison
  router.get('/username-no-auth', (req, res) => {
    try {
      debugLog('USER_DETECTION_NO_AUTH', '=== TEST USER DETECTION (NO AUTH) ===');
      
      const username = getCurrentUsername(req);
      
      debugLog('USER_DETECTION_NO_AUTH', 'Detected username (no auth)', { username });
      debugLog('USER_DETECTION_NO_AUTH', '=== TEST USER DETECTION (NO AUTH) END ===');
      
      res.json({
        success: true,
        username: username,
        authMode: process.env.SSO_OIDC === 'true' ? 'OIDC' : 'Local',
        isAuthenticated: req.isAuthenticated(),
        hasUser: !!req.user,
        hasSession: !!req.session
      });
    } catch (error) {
      errorLog('USER_DETECTION_NO_AUTH', 'Error in user detection test (no auth)', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
};
