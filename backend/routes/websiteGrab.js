// backend/routes/websiteGrab.js

const express = require('express');
const { Pool } = require('pg');
const { getCurrentUsername } = require('../utils/userUtils');
const authenticateApiRequest = require('../middleware/apiAuthMiddleware');
const { debugLog, errorLog } = require('../utils/debugUtils');
const asyncHandler = require('../middleware/asyncHandler');
const { logAuditEvent } = require('../auth/shared');

module.exports = function (pool) {
    const router = express.Router();

    // POST / - Submit URL for summarization (this will be /api/grab-website/)
    router.post('/', authenticateApiRequest, asyncHandler(async (req, res) => {
        const { url } = req.body;
        debugLog('WEBSITE_GRAB', `Received request to grab URL: ${url}`);

        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'Valid URL is required.' });
        }

        // Optional: Validate URL format
        try {
            new URL(url); // Will throw if invalid
        } catch (err) {
            return res.status(400).json({ error: 'Provided string is not a valid URL.' });
        }

        // Get current username
        const username = getCurrentUsername(req);
        debugLog('WEBSITE_GRAB', `Importing website with user: ${username}`);
        debugLog('WEBSITE_GRAB', `Auth mode: ${process.env.SSO_OIDC === 'true' ? 'OIDC' : 'Local'}`);
        debugLog('WEBSITE_GRAB', 'User object available', !!req.user);
        debugLog('WEBSITE_GRAB', 'Session available', !!req.session);

        // Check if URL already exists in the queue/summarized
        const existingCheck = await pool.query(
            'SELECT id, status FROM public.summaries_websites WHERE url = $1',
            [url]
        );
        if (existingCheck.rows.length > 0) {
            const existingRecord = existingCheck.rows[0];
            debugLog('WEBSITE_GRAB', `URL already exists. ID: ${existingRecord.id}, Status: ${existingRecord.status}`);
            return res.status(200).json({
                message: 'Website already submitted for processing.',
                id: existingRecord.id,
                status: existingRecord.status
            });
        }

        // Extract main_url (domain + port)
        let main_url = '';
        try {
            const parsed = new URL(url);
            main_url = `${parsed.protocol}//${parsed.host}`;
        } catch (e) {
             main_url = url; // Fallback, should be rare after validation
             errorLog('WEBSITE_GRAB', 'Error extracting main_url, using full URL', e);
        }

        // Insert NEW record with status 'NEW' for the worker to pick up
        const result = await pool.query(
            `INSERT INTO public.summaries_websites (url, main_url, status, addedBy)
             VALUES ($1, $2, 'NEW', $3)
             RETURNING id`,
            [url, main_url, username]
        );

        const newId = result.rows[0].id;
        logAuditEvent('CREATE', 'website_grab', { url, main_url, id: newId, status: 'NEW' }, req.user, req);
        debugLog('WEBSITE_GRAB', `Successfully queued website grab. Record ID: ${newId}`);

        res.status(202).json({ message: 'Website queued for summarization.', id: newId, status: 'NEW' });
    }));

    // GET /:id - Get specific summary (this will be /api/grab-website/:id)
    router.get('/:id', asyncHandler(async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid ID parameter.' });
        }

        const result = await pool.query(
            `SELECT * FROM public.summaries_websites WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Website summary not found.' });
        }

        res.json(result.rows[0]);
    }));

    // GET / - List, potentially filtered by status (this will be /api/grab-website/)
    router.get('/', asyncHandler(async (req, res) => {
        const { status } = req.query; // Allow filtering by status
        let queryText = 'SELECT * FROM public.summaries_websites';
        let queryParams = [];

        if (status) {
            queryText += ' WHERE status = $1';
            queryParams.push(status);
        }

        queryText += ' ORDER BY date_created DESC'; // Newest first

        const result = await pool.query(queryText, queryParams);
        res.json(result.rows);
    }));

    return router;
};
