const express = require('express');
const router = express.Router();
const pool = require('../config/db.js');
const { getCurrentUsername } = require('../utils/userUtils');
const authenticateApiRequest = require('../middleware/apiAuthMiddleware');
const { debugLog, errorLog } = require('../utils/debugUtils');
const asyncHandler = require('../middleware/asyncHandler');
const { logAuditEvent } = require('../auth/shared');

// POST /api/grabCustom - Endpoint to receive custom content
router.post('/', authenticateApiRequest, asyncHandler(async (req, res) => {
    const { title, type = 'custom', source, content } = req.body;

    // Validate required fields
    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required.' });
    }

    // Validate type field
    const validTypes = ['custom', 'url'];
    if (type && !validTypes.includes(type)) {
        return res.status(400).json({
            error: `Invalid type value. Must be one of: ${validTypes.join(', ')}`,
            received: type
        });
    }

    debugLog('GRABCUSTOM', 'IMPORT DEBUG START');
    debugLog('GRABCUSTOM', 'Request URL', req.url);
    debugLog('GRABCUSTOM', 'Request method', req.method);
    debugLog('GRABCUSTOM', 'Request headers', JSON.stringify(req.headers, null, 2));
    debugLog('GRABCUSTOM', 'req.isAuthenticated()', req.isAuthenticated());
    debugLog('GRABCUSTOM', 'SSO_OIDC', process.env.SSO_OIDC);

    // Get current username
    const username = getCurrentUsername(req);
    debugLog('GRABCUSTOM', `Importing custom content with user: ${username}`);
    debugLog('GRABCUSTOM', `Auth mode: ${process.env.SSO_OIDC === 'true' ? 'OIDC' : 'Local'}`);
    debugLog('GRABCUSTOM', 'User object available', !!req.user);
    debugLog('GRABCUSTOM', 'Session available', !!req.session);

    if (req.user) {
        debugLog('GRABCUSTOM', 'req.user keys', Object.keys(req.user));
        debugLog('GRABCUSTOM', 'req.user.username', req.user.username);
        debugLog('GRABCUSTOM', 'req.user.email', req.user.email);
    }

    if (req.session) {
        debugLog('GRABCUSTOM', 'req.session keys', Object.keys(req.session));
        debugLog('GRABCUSTOM', 'req.session.passport', !!req.session.passport);
        if (req.session.passport?.user) {
            debugLog('GRABCUSTOM', 'session.passport.user keys', Object.keys(req.session.passport.user));
            debugLog('GRABCUSTOM', 'session.passport.user.username', req.session.passport.user.username);
        }
    }

    debugLog('GRABCUSTOM', 'IMPORT DEBUG END');

    const query = `
        INSERT INTO import_custom (title, source, content, type, status, addedBy)
        VALUES ($1, $2, $3, $4, 'NEW', $5)
        RETURNING id;
    `;
    const values = [title, source || null, content, type, username];

    // Log the request for debugging
    debugLog('GRABCUSTOM', 'Attempting to insert with values', {
        title: title.substring(0, 50) + '...',
        source: source,
        type: type,
        contentLength: content.length,
        addedBy: username
    });

    const result = await pool.query(query, values);

    // Audit log custom content submission
    logAuditEvent('CREATE', 'grab:custom', {
      importId: result.rows[0].id,
      title,
      type,
      contentLength: content.length
    }, req.user, req);

    res.status(201).json({ message: 'Custom content submitted successfully for summarization.', id: result.rows[0].id });
}));

module.exports = router;
