const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { logAuditEvent } = require('../auth/shared');
const checkAdminRights = require('../middleware/checkAdminRights');

const router = express.Router();

// Note: This router is not currently mounted in server.js
// The /admin.html handler is in backend/server.js (lines 206-208)
// These routes would need to be mounted to be active

// Prompts management routes
router.get('/api/admin/prompts', checkAdminRights, asyncHandler(async (req, res) => {
    const result = await req.pool.query(
        'SELECT * FROM public.chat_prompts ORDER BY category, title'
    );
    res.json(result.rows);
}));

router.post('/api/admin/prompts', checkAdminRights, asyncHandler(async (req, res) => {
    const { title, prompt_text, category } = req.body;

    if (!title || !prompt_text) {
        return res.status(400).json({ error: 'Title and prompt text are required' });
    }

    const result = await req.pool.query(
        'INSERT INTO public.chat_prompts (title, prompt_text, category) VALUES ($1, $2, $3) RETURNING *',
        [title, prompt_text, category || 'General']
    );

    // Audit log prompt creation
    logAuditEvent('CREATE', 'admin:prompts', {
      promptId: result.rows[0].id,
      title,
      category
    }, req.user, req);

    res.json(result.rows[0]);
}));

router.put('/api/admin/prompts/:id', checkAdminRights, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { title, prompt_text, category, is_active } = req.body;

    const result = await req.pool.query(
        'UPDATE public.chat_prompts SET title = $1, prompt_text = $2, category = $3, is_active = $4, date_updated = NOW() WHERE id = $5 RETURNING *',
        [title, prompt_text, category, is_active, id]
    );

    if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Prompt not found' });
    }

    // Audit log prompt update
    logAuditEvent('UPDATE', 'admin:prompts', {
      promptId: result.rows[0].id,
      title,
      isActive: is_active
    }, req.user, req);

    res.json(result.rows[0]);
}));

router.delete('/api/admin/prompts/:id', checkAdminRights, asyncHandler(async (req, res) => {
    const { id } = req.params;

    const result = await req.pool.query(
        'DELETE FROM public.chat_prompts WHERE id = $1 RETURNING *',
        [id]
    );

    if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Prompt not found' });
    }

    // Audit log prompt deletion
    logAuditEvent('DELETE', 'admin:prompts', {
      promptId: result.rows[0]?.id || id
    }, req.user, req);

    res.json({ message: 'Prompt deleted successfully' });
}));

module.exports = router;
