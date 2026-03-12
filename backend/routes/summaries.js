const express = require('express');
const authenticateApiRequest = require('../middleware/apiAuthMiddleware');
const checkAdminRights = require('../middleware/checkAdminRights');
const { debugLog, errorLog, isDebugEnabled } = require('../utils/debugUtils');
const asyncHandler = require('../middleware/asyncHandler');
const { logAuditEvent } = require('../auth/shared');
  
module.exports = function(pool) {  
  const router = express.Router();  
  
  // Helper function to normalize tags in JavaScript (simpler and more robust)  
  function normalizeTagsForUnifiedList(rawTags) {  
      if (rawTags === null || rawTags === undefined || rawTags === '' || (typeof rawTags === 'string' && rawTags.trim() === '[]')) {  
          return []; // Ensure a JS array is always returned  
      }  
  
      if (typeof rawTags === 'string') {  
          const trimmed = rawTags.trim();  
          if (trimmed.startsWith('[') && trimmed.endsWith(']')) {  
              // Looks like JSON array string, try to parse  
              try {  
                  const parsed = JSON.parse(trimmed);  
                  if (Array.isArray(parsed)) {  
                      return parsed.filter(tag => typeof tag === 'string' && tag.trim() !== '');  
                  }  
              } catch (e) {  
                  // Could not parse tags as JSON array string - falling through to CSV parsing (intentionally not logging)  
                  // Fall through to CSV parsing  
              }  
          }  
          // Treat as comma-separated  
          return trimmed.split(',').map(tag => tag.trim()).filter(tag => tag !== '');  
      }  
  
      if (Array.isArray(rawTags)) {  
          // If it's already an array (e.g., from JSONB -> JS), process it  
          return rawTags.filter(tag => typeof tag === 'string' && tag.trim() !== '').map(tag => String(tag).trim());  
      }  
  
      // Fallback for any other unexpected type  
      debugLog('TAGS_NORMALIZATION', 'Unknown tags format encountered', { type: typeof rawTags, value: rawTags });  
      return [];  
  }  
  
  // GET /api/summaries/websites - Get all website summaries (for admin management)
  router.get('/websites', asyncHandler(async (req, res) => {
    debugLog('SUMMARIES_API_WEBSITES', 'GET /api/summaries/websites - Received request');
    const result = await pool.query(
        `SELECT id, title, url, main_url, status, date_created, date_update, addedby
         FROM public.summaries_websites
         ORDER BY date_created DESC`
    );
    debugLog('SUMMARIES_API_WEBSITES', `Fetched ${result.rows.length} website records`);
    res.json(result.rows);
  }));  
  
  // GET /api/summaries/websites/:id - Get specific website summary by ID
  router.get('/websites/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    debugLog('SUMMARIES_API_WEBSITES', `GET /api/summaries/websites/${id} - Received request`);

    // Select all fields needed for website summary page
    const result = await pool.query(
        `SELECT
            id,
            title,
            description,
            tldr,
            url,
            main_url,
            status,
            type,
            summary,
            key_insights,
            actionable_takeaways,
            notes,
            confidence,
            tags,
            date_created,
            date_update,
            addedby
         FROM public.summaries_websites WHERE id = $1`,
        [id]
    );

    if (result.rows.length === 0) {
      debugLog('SUMMARIES_API_WEBSITES', `GET /api/summaries/websites/${id} - Not found`);
      return res.status(404).json({ error: 'Website summary not found' });
    }

    debugLog('SUMMARIES_API_WEBSITES', `GET /api/summaries/websites/${id} - Success`);
    res.json(result.rows[0]);
  })); 
  
  router.put('/websites/:id/status', checkAdminRights, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required.' });
    }

    const validStatuses = ['NEW', 'PENDING', 'DONE', 'FAILED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}.` });
    }

    // Get old status for audit log
    const oldResult = await pool.query('SELECT id, title, status FROM public.summaries_websites WHERE id = $1', [id]);
    if (oldResult.rowCount === 0) {
      return res.status(404).json({ error: 'Website summary not found.' });
    }
    const oldStatus = oldResult.rows[0].status;

    const result = await pool.query(
      `UPDATE public.summaries_websites
       SET status = $1, date_update = NOW()
       WHERE id = $2
       RETURNING id, title, status, date_update`,
      [status, id]
    );

    if (result.rowCount === 0) {
      debugLog('SUMMARIES_API_WEBSITES', `PUT /api/summaries/websites/${id} - Summary not found`);
      return res.status(404).json({ error: 'Website summary not found.' });
    }

    // Audit log the status change
    logAuditEvent('UPDATE', 'summaries:website:status', {
      id,
      title: oldResult.rows[0].title,
      oldStatus,
      newStatus: status
    }, req.user, req);

    debugLog('SUMMARIES_API_WEBSITES', `PUT /api/summaries/websites/${id} - Success`);
    res.json({ message: 'Status updated.', summary: result.rows[0] });
  }));

  // Restart website job (all authenticated users)
  router.post('/websites/:id/restart', authenticateApiRequest, asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Set status back to NEW to restart the workflow
    const result = await pool.query(
      `UPDATE public.summaries_websites
       SET status = $1, date_update = NOW()
       WHERE id = $2
       RETURNING id, title, status`,
      ['NEW', id]
    );

    if (result.rowCount === 0) {
      debugLog('SUMMARIES_API_WEBSITES', `POST /api/summaries/websites/${id}/restart - Website not found`);
      return res.status(404).json({ error: 'Website not found.' });
    }

    debugLog('SUMMARIES_API_WEBSITES', `POST /api/summaries/websites/${id}/restart - Success`);
    res.json({ message: 'Job restarted successfully' });
  }));

  router.delete('/websites/:id', authenticateApiRequest, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const username = req.user.username;

    debugLog('WEBSITES_DELETE', `DELETE /api/summaries/websites/${id} - Received request`, {
      username,
      role: req.user.role,
      isAdmin: req.user.isAdmin
    });

    // Get the summary to check ownership
    const summaryResult = await pool.query(
      'SELECT id, title, addedby FROM public.summaries_websites WHERE id = $1',
      [id]
    );

    if (summaryResult.rowCount === 0) {
      debugLog('WEBSITES_DELETE', `Website summary ${id} not found`);
      return res.status(404).json({ error: 'Website summary not found.' });
    }

    const summary = summaryResult.rows[0];
    const isOwner = summary.addedby === username;

    debugLog('WEBSITES_DELETE', 'Ownership check', {
      summaryId: summary.id,
      title: summary.title,
      addedBy: summary.addedby,
      currentUsername: username,
      isOwner,
      isAdmin: req.user.isAdmin
    });

    // Check permission: must be admin or owner
    if (!req.user.isAdmin && !isOwner) {
      debugLog('WEBSITES_DELETE', 'Permission denied', {
        username,
        reason: 'Not admin or owner',
        addedBy: summary.addedby
      });
      return res.status(403).json({
        error: 'Access denied. You can only delete your own summaries.'
      });
    }

    const result = await pool.query(
      'DELETE FROM public.summaries_websites WHERE id = $1', [id]
    );

    if (result.rowCount === 0) {
      debugLog('SUMMARIES_API_WEBSITES', `DELETE /api/summaries/websites/${id} - Summary not found`);
      return res.status(404).json({ error: 'Website summary not found.' });
    }

    // Audit log the deletion
    logAuditEvent('DELETE', 'summaries:website', {
      id,
      title: summary.title,
      addedby: summary.addedby,
      wasOwner: isOwner,
      wasAdmin: req.user.isAdmin
    }, req.user, req);

    debugLog('WEBSITES_DELETE', `Website summary ${id} deleted successfully`, {
      deletedBy: username,
      wasOwner: isOwner,
      wasAdmin: req.user.isAdmin
    });

    res.json({ message: 'Website summary deleted successfully.' });
  }));
  
  // GET / - Unified endpoint to get both video and website summaries for main view
  router.get('/', authenticateApiRequest, asyncHandler(async (req, res) => {
    // --- USER FILTERING LOGIC ---
    const userFilter = req.query.userFilter; // 'all', 'mine', 'favorites', or undefined
    const isAuthenticated = req.user && req.user.username;
    const currentUsername = isAuthenticated ? req.user.username : null;
          
    debugLog('SUMMARIES_API_USER_FILTER', 'User filtering request received', {
      userFilter: userFilter,
      isAuthenticated: isAuthenticated,
      username: currentUsername,
      userAgent: req.get('User-Agent')
    });

    // Validate userFilter parameter
    if ((userFilter === 'mine' || userFilter === 'favorites') && !isAuthenticated) {
      debugLog('SUMMARIES_API_USER_FILTER', 'Unauthorized user filtering attempt', {
        userFilter: userFilter,
        isAuthenticated: isAuthenticated
      });
      return res.status(401).json({
        error: 'Authentication required for user filtering',
        details: 'Please authenticate to view your summaries or favorites'
      });
    }

    // --- FETCH BOTH DATASETS SEPARATELY WITH EXPLICIT COLUMN SELECTION AND NULL HANDLING ---
    let videoQuery = `
              SELECT  
                  'video' AS source_type,  
                  s.videoid AS id,  
                  COALESCE(s.name, 'Untitled') AS title,  
                  COALESCE(s.description, '') AS description,  
                  COALESCE(s.tldr, '') AS tldr,  
                  COALESCE(s.channel, 'Unknown Channel') AS channel,  
                  COALESCE(s.url, '') AS url,  
                  s.tags,
                  s.status,  
                  s.date_created,
                  s.date_update AS last_modified,
                  s.addedby
              FROM public.summaries s
              WHERE s.status = 'DONE' AND s.name IS NOT NULL AND s.name != ''`;
          
          let websiteQuery = `
              SELECT  
                  'website' AS source_type,  
                  w.id::TEXT AS id,  
                  COALESCE(w.title, 'Untitled Website') AS title,  
                  COALESCE(w.description, '') AS description,  
                  COALESCE(w.tldr, '') AS tldr,  
                  COALESCE(w.main_url, 'Unknown Domain') AS channel,  
                  COALESCE(w.url, '') AS url,  
                  w.tags,
                  w.status,  
                  w.date_created,
                  w.date_update AS last_modified,
                  w.addedby
              FROM public.summaries_websites AS w  
              WHERE w.status = 'DONE' AND w.title IS NOT NULL AND w.title != ''`;
              
          let customQuery = `
              SELECT
                  'custom' AS source_type,
                  c.id::TEXT AS id,
                  COALESCE(c.title, 'Untitled Custom Summary') AS title,
                  COALESCE(c.description, '') AS description,
                  COALESCE(c.tldr, '') AS tldr,
                  'Manual Input' AS channel,
                  NULL AS url,
                  c.tags,
                  c.status,
                  c.date_created,
                  c.date_update AS last_modified,
                  c.addedby
              FROM summaries_custom AS c
              WHERE c.status = 'DONE' AND c.title IS NOT NULL AND c.title != ''`;
          
          // Initialize favorites filter query
          let favoritesQuery = '';
          let useFavoritesFilter = false;
          
          // If filtering by favorites, build subquery
          if (userFilter === 'favorites' && isAuthenticated) {
              useFavoritesFilter = true;
              favoritesQuery = ` AND EXISTS (
                  SELECT 1 FROM public.favorites f 
                  WHERE f.summary_id = $1 AND f.source_type = $2 AND f.username = $3
              )`;
              debugLog('SUMMARIES_API_USER_FILTER', 'Favorites filter enabled', { username: currentUsername });
          }
          
          // Add user filtering to queries if requested
          if (userFilter === 'mine' && isAuthenticated) {
              videoQuery += ` AND s.addedby = $1`;
              websiteQuery += ` AND addedby = $1`;
              customQuery += ` AND addedby = $1`;
              
              debugLog('SUMMARIES_API_QUERIES', 'User filtering applied to all queries', {
                  username: currentUsername,
                  filterType: 'mine',
                  videoQuery: videoQuery,
                  websiteQuery: websiteQuery,
                  customQuery: customQuery
              });
          }
          
          // Add favorites filtering to queries if requested
          if (useFavoritesFilter) {
              videoQuery += ` AND EXISTS (
                  SELECT 1 FROM public.favorites f 
                  WHERE f.summary_id = s.videoid AND f.source_type = 'video' AND f.username = $1
              )`;
              websiteQuery += ` AND EXISTS (
                  SELECT 1 FROM public.favorites f 
                  WHERE f.summary_id = w.id::text AND f.source_type = 'website' AND f.username = $1
              )`;
              customQuery += ` AND EXISTS (
                  SELECT 1 FROM public.favorites f 
                  WHERE f.summary_id = c.id::text AND f.source_type = 'custom' AND f.username = $1
              )`;
              
              debugLog('SUMMARIES_API_QUERIES', 'Favorites filtering applied to all queries', {
                  username: currentUsername,
                  filterType: 'favorites',
                  videoQuery: videoQuery,
                  websiteQuery: websiteQuery,
                  customQuery: customQuery
              });
          }
          
          videoQuery += ` ORDER BY s.date_update DESC`;
          websiteQuery += ` ORDER BY date_update DESC`;
          customQuery += ` ORDER BY date_update DESC`;
          
          // Execute queries with appropriate parameters based on filter type
          let videoResult, websiteResult, customResult;
          
          if (useFavoritesFilter) {
              // For favorites filtering, pass username as parameter
              videoResult = await pool.query(videoQuery, [currentUsername]);
              websiteResult = await pool.query(websiteQuery, [currentUsername]);
              customResult = await pool.query(customQuery, [currentUsername]);
          } else if (userFilter === 'mine' && isAuthenticated) {
              // For 'mine' filtering, pass username as parameter
              videoResult = await pool.query(videoQuery, [currentUsername]);
              websiteResult = await pool.query(websiteQuery, [currentUsername]);
              customResult = await pool.query(customQuery, [currentUsername]);
          } else {
              // No filtering, execute without parameters
              videoResult = await pool.query(videoQuery);
              websiteResult = await pool.query(websiteQuery);
              customResult = await pool.query(customQuery);
          }

          debugLog('SUMMARIES_API_RESULTS', 'Query results received', {
              videoCount: videoResult.rows.length,
              websiteCount: websiteResult.rows.length,
              customCount: customResult.rows.length,
              totalCount: videoResult.rows.length + websiteResult.rows.length + customResult.rows.length,
              userFilter: userFilter,
              username: currentUsername
          });
  
          // --- NORMALIZE TAGS IN JAVASCRIPT ---  
          const normalizedVideos = videoResult.rows.map(row => ({  
              ...row,  
              tags: normalizeTagsForUnifiedList(row.tags),  
              title: row.title || 'Untitled Video',  
              channel: row.channel || 'Unknown Channel',  
              id: String(row.id) // Ensure ID is string
          }));  
  
          const normalizedWebsites = websiteResult.rows.map(row => ({  
              ...row,  
              tags: normalizeTagsForUnifiedList(row.tags),  
              title: row.title || 'Untitled Website',  
              channel: row.channel || 'Unknown Domain',  
              id: String(row.id) // Ensure ID is string
          }));  
  
          const normalizedCustomSummaries = customResult.rows.map(row => ({
              ...row,
              tags: normalizeTagsForUnifiedList(row.tags),
              title: row.title || 'Untitled Custom Summary',
              channel: row.channel || 'Manual Input',
              id: String(row.id) // Ensure ID is string
          }));

          debugLog('SUMMARIES_API_NORMALIZATION', 'Data normalization completed', {
              normalizedVideos: normalizedVideos.length,
              normalizedWebsites: normalizedWebsites.length,
              normalizedCustomSummaries: normalizedCustomSummaries.length
          });
  
          // --- COMBINE AND SORT ---  
          const combinedSummaries = [...normalizedVideos, ...normalizedWebsites, ...normalizedCustomSummaries]  
              .sort((a, b) => new Date(b.last_modified) - new Date(a.last_modified))  
              .slice(0, 100); // Limit total results  

          debugLog('SUMMARIES_API_FINAL', 'Final combined results prepared', {
              combinedCount: combinedSummaries.length,
              userFilter: userFilter,
              username: currentUsername,
              sourceTypes: combinedSummaries.reduce((acc, summary) => {
                  acc[summary.source_type] = (acc[summary.source_type] || 0) + 1;
                  return acc;
              }, {})
          });

    res.json(combinedSummaries);
  }));  
  
  // Get all unique tags - WITH PROPER CLEANING AT SQL LEVEL
  router.get('/tags', asyncHandler(async (req, res) => {
    debugLog('SUMMARIES_API_TAGS', 'Tags route called with SQL cleaning');

    // SQL query that properly extracts and cleans individual tags
    const result = await pool.query(`
      SELECT DISTINCT
        TRIM(BOTH ' ' FROM
          REGEXP_REPLACE(
            TRIM(BOTH '"' FROM
              TRIM(BOTH '''"{}[]' FROM UNNEST(STRING_TO_ARRAY(tags, ',')))
            ),
            '[{}"''\\[\\]]', '', 'g'
          )
        ) as tag
      FROM public.summaries
      WHERE tags IS NOT NULL
        AND tags != ''
        AND TRIM(BOTH ' ' FROM
          REGEXP_REPLACE(
            TRIM(BOTH '"' FROM
              TRIM(BOTH '''"{}[]' FROM UNNEST(STRING_TO_ARRAY(tags, ',')))
            ),
            '[{}"''\\[\\]]', '', 'g'
          )
        ) != ''
        AND TRIM(BOTH ' ' FROM
          REGEXP_REPLACE(
            TRIM(BOTH '"' FROM
              TRIM(BOTH '''"{}[]' FROM UNNEST(STRING_TO_ARRAY(tags, ',')))
            ),
            '[{}"''\\[\\]]', '', 'g'
          )
        ) IS NOT NULL
    `);

    debugLog('SUMMARIES_API_TAGS', `Raw database result count: ${result.rows.length}`);

    // Additional JavaScript cleaning as backup
    const tags = result.rows
      .map(row => {
        if (row.tag) {
          let cleanTag = row.tag.toString().trim();
          // Remove any remaining problematic characters
          cleanTag = cleanTag.replace(/[{}"'\[\]]/g, '');
          cleanTag = cleanTag.replace(/\s+/g, ' ').trim();
          return cleanTag;
        }
        return '';
      })
      .filter(tag => tag.length > 0 && tag !== 'null' && tag !== 'undefined')
      .sort();

    const uniqueTags = [...new Set(tags)].sort();

    debugLog('SUMMARIES_API_TAGS', `Final clean tags count: ${uniqueTags.length}`);
    res.json(uniqueTags);
  }));  
    
  // Get unified summary by type and ID - handles video, website, and custom summaries
  router.get('/type/:type/:id', asyncHandler(async (req, res) => {
      const { type, id } = req.params;
      
      debugLog('SUMMARIES_API_TYPE_ID', `GET /api/summaries/type/${type}/${id} - Received request`);
      
      // Route based on summary type
      if (type === 'video') {
        // Video summaries stored in public.summaries table
        // FIX: Alias 'name' as 'title' for consistency with frontend expectations
        // FIX: Include 'videoid' field for thumbnail URL generation
        const result = await pool.query(
          `SELECT 
            s.videoid,
            s.videoid AS id,
            COALESCE(s.name, 'Untitled Video') AS title,
            s.name AS original_name,
            s.status,
            s.channel,
            s.description,
            s.summary,
            s.tags,
            s.actionable_takeaways,
            s.notes,
            s.confidence,
            s.cover,
            s.key_insights,
            s.tldr,
            s.other3,
            s.date_created,
            s.date_update,
            i.platform,
            i.url AS video_url,
            i.addedby
          FROM public.summaries s 
          LEFT JOIN public.import i ON s.videoid = $1 
          WHERE s.videoid = $2`,
          [id, id]
        );
        
        if (result.rows.length === 0) {
          debugLog('SUMMARIES_API_TYPE_ID', `GET /api/summaries/type/video/${id} - Not found`);
          return res.status(404).json({ error: 'Video summary not found' });
        }
        
        const row = result.rows[0];
        debugLog('SUMMARIES_API_TYPE_ID', `GET /api/summaries/type/video/${id} - Success`, { videoid: row.videoid, title: row.title });
        return res.json({
          ...row,
          source_type: 'video',
          id: String(row.id)
        });
      } else if (type === 'website') {
        // Website summaries stored in public.summaries_websites table
        const result = await pool.query(
          `SELECT 
            id::TEXT AS id,
            title,
            description,
            tldr,
            url,
            main_url AS channel,
            status,
            type,
            summary,
            key_insights,
            actionable_takeaways,
            notes,
            confidence,
            tags,
            date_created,
            date_update AS last_modified,
            addedby
          FROM public.summaries_websites WHERE id = $1`,
          [id]
        );
        
        if (result.rows.length === 0) {
          debugLog('SUMMARIES_API_TYPE_ID', `GET /api/summaries/type/website/${id} - Not found`);
          return res.status(404).json({ error: 'Website summary not found' });
        }
        
        const row = result.rows[0];
        debugLog('SUMMARIES_API_TYPE_ID', `GET /api/summaries/type/website/${id} - Success`, { id: row.id });
        return res.json({
          ...row,
          source_type: 'website',
          id: String(row.id)
        });
      } else if (type === 'custom') {
        // Custom summaries stored in public.summaries_custom table
        const result = await pool.query(
          `SELECT 
            id::TEXT AS id,
            title,
            description,
            tldr,
            content,
            status,
            tags,
            date_created,
            date_update AS last_modified,
            addedby
          FROM public.summaries_custom WHERE id = $1`,
          [id]
        );
        
        if (result.rows.length === 0) {
          debugLog('SUMMARIES_API_TYPE_ID', `GET /api/summaries/type/custom/${id} - Not found`);
          return res.status(404).json({ error: 'Custom summary not found' });
        }
        
        const row = result.rows[0];
        debugLog('SUMMARIES_API_TYPE_ID', `GET /api/summaries/type/custom/${id} - Success`, { id: row.id });
        return res.json({
          ...row,
          source_type: 'custom',
          id: String(row.id)
        });
      } else {
        debugLog('SUMMARIES_API_TYPE_ID', `Invalid summary type: ${type}`);
        return res.status(400).json({ error: 'Invalid summary type' });
      }
  }));

  // Get video summary by ID (legacy - kept for backward compatibility)
  // FIX: Alias 'name' as 'title' for consistency with frontend expectations
  // FIX: Include 'videoid' field for thumbnail URL generation
  router.get('/:id', asyncHandler(async (req, res) => {
      const { id } = req.params;
      debugLog('SUMMARIES_API_VIDEO_ID', `GET /api/summaries/${id} - Legacy route`);
      
      const result = await pool.query(
        `SELECT 
          s.videoid,
          s.videoid AS id,
          COALESCE(s.name, 'Untitled Video') AS title,
          s.name AS original_name,
          s.status,
          s.channel,
          s.description,
          s.summary,
          s.tags,
          s.actionable_takeaways,
          s.notes,
          s.confidence,
          s.cover,
          s.key_insights,
          s.other2,
          s.other3,
          s.date_created,
          s.date_update,
          i.platform,
          i.url AS video_url,
          i.addedby
        FROM public.summaries s 
        LEFT JOIN public.import i ON s.videoid = $1 
        WHERE s.videoid = $2`,
        [id, id]
      );
      
      if (result.rows.length === 0) {
        debugLog('SUMMARIES_API_VIDEO_ID', `GET /api/summaries/${id} - Not found`);
        return res.status(404).json({ error: 'Summary not found' });
      }
      
      const row = result.rows[0];
      debugLog('SUMMARIES_API_VIDEO_ID', `GET /api/summaries/${id} - Success`, { videoid: row.videoid, title: row.title });
      res.json({
        ...row,
        source_type: 'video',
        id: String(row.id)
      });
  }));

  // ADMIN: Create new summary
  router.post('/', checkAdminRights, asyncHandler(async (req, res) => {  
      const {  
        videoid, url, status, channel, name, description, summary,  
        tags, actionable_takeaways, notes, confidence, cover,
        key_insights, tldr, other3, date_created  
      } = req.body;  
      if (!videoid) {  
        return res.status(400).json({ error: 'Video ID is required' });  
      }  
      const query = `  
        INSERT INTO public.summaries (  
          videoid, url, status, channel, name, description, summary,  
          tags, actionable_takeaways, notes, confidence, cover,  
          key_insights, tldr, other3, date_created, date_update  
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())  
        ON CONFLICT (videoid) DO UPDATE SET  
          url = EXCLUDED.url,  
          status = EXCLUDED.status,  
          channel = EXCLUDED.channel,  
          name = EXCLUDED.name,  
          description = EXCLUDED.description,  
          summary = EXCLUDED.summary,  
          tags = EXCLUDED.tags,  
          actionable_takeaways = EXCLUDED.actionable_takeaways,  
          notes = EXCLUDED.notes,  
          confidence = EXCLUDED.confidence,  
          cover = EXCLUDED.cover,  
          key_insights = EXCLUDED.key_insights,  
          tldr = EXCLUDED.tldr,  
          other3 = EXCLUDED.other3,  
          date_update = NOW()  
        RETURNING *  
      `;  
      const values = [  
        videoid, url || '', status || 'NEW', channel || '', name || '',  
        description || '', summary || '', tags || '', actionable_takeaways || '',  
        notes || '', confidence || null, cover || '', key_insights || '',  
        tldr || '', other3 || '', date_created || new Date()  
      ];  
      const result = await pool.query(query, values);
      res.json({ message: 'Summary saved successfully', summary: result.rows[0] });
  }));
  // ADMIN: Update summary
  router.put('/:id', checkAdminRights, asyncHandler(async (req, res) => {  
      const { id } = req.params;  
      const {  
        url, status, channel, name, description, summary,  
        tags, actionable_takeaways, notes, confidence, cover,  
        key_insights, tldr, other3  
      } = req.body;  
      const query = `  
        UPDATE public.summaries SET  
          url = $1, status = $2, channel = $3, name = $4, description = $5,  
          summary = $6, tags = $7, actionable_takeaways = $8, notes = $9,  
          confidence = $10, cover = $11, key_insights = $12, tldr = $13,  
          other3 = $14, date_update = NOW()  
        WHERE videoid = $15  
        RETURNING *  
      `;  
      const values = [  
        url || '', status || 'NEW', channel || '', name || '',  
        description || '', summary || '', tags || '', actionable_takeaways || '',  
        notes || '', confidence || null, cover || '', key_insights || '',  
        tldr || '', other3 || '', id  
      ];  
      const result = await pool.query(query, values);  
      if (result.rowCount === 0) {  
        return res.status(404).json({ error: 'Summary not found' });  
      }  
      res.json({ message: 'Summary updated successfully', summary: result.rows[0] });
  }));  
    
  // Delete video summary - Owner or Admin
  router.delete('/:id', authenticateApiRequest, asyncHandler(async (req, res) => {
      const { id } = req.params;
      const username = req.user.username;

      debugLog('SUMMARIES_DELETE', `DELETE /api/summaries/${id} - Received request`, {
        username,
        role: req.user.role,
        isAdmin: req.user.isAdmin
      });

      // Get the summary to check ownership
      const summaryResult = await pool.query(
        'SELECT videoid, name, addedby FROM public.summaries WHERE videoid = $1',
        [id]
      );

      if (summaryResult.rowCount === 0) {
        debugLog('SUMMARIES_DELETE', `Summary ${id} not found`);
        return res.status(404).json({ error: 'Summary not found' });
      }

      const summary = summaryResult.rows[0];
      const isOwner = summary.addedby === username;

      debugLog('SUMMARIES_DELETE', 'Ownership check', {
        summaryId: summary.videoid,
        title: summary.name,
        addedBy: summary.addedby,
        currentUsername: username,
        isOwner,
        isAdmin: req.user.isAdmin
      });

      // Check permission: must be admin or owner
      if (!req.user.isAdmin && !isOwner) {
        debugLog('SUMMARIES_DELETE', 'Permission denied', {
          username,
          reason: 'Not admin or owner',
          addedBy: summary.addedby
        });
        return res.status(403).json({
          error: 'Access denied. You can only delete your own summaries.'
        });
      }

      // Delete the summary
      const result = await pool.query('DELETE FROM public.summaries WHERE videoid = $1', [id]);

      // Audit log the deletion
      logAuditEvent('DELETE', 'summaries:video', {
        videoid: id,
        title: summary.name,
        addedby: summary.addedby,
        wasOwner: isOwner,
        wasAdmin: req.user.isAdmin
      }, req.user, req);

      debugLog('SUMMARIES_DELETE', `Summary ${id} deleted successfully`, {
        deletedBy: username,
        wasOwner: isOwner,
        wasAdmin: req.user.isAdmin
      });

      res.json({ message: 'Video summary deleted successfully' });
  }));

  // ADMIN: Update summary status
  router.put('/:id/status', checkAdminRights, asyncHandler(async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;
      if (!status) {
        return res.status(400).json({ error: 'Status is required.' });
      }
      // Validate status values
      const validStatuses = ['NEW', 'PENDING', 'DONE'];
      if (status !== null && !validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status value' });
      }

      // Get old status for audit log
      const oldResult = await pool.query('SELECT videoid, name, status FROM public.summaries WHERE videoid = $1', [id]);
      if (oldResult.rowCount === 0) {
        return res.status(404).json({ error: 'Summary not found' });
      }
      const oldStatus = oldResult.rows[0].status;

      const result = await pool.query(
        'UPDATE public.summaries SET status = $1, date_update = NOW() WHERE videoid = $2 RETURNING *',
        [status, id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Summary not found' });
      }

      // Audit log the status change
      logAuditEvent('UPDATE', 'summaries:video:status', {
        videoid: id,
        title: oldResult.rows[0].name,
        oldStatus,
        newStatus: status
      }, req.user, req);

      res.json({ message: 'Status updated successfully', summary: result.rows[0] });
  }));
  
  return router;  
};