const express = require('express');
const authenticateApiRequest = require('../middleware/apiAuthMiddleware');
const { debugLog, errorLog } = require('../utils/debugUtils');
const asyncHandler = require('../middleware/asyncHandler');
const { logAuditEvent } = require('../auth/shared');

module.exports = function(pool) {
    const router = express.Router();

    // GET /api/favorites - Get current user's favorites
    router.get('/', authenticateApiRequest, asyncHandler(async (req, res) => {
        const username = req.user.username;

        debugLog('FAVORITES_API_GET', 'Fetching favorites for user', { username });

        const result = await pool.query(
            `SELECT summary_id, source_type, date_created
             FROM public.favorites
             WHERE username = $1
             ORDER BY date_created DESC`,
            [username]
        );

        debugLog('FAVORITES_API_GET', 'Favorites retrieved', {
            count: result.rows.length,
            username
        });

        // Return array of favorites with cache-friendly format
        const favorites = result.rows.map(fav => ({
            summaryId: fav.summary_id,
            sourceType: fav.source_type,
            cacheKey: `${fav.source_type}_${fav.summary_id}`,
            dateCreated: fav.date_created
        }));

        res.json(favorites);
    }));

    // POST /api/favorites - Add summary to favorites
    router.post('/', authenticateApiRequest, asyncHandler(async (req, res) => {
        const { summaryId, sourceType } = req.body;
        const username = req.user.username;

        debugLog('FAVORITES_API_ADD', 'Adding favorite', {
            username,
            summaryId,
            sourceType
        });

        // Validate input
        if (!summaryId || !sourceType) {
            return res.status(400).json({
                error: 'summaryId and sourceType are required.'
            });
        }

        // Validate sourceType
        const validSourceTypes = ['video', 'website', 'custom'];
        if (!validSourceTypes.includes(sourceType)) {
            return res.status(400).json({
                error: `Invalid sourceType. Must be one of: ${validSourceTypes.join(', ')}.`
            });
        }

        // Check if already favorited
        const existing = await pool.query(
            `SELECT id FROM public.favorites
             WHERE username = $1 AND summary_id = $2 AND source_type = $3`,
            [username, summaryId, sourceType]
        );

        if (existing.rows.length > 0) {
            debugLog('FAVORITES_API_ADD', 'Already favorited', {
                username,
                summaryId,
                sourceType
            });
            return res.json({
                message: 'Summary already favorited.',
                favorited: true
            });
        }

        // Add to favorites
        const result = await pool.query(
            `INSERT INTO public.favorites (username, summary_id, source_type)
             VALUES ($1, $2, $3)
             RETURNING id, summary_id, source_type, date_created`,
            [username, summaryId, sourceType]
        );

        debugLog('FAVORITES_API_ADD', 'Favorite added successfully', {
            favoriteId: result.rows[0].id,
            username,
            summaryId,
            sourceType
        });

        // Audit log favorite addition
        logAuditEvent('CREATE', 'favorites', {
            summaryId,
            sourceType,
            favoriteId: result.rows[0].id
        }, req.user, req);

        res.json({
            message: 'Summary added to favorites.',
            favorited: true,
            favorite: result.rows[0]
        });
    }));

    // DELETE /api/favorites - Remove from favorites
    router.delete('/', authenticateApiRequest, asyncHandler(async (req, res) => {
        const { summaryId, sourceType } = req.body;
        const username = req.user.username;

        debugLog('FAVORITES_API_DELETE', 'Removing favorite', {
            username,
            summaryId,
            sourceType
        });

        // Validate input
        if (!summaryId || !sourceType) {
            return res.status(400).json({
                error: 'summaryId and sourceType are required.'
            });
        }

        // Validate sourceType
        const validSourceTypes = ['video', 'website', 'custom'];
        if (!validSourceTypes.includes(sourceType)) {
            return res.status(400).json({
                error: `Invalid sourceType. Must be one of: ${validSourceTypes.join(', ')}.`
            });
        }

        // Delete from favorites
        const result = await pool.query(
            `DELETE FROM public.favorites
             WHERE username = $1 AND summary_id = $2 AND source_type = $3
             RETURNING id`,
            [username, summaryId, sourceType]
        );

        if (result.rows.length === 0) {
            debugLog('FAVORITES_API_DELETE', 'Favorite not found', {
                username,
                summaryId,
                sourceType
            });
            return res.json({
                message: 'Favorite not found or already removed.',
                favorited: false
            });
        }

        debugLog('FAVORITES_API_DELETE', 'Favorite removed successfully', {
            username,
            summaryId,
            sourceType
        });

        // Audit log favorite removal
        logAuditEvent('DELETE', 'favorites', {
            summaryId,
            sourceType
        }, req.user, req);

        res.json({
            message: 'Summary removed from favorites.',
            favorited: false
        });
    }));

    // GET /api/favorites/check - Check if summary is favorited
    router.get('/check', authenticateApiRequest, asyncHandler(async (req, res) => {
        const { summaryId, sourceType } = req.query;
        const username = req.user.username;

        debugLog('FAVORITES_API_CHECK', 'Checking favorite status', {
            username,
            summaryId,
            sourceType
        });

        // Validate input
        if (!summaryId || !sourceType) {
            return res.status(400).json({
                error: 'summaryId and sourceType are required.'
            });
        }

        // Check if favorited
        const result = await pool.query(
            `SELECT id FROM public.favorites
             WHERE username = $1 AND summary_id = $2 AND source_type = $3`,
            [username, summaryId, sourceType]
        );

        const isFavorited = result.rows.length > 0;

        debugLog('FAVORITES_API_CHECK', 'Favorite status checked', {
            username,
            summaryId,
            sourceType,
            isFavorited
        });

        res.json({ isFavorited });
    }));

    return router;
};
