const express = require('express');
const authenticateApiRequest = require('../middleware/apiAuthMiddleware');
const checkAdminRights = require('../middleware/checkAdminRights');
const { getCurrentUsername } = require('../utils/userUtils');
const { debugLog, errorLog } = require('../utils/debugUtils');
const asyncHandler = require('../middleware/asyncHandler');
const { logAuditEvent } = require('../auth/shared');

module.exports = function(pool) {
  const router = express.Router();

  // Get import records (for admin)
  router.get('/', asyncHandler(async (req, res) => {
    const result = await pool.query('SELECT * FROM public.import ORDER BY date_import DESC');
    res.json(result.rows);
  }));

  // Import JSON data (admin functionality) - EXTRACT YOUTUBE ID
  router.post('/upload', authenticateApiRequest, asyncHandler(async (req, res) => {
    const data = req.body;

    if (!data) {
      return res.status(400).json({ error: 'No data provided' });
    }

    // Get current username
    const username = getCurrentUsername(req);
    debugLog('IMPORT', `Uploading data with user: ${username}`);
    debugLog('IMPORT', `Auth mode: ${process.env.SSO_OIDC === 'true' ? 'OIDC' : 'Local'}`);
    debugLog('IMPORT', `User object available:`, !!req.user);
    debugLog('IMPORT', `Session available:`, !!req.session);

    // Initial status for new video imports - always use YTDLP workflow
    const initialStatus = 'NEW_YTDLP';
    debugLog('IMPORT', `Setting initial status to: ${initialStatus}`);

    // Handle both single object and array
    const records = Array.isArray(data) ? data : [data];

    for (const item of records) {
      const {
        id, title, platform, url, channel, speakers,
        host, type, description, content, subtitles
      } = item;

      // EXTRACT YouTube video ID from URL or use provided ID
      let videoid;
      if (url) {
        // Extract YouTube ID from URL
        const youtubeMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        videoid = youtubeMatch ? youtubeMatch[1] : url;
      } else {
        // Use provided ID or generate one
        videoid = id || `vid_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      }

      const query = `
        INSERT INTO public.import (
          videoid, title, platform, url, channel,
          description, subtitles, date_import, status,
          other1, other2, other3, other4, transcript_normalized, addedBy
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11, $12, $13)
        ON CONFLICT (videoid) DO UPDATE SET
          title = EXCLUDED.title,
          platform = EXCLUDED.platform,
          url = EXCLUDED.url,
          channel = EXCLUDED.channel,
          description = EXCLUDED.description,
          subtitles = EXCLUDED.subtitles,
          transcript_normalized = EXCLUDED.transcript_normalized,
          date_update = NOW(),
          status = EXCLUDED.status,
          other1 = EXCLUDED.other1,
          other2 = EXCLUDED.other2,
          other3 = EXCLUDED.other3,
          other4 = EXCLUDED.other4,
          addedBy = EXCLUDED.addedBy
      `;

      await pool.query(query, [
        videoid, title, platform, url, channel,
        description, content || subtitles || '',
        initialStatus, // Use provider-type-specific status
        Array.isArray(speakers) ? speakers.join(', ') : (speakers || ''),
        host || '',
        type || '',
        '',
        content || subtitles || '',
        username
      ]);
    }

    res.json({ message: `Successfully imported ${records.length} record(s)` });
  }));

  // Update import record status
  router.put('/:id', checkAdminRights, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status values - simplified workflow
    const validStatuses = [
      'NEW_YTDLP',        // Initial status when video is grabbed
      'PENDING_YTDLP',    // Video queued for yt-dlp processing
      'NEW',              // Video ready for summarization (transcript available)
      'PENDING',          // Video queued for summarization
      'DONE',             // Video successfully summarized
      'FAILED'            // Processing failed
    ];

    // Fix: Reject null explicitly and require valid status
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Status is required and must be valid' });
    }

    // Get old status for audit log
    const oldResult = await pool.query('SELECT status, title FROM public.import WHERE videoid = $1', [id]);
    if (oldResult.rowCount === 0) {
      return res.status(404).json({ error: 'Import record not found' });
    }
    const oldStatus = oldResult.rows[0].status;

    // Update status
    await pool.query('UPDATE public.import SET status = $1, date_update = NOW() WHERE videoid = $2', [status, id]);

    // Audit log the status change
    logAuditEvent('UPDATE', 'import:status', {
      videoid: id,
      title: oldResult.rows[0].title,
      oldStatus,
      newStatus: status
    }, req.user, req);

    res.json({ message: 'Status updated successfully' });
  }));

  // Restart import job (all authenticated users)
  router.post('/:id/restart', authenticateApiRequest, asyncHandler(async (req, res) => {
    const { id } = req.params;

    debugLog('IMPORT', `Restarting job ${id} by user ${getCurrentUsername(req)}`);

    // Set status back to NEW_YTDLP to restart the workflow
    await pool.query(
      'UPDATE public.import SET status = $1, date_update = NOW() WHERE videoid = $2',
      ['NEW_YTDLP', id]
    );

    debugLog('IMPORT', `Job ${id} restarted successfully`);
    res.json({ message: 'Job restarted successfully' });
  }));

  // Delete import record
  router.delete('/:id', checkAdminRights, asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Get record info before deletion for audit log
    const oldResult = await pool.query('SELECT videoid, title, status, addedby FROM public.import WHERE videoid = $1', [id]);
    if (oldResult.rowCount === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    const result = await pool.query('DELETE FROM public.import WHERE videoid = $1', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    // Audit log the deletion
    logAuditEvent('DELETE', 'import', {
      videoid: id,
      title: oldResult.rows[0].title,
      status: oldResult.rows[0].status,
      addedby: oldResult.rows[0].addedby
    }, req.user, req);

    res.json({ message: 'Record deleted successfully' });
  }));

  // SUPER SIMPLE grab endpoint - only videoid, url, and status NEW
  router.post('/grab', authenticateApiRequest, asyncHandler(async (req, res) => {
    const { videoId, url } = req.body;

    if (!videoId) {
      return res.status(400).json({ error: 'Video ID is required' });
    }

    // Get current username
    const username = getCurrentUsername(req);
    debugLog('IMPORT', `Grabbing video ${videoId} with user: ${username}`);
    debugLog('IMPORT', `Auth mode: ${process.env.SSO_OIDC === 'true' ? 'OIDC' : 'Local'}`);
    debugLog('IMPORT', `User object available:`, !!req.user);
    debugLog('IMPORT', `Session available:`, !!req.session);

    // Initial status for new video grabs - always use YTDLP workflow
    const initialStatus = 'NEW_YTDLP';
    debugLog('IMPORT', `Setting initial status to: ${initialStatus}`);

    const videoid = videoId;
    const videoUrl = url || `https://www.youtube.com/watch?v=${videoId}`;

    // ONLY insert videoid, url, set status based on provider type and platform to YouTube
    const query = `
      INSERT INTO public.import (videoid, url, status, platform, date_import, addedBy)
      VALUES ($1, $2, $3, 'YouTube', NOW(), $4)
      ON CONFLICT (videoid) DO UPDATE SET
        url = EXCLUDED.url,
        status = EXCLUDED.status,
        platform = EXCLUDED.platform,
        date_update = NOW(),
        addedBy = EXCLUDED.addedBy
    `;

    await pool.query(query, [videoid, videoUrl, initialStatus, username]);

    res.json({ message: 'Successfully imported video with status NEW' });
  }));

  // Get import progress - all items with status != 'DONE' from all three types
  router.get('/progress', authenticateApiRequest, asyncHandler(async (req, res) => {
    debugLog('IMPORT_PROGRESS', 'Fetching import progress data');

    // Fetch videos from import table (not DONE)
    const videoQuery = `
      SELECT
        videoid as id,
        COALESCE(title, 'Untitled Video') as title,
        'video' as source_type,
        status,
        date_import as date,
        addedby,
        platform,
        url
      FROM public.import
      WHERE status != 'DONE'
      ORDER BY date_import DESC
    `;

    const videoResult = await pool.query(videoQuery);
    debugLog('IMPORT_PROGRESS', `Found ${videoResult.rows.length} videos in progress`);

    // Fetch websites from summaries_websites table (not DONE)
    const websiteQuery = `
      SELECT
        id::text as id,
        COALESCE(title, 'Untitled Website') as title,
        'website' as source_type,
        status,
        date_created as date,
        addedby,
        'Website' as platform,
        url
      FROM public.summaries_websites
      WHERE status != 'DONE'
      ORDER BY date_created DESC
    `;

    const websiteResult = await pool.query(websiteQuery);
    debugLog('IMPORT_PROGRESS', `Found ${websiteResult.rows.length} websites in progress`);

    // Fetch custom items from import_custom table (not DONE)
    const customQuery = `
      SELECT
        id::text as id,
        COALESCE(title, 'Untitled Custom') as title,
        'custom' as source_type,
        status,
        created_at as date,
        addedby,
        'Custom' as platform,
        type,
        source
      FROM public.import_custom
      WHERE status != 'DONE'
      ORDER BY created_at DESC
    `;

    const customResult = await pool.query(customQuery);
    debugLog('IMPORT_PROGRESS', `Found ${customResult.rows.length} custom items in progress`);

    // Combine all results
    const allProgress = [
      ...videoResult.rows,
      ...websiteResult.rows,
      ...customResult.rows
    ];

    // Sort by date (most recent first)
    allProgress.sort((a, b) => new Date(b.date) - new Date(a.date));

    debugLog('IMPORT_PROGRESS', `Total items in progress: ${allProgress.length}`);
    res.json(allProgress);
  }));

  return router;
};
