// backend/routes/adminConfig.js
const express = require('express');
const { debugLog, errorLog } = require('../utils/debugUtils');
const { refreshGeneralLimiter } = require('../middleware/security');
const asyncHandler = require('../middleware/asyncHandler');
const { logAuditEvent } = require('../auth/shared');

module.exports = function(pool) {
  const router = express.Router();

  const checkAdminRights = require('../middleware/checkAdminRights');

  // Protect all routes in this section - admin only
  router.use(checkAdminRights);

  // GET /api/admin/config - Fetch configuration
  router.get('/', asyncHandler(async (req, res) => {
    // DEBUG ONLY
    // debugLog('ADMIN_CONFIG', "Hitting GET /api/admin/config");
    const result = await pool.query('SELECT key, value FROM public.config');
    const config = {};
    result.rows.forEach(row => {
      try {
        config[row.key] = JSON.parse(row.value); // Try parsing
      } catch (e) {
        config[row.key] = row.value; // Use raw string if not JSON
      }
    });
    // DEBUG ONLY
    // debugLog('ADMIN_CONFIG', "Returning config:", config);
    return res.json(config); // Ensure it ALWAYS returns JSON
  }));

  // POST /api/admin/config - Update configuration
  router.post('/', asyncHandler(async (req, res) => {
    // DEBUG ONLY
    // debugLog('ADMIN_CONFIG', "Hitting POST /api/admin/config");
    const updates = req.body;

    const allowedKeys = [
      'import_checker_interval_minutes',
      'summary_processor_interval_minutes',
      'summary_processor_delay_seconds',
      'summary_processor_item_delay_seconds',
      'openai_timeout_minutes',
      'summary_system_prompt',
      'website_summary_system_prompt',
      'custom_summary_system_prompt',
      'enable_chunking',
      'max_context_window',
      'chunk_overlap_size',
      'chunking_strategy',
      'max_chunks',
      // Chat AI Configuration (NEW)
      'chat_openai_api_url',
      'chat_openai_model',
      'chat_openai_system_prompt',
      'chat_openai_api_key',
      // Summarizing AI Configuration (NEW)
      'summary_openai_api_url',
      'summary_openai_model',
      'summary_openai_api_key',
      // WebLLM Configuration (NEW)
      'webllm_enabled',
      'webllm_hf_model_url',
      'webllm_default_mode',
      // WebLLM System Prompt (NEW)
      'webllm_system_prompt',
      // Chat Enhancement Configuration (NEW)
      'chat_stream_with_reasoning',
      'chat_include_metrics',
      'chat_debug_reasoning',
      'chat_reasoning_format',
      // PublicAI Configuration (NEW)
      'chat_publicai_api_url',
      'chat_publicai_model',
      'chat_publicai_api_key',
      'chat_publicai_system_prompt',
      // Retry delay configuration
      'summary_retry_delay_seconds',
      // Playlist Worker Configuration (NEW)
      'playlist_checker_interval_minutes',
      'playlist_max_new_videos_per_sync',
      // YouTube Worker Configuration (NEW)
      'yt_dlp_item_delay_seconds',
      'python_provider_timeout_seconds',
      // Proxy Rotation Configuration (NEW)
      'yt_dlp_proxy_enabled',
      'yt_dlp_proxy_type',
      'yt_dlp_proxy_min_pool_size',
      'yt_dlp_proxy_pool_size',
      'yt_dlp_proxy_max_test_attempts',
      'yt_dlp_proxy_max_retries',
      'yt_dlp_proxy_min_backoff',
      'yt_dlp_proxy_max_backoff',
      'yt_dlp_proxy_paid_api_key',
      'yt_dlp_proxy_paid_endpoint',
      'yt_dlp_proxy_test_youtube_directly',
      'yt_dlp_proxy_max_response_time',
      'yt_dlp_proxy_blocked_ports',
      'yt_dlp_proxy_enable_https_fallback',
      // Failed job retry configuration
      'yt_dlp_failed_job_retry_hours',
      // Failover configuration (NEW)
      'summary_openai_failover_enabled',
      'summary_openai_failover_mode',
      'summary_openai_failover_timeout_seconds',
      'summary_openai_secondary_api_url',
      'summary_openai_secondary_api_key',
      'summary_openai_secondary_model',
      // Security configuration (NEW)
      'rate_limit_max'
    ];

    // Validate chunking configuration values
    const validationErrors = [];

    for (const [key, value] of Object.entries(updates)) {
      if (!allowedKeys.includes(key)) continue;

      // Chunking-specific validations
      if (key === 'enable_chunking') {
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          validationErrors.push(`${key} must be a boolean value`);
        }
      }

      if (key === 'max_context_window') {
        const numValue = parseInt(value, 10);
        if (isNaN(numValue) || numValue < 1000 || numValue > 128000) {
          validationErrors.push(`${key} must be a number between 1,000 and 128,000 tokens`);
        }
      }


      if (key === 'chunk_overlap_size') {
        const numValue = parseInt(value, 10);
        if (isNaN(numValue) || numValue < 0 || numValue > 10000) {
          validationErrors.push(`${key} must be a number between 0 and 10,000 characters`);
        }
      }

      if (key === 'chunking_strategy') {
        const validStrategies = ['simple', 'semantic'];
        if (!validStrategies.includes(value)) {
          validationErrors.push(`${key} must be one of: ${validStrategies.join(', ')}`);
        }
      }

      if (key === 'max_chunks') {
        const numValue = parseInt(value, 10);
        if (isNaN(numValue) || numValue < 1 || numValue > 50) {
          validationErrors.push(`${key} must be a number between 1 and 50`);
        }
      } else if (key === 'openai_timeout_minutes') {
        const numValue = parseInt(value, 10);
        if (isNaN(numValue) || numValue < 1 || numValue > 120) {
          validationErrors.push(`${key} must be a number between 1 and 120 minutes`);
        }
      }

      // Chat Enhancement configuration validations
      if (key === 'chat_reasoning_format') {
        const validFormats = ['deepseek', 'deepseek-legacy', 'none'];
        if (!validFormats.includes(value)) {
          validationErrors.push(`${key} must be one of: ${validFormats.join(', ')}`);
        }
      }

      // Proxy Rotation configuration validations
      if (key === 'yt_dlp_proxy_type') {
        const validTypes = ['free', 'paid'];
        if (!validTypes.includes(value)) {
          validationErrors.push(`${key} must be one of: ${validTypes.join(', ')}`);
        }
      }

      if (key === 'yt_dlp_proxy_enable_https_fallback') {
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          validationErrors.push(`${key} must be a boolean value`);
        }
      }

      // LangChain configuration validations
      if (key === 'langchain_transcript_language') {
        if (typeof value !== 'string' || value.trim().length === 0) {
          validationErrors.push(`${key} must be a non-empty string`);
        }
      }

      // Failed job retry interval validation (hours, can be 0 to disable)
      if (key === 'yt_dlp_failed_job_retry_hours') {
        const numValue = parseInt(value, 10);
        if (isNaN(numValue) || numValue < 0 || numValue > 168) {
          validationErrors.push(`${key} must be a number between 0 and 168 hours (7 days)`);
        }
      }

      // Security configuration validation (NEW)
      if (key === 'rate_limit_max') {
        const numValue = parseInt(value, 10);
        if (isNaN(numValue) || numValue < 100 || numValue > 10000) {
          validationErrors.push(`${key} must be a number between 100 and 10,000 requests per 15 minutes`);
        }
      }

      // Failover configuration validations (NEW)
      if (key === 'summary_openai_failover_mode') {
        const validModes = ['failover', 'primary_only', 'secondary_only', 'secondary_to_primary'];
        if (!validModes.includes(value)) {
          validationErrors.push(`${key} must be one of: ${validModes.join(', ')}`);
        }
      }

      if (key === 'summary_openai_failover_timeout_seconds') {
        const numValue = parseInt(value, 10);
        if (isNaN(numValue) || numValue < 1 || numValue > 300) {
          validationErrors.push(`${key} must be a number between 1 and 300 seconds`);
        }
      }

      // General numeric validations for existing keys
      // Skip computed values that are validated elsewhere
      if (key.includes('_minutes') || key.includes('_seconds')) {
        const numValue = parseInt(value, 10);
        if (isNaN(numValue) || numValue < 1) {
          validationErrors.push(`${key} must be a positive number`);
        }
      }
    }

    if (validationErrors.length > 0) {
      debugLog('ADMIN_CONFIG', 'Configuration validation failed', { errors: validationErrors });
      return res.status(400).json({
        error: 'Validation failed',
        details: validationErrors
      });
    }

    debugLog('ADMIN_CONFIG', 'Configuration validation passed', { updates: Object.keys(updates) });

    for (const [key, value] of Object.entries(updates)) {
      if (!allowedKeys.includes(key)) continue;

      // Get old value for audit logging
      const oldResult = await pool.query('SELECT value FROM public.config WHERE key = $1', [key]);
      const oldValue = oldResult.rows[0]?.value;

      let preparedValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      await pool.query(
        `INSERT INTO public.config (key, value, date_updated) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, date_updated = NOW()`,
        [key, preparedValue]
      );

      // Audit log each configuration change
      logAuditEvent('UPDATE', `config:${key}`, {
        oldValue,
        newValue: preparedValue
      }, req.user, req);
    }

    // Refresh rate limiter if rate_limit_max was updated
    if (updates.hasOwnProperty('rate_limit_max')) {
      try {
        await refreshGeneralLimiter(pool);
        debugLog('ADMIN_CONFIG', `Rate limiter refreshed to new value: ${updates.rate_limit_max}`);
      } catch (refreshError) {
        errorLog('ADMIN_CONFIG', 'Failed to refresh rate limiter', refreshError);
        // Continue anyway - the config was saved, just the refresh failed
      }
    }

    debugLog('ADMIN_CONFIG', 'Configuration updated successfully', { keys: Object.keys(updates) });
    return res.json({ message: 'Configuration updated' });
  }));

  // GET /api/admin/config/imports/custom - Get all custom import records
  router.get('/imports/custom', asyncHandler(async (req, res) => {
    const result = await pool.query(`
        SELECT id, title, source, status, created_at, date_update
        FROM import_custom
        ORDER BY created_at DESC;
    `);
    res.json(result.rows);
  }));

  // PUT /api/admin/config/imports/custom/:id/status - Update status of a custom import record
  router.put('/imports/custom/:id/status', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['NEW', 'PENDING', 'DONE', 'FAILED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status provided.' });
    }

    const result = await pool.query(
      `UPDATE import_custom SET status = $1, date_update = NOW() WHERE id = $2 RETURNING *;`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Custom import record not found.' });
    }

    res.json({ message: 'Custom import status updated successfully.', record: result.rows[0] });
  }));

  // DELETE /api/admin/config/imports/custom/:id - Delete a custom import record
  router.delete('/imports/custom/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Get the record before deleting for audit logging
    const beforeDelete = await pool.query('SELECT * FROM import_custom WHERE id = $1', [id]);
    const result = await pool.query(`DELETE FROM import_custom WHERE id = $1 RETURNING id;`, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Custom import record not found.' });
    }

    // Audit log the deletion
    logAuditEvent('DELETE', 'import_custom', {
      id,
      deletedRecord: beforeDelete.rows[0]
    }, req.user, req);

    res.json({ message: 'Custom import record deleted successfully.', id: result.rows[0].id });
  }));

  // GET /api/admin/config/summaries/custom - Get all custom summaries
  router.get('/summaries/custom', asyncHandler(async (req, res) => {
    const result = await pool.query(`
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
            date_update
        FROM summaries_custom
        ORDER BY date_created DESC;
    `);
    res.json(result.rows);
  }));

  // GET /api/admin/config/summaries/custom/:id - Get a single custom summary by ID
  router.get('/summaries/custom/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await pool.query(`
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
            date_update
        FROM summaries_custom
        WHERE id = $1;
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Custom summary not found.' });
    }

    res.json(result.rows[0]);
  }));

  // PUT /api/admin/config/summaries/custom/:id/status - Update status of a custom summary
  router.put('/summaries/custom/:id/status', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['NEW', 'PENDING', 'DONE', 'FAILED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status provided.' });
    }

    const result = await pool.query(
      `UPDATE summaries_custom SET status = $1, date_update = NOW() WHERE id = $2 RETURNING *;`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Custom summary not found.' });
    }

    res.json({ message: 'Custom summary status updated successfully.', summary: result.rows[0] });
  }));

  // DELETE /api/admin/config/summaries/custom/:id - Delete a custom summary
  router.delete('/summaries/custom/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Get the record before deleting for audit logging
    const beforeDelete = await pool.query('SELECT id, title, status FROM summaries_custom WHERE id = $1', [id]);
    const result = await pool.query(`DELETE FROM summaries_custom WHERE id = $1 RETURNING id;`, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Custom summary not found.' });
    }

    // Audit log the deletion
    logAuditEvent('DELETE', 'summaries_custom', {
      id,
      deletedRecord: beforeDelete.rows[0]
    }, req.user, req);

    res.json({ message: 'Custom summary deleted successfully.', id: result.rows[0].id });
  }));

  return router;
};
