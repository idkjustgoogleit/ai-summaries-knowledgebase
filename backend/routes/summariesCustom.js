const express = require('express');
const checkAdminRights = require('../middleware/checkAdminRights');
const authenticateApiRequest = require('../middleware/apiAuthMiddleware');
const asyncHandler = require('../middleware/asyncHandler');
const { debugLog, errorLog } = require('../utils/debugUtils');
const { logAuditEvent } = require('../auth/shared');

module.exports = function(pool) {
  const router = express.Router();

// GET /api/summariesCustom - Get all custom summaries
router.get('/', asyncHandler(async (req, res) => {
    const query = `
        SELECT
            id,
            title,
            content,
            status,
            description,
            tldr,
            summary,
            key_insights,
            actionable_takeaways,
            notes,
            confidence,
            tags,
            date_created,
            date_update,
            import_id,
            addedby,
            'custom' as source_type
        FROM summaries_custom
        ORDER BY date_update DESC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
}));

// GET /api/summariesCustom/:id - Get a single custom summary by ID
router.get('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const query = `
        SELECT
            id,
            title,
            content,
            status,
            description,
            tldr,
            summary,
            key_insights,
            actionable_takeaways,
            notes,
            confidence,
            tags,
            date_created,
            date_update,
            import_id,
            addedby,
            'custom' as source_type
        FROM summaries_custom
        WHERE id = $1;
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Custom summary not found.' });
    }

    res.json(result.rows[0]);
}));

// PUT /api/summariesCustom/:id - Update a custom summary by ID
router.put('/:id', checkAdminRights, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const {
        title,
        content,
        status,
        description,
        tldr,
        summary,
        key_insights,
        actionable_takeaways,
        notes,
        confidence,
        tags
    } = req.body;

    const query = `
        UPDATE summaries_custom SET
            title = $1,
            content = $2,
            status = $3,
            description = $4,
            tldr = $5,
            summary = $6,
            key_insights = $7,
            actionable_takeaways = $8,
            notes = $9,
            confidence = $10,
            tags = $11,
            date_update = NOW()
        WHERE id = $12
        RETURNING *;
    `;
    const values = [title, content, status, description, tldr, summary, key_insights, actionable_takeaways, notes, confidence, tags, id];
    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Custom summary not found.' });
    }

    res.json({ message: 'Custom summary updated successfully.', summary: result.rows[0] });
}));

// POST /api/summariesCustom/:id/restart - Restart a custom content job (all authenticated users)
router.post('/:id/restart', authenticateApiRequest, asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Set status back to NEW to restart the workflow
    const result = await pool.query(
      `UPDATE summaries_custom
       SET status = $1, date_update = NOW()
       WHERE id = $2
       RETURNING id, title, status`,
      ['NEW', id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Custom content not found.' });
    }

    debugLog('CUSTOM_RESTART', `Custom content job ${id} restarted successfully`);
    res.json({ message: 'Job restarted successfully' });
}));

// DELETE /api/summariesCustom/:id - Delete a custom summary by ID (Owner or Admin)
router.delete('/:id', authenticateApiRequest, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const username = req.user.username;

    debugLog('CUSTOM_DELETE', `DELETE /api/summariesCustom/${id} - Received request`, {
      username,
      role: req.user.role,
      isAdmin: req.user.isAdmin
    });

    // Get summary to check ownership
    const summaryResult = await pool.query(
      'SELECT id, title, addedby FROM summaries_custom WHERE id = $1',
      [id]
    );

    if (summaryResult.rowCount === 0) {
      errorLog('CUSTOM_DELETE', `Custom summary ${id} not found`);
      return res.status(404).json({ error: 'Custom summary not found.' });
    }

    const summary = summaryResult.rows[0];
    const isOwner = summary.addedby === username;

    debugLog('CUSTOM_DELETE', 'Ownership check', {
      summaryId: summary.id,
      title: summary.title,
      addedBy: summary.addedby,
      currentUsername: username,
      isOwner,
      isAdmin: req.user.isAdmin
    });

    // Check permission: must be admin or owner
    if (!req.user.isAdmin && !isOwner) {
      errorLog('CUSTOM_DELETE', 'Permission denied for custom summary deletion', {
        username,
        summaryId: id,
        addedBy: summary.addedby,
        reason: 'Not admin or owner'
      });
      return res.status(403).json({
        error: 'Access denied. You can only delete your own summaries.'
      });
    }

    const query = 'DELETE FROM summaries_custom WHERE id = $1 RETURNING id;';
    const result = await pool.query(query, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Custom summary not found.' });
    }

    // Audit log the deletion
    logAuditEvent('DELETE', 'summaries:custom', {
      id,
      title: summary.title,
      addedby: summary.addedby,
      wasOwner: isOwner,
      wasAdmin: req.user.isAdmin
    }, req.user, req);

    debugLog('CUSTOM_DELETE', `Custom summary ${id} deleted successfully`, {
      deletedBy: username,
      wasOwner: isOwner,
      wasAdmin: req.user.isAdmin
    });

    res.status(200).json({ message: 'Custom summary deleted successfully.', id: result.rows[0].id });
}));

return router;
};
