/**
 * Playlist Routes
 * YouTube Playlist subscription management for users
 * 
 * Endpoints:
 * - GET /api/playlist - Get current user's playlist
 * - POST /api/playlist - Add/update user's playlist
 * - DELETE /api/playlist - Delete user's playlist
 * - GET /api/playlist/videos - Preview playlist videos with import status
 * - PUT /api/playlist/status - Update playlist status (pause/resume)
 */

const express = require('express');
const { spawn } = require('child_process');
const authenticateApiRequest = require('../middleware/apiAuthMiddleware');
const { getCurrentUsername } = require('../utils/userUtils');
const { debugLog, errorLog } = require('../utils/debugUtils');
const asyncHandler = require('../middleware/asyncHandler');
const { logAuditEvent } = require('../auth/shared');

module.exports = function(pool) {
  const router = express.Router();

  // Protect all routes with authentication
  router.use(authenticateApiRequest);

  /**
   * Extract YouTube playlist ID from URL
   * Supports formats:
   * - https://www.youtube.com/playlist?list=PLAYLIST_ID
   * - https://www.youtube.com/watch?v=VIDEO_ID&list=PLAYLIST_ID
   * - https://youtube.com/playlist?list=PLAYLIST_ID
   */
  function extractPlaylistId(url) {
    if (!url) return null;
    
    // Match playlist ID from various YouTube URL formats
    const patterns = [
      /[?&]list=([a-zA-Z0-9_-]+)/,  // Standard playlist parameter
      /^([a-zA-Z0-9_-]+)$/           // Direct playlist ID
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    return null;
  }

  /**
   * Fetch playlist videos using yt-dlp
   * Returns array of video objects with id, title, channel, url
   */
  async function fetchPlaylistVideos(playlistUrl) {
    return new Promise((resolve, reject) => {
      debugLog('PLAYLIST_FETCH', 'Fetching playlist videos', { playlistUrl });
      
      // Use yt-dlp with --flat-playlist to get video list without downloading
      const args = [
        '--flat-playlist',
        '--dump-json',
        '--no-warnings',
        '--no-progress',
        playlistUrl
      ];
      
      const ytDlpProcess = spawn('yt-dlp', args);
      
      let stdout = '';
      let stderr = '';
      let timeout;
      
      // Set timeout to prevent hanging (2 minutes)
      timeout = setTimeout(() => {
        ytDlpProcess.kill('SIGTERM');
        reject(new Error('yt-dlp playlist fetch timeout'));
      }, 120000);
      
      ytDlpProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      ytDlpProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ytDlpProcess.on('close', (code) => {
        clearTimeout(timeout);
        
        if (code !== 0) {
          errorLog('PLAYLIST_FETCH', 'yt-dlp failed', {
            exitCode: code,
            stderr: stderr.substring(0, 500)
          });
          return reject(new Error(`yt-dlp failed with code ${code}: ${stderr.substring(0, 200)}`));
        }
        
        try {
          // Parse JSON lines (one JSON object per video)
          const videos = [];
          const lines = stdout.trim().split('\n');
          
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const video = JSON.parse(line);
              videos.push({
                id: video.id,
                title: video.title || 'Unknown Title',
                channel: video.channel || video.uploader || 'Unknown Channel',
                url: video.url || `https://www.youtube.com/watch?v=${video.id}`,
                duration: video.duration || 0
              });
            } catch (parseErr) {
              debugLog('PLAYLIST_FETCH', 'Failed to parse video line', { line: line.substring(0, 100) });
            }
          }
          
          debugLog('PLAYLIST_FETCH', 'Successfully fetched playlist videos', {
            count: videos.length
          });
          
          resolve(videos);
        } catch (err) {
          errorLog('PLAYLIST_FETCH', 'Failed to parse yt-dlp output', { error: err.message });
          reject(err);
        }
      });
      
      ytDlpProcess.on('error', (err) => {
        clearTimeout(timeout);
        errorLog('PLAYLIST_FETCH', 'yt-dlp process error', { error: err.message });
        reject(err);
      });
    });
  }

  /**
   * GET /api/playlist
   * Get current user's playlist
   */
  router.get('/', asyncHandler(async (req, res) => {
    const username = getCurrentUsername(req);
    debugLog('PLAYLIST', `Getting playlist for user: ${username}`);

    const result = await pool.query(
      'SELECT * FROM public.youtube_playlists WHERE user_username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.json(null);
    }

    res.json(result.rows[0]);
  }));

  /**
   * POST /api/playlist
   * Add or update user's playlist
   * Body: { playlist_url: string }
   */
  router.post('/', asyncHandler(async (req, res) => {
    const { playlist_url } = req.body;

    if (!playlist_url || !playlist_url.trim()) {
      return res.status(400).json({ error: 'Playlist URL is required' });
    }

    const username = getCurrentUsername(req);
    const playlistId = extractPlaylistId(playlist_url);

    if (!playlistId) {
      return res.status(400).json({ error: 'Invalid YouTube playlist URL. Please provide a valid playlist URL.' });
    }

    debugLog('PLAYLIST', `Adding playlist for user: ${username}`, {
      playlist_url,
      playlistId
    });

    // Fetch playlist info to get title and video count
    let playlistTitle = null;
    let videoCount = 0;

    try {
      const videos = await fetchPlaylistVideos(playlist_url);
      videoCount = videos.length;
      // Try to get playlist title from first video or use generic
      if (videos.length > 0) {
        playlistTitle = `YouTube Playlist (${videos.length} videos)`;
      }
    } catch (fetchErr) {
      debugLog('PLAYLIST', 'Could not fetch playlist info, storing anyway', {
        error: fetchErr.message
      });
      // Continue without title - worker will update it
    }

    // Insert or update playlist (upsert)
    const query = `
      INSERT INTO public.youtube_playlists
        (user_username, playlist_url, playlist_id, playlist_title, video_count, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW())
      ON CONFLICT (user_username) DO UPDATE SET
        playlist_url = EXCLUDED.playlist_url,
        playlist_id = EXCLUDED.playlist_id,
        playlist_title = EXCLUDED.playlist_title,
        video_count = EXCLUDED.video_count,
        status = 'active',
        last_error = NULL,
        updated_at = NOW()
      RETURNING *
    `;

    const result = await pool.query(query, [
      username,
      playlist_url.trim(),
      playlistId,
      playlistTitle,
      videoCount
    ]);

    debugLog('PLAYLIST', `Playlist saved for user: ${username}`, {
      playlistId,
      videoCount
    });

    // Audit log playlist creation
    logAuditEvent('CREATE', 'playlist', {
      playlistId,
      videoCount,
      playlistUrl: playlist_url
    }, req.user, req);

    res.json({
      message: 'Playlist added successfully',
      playlist: result.rows[0]
    });
  }));

  /**
   * DELETE /api/playlist
   * Delete user's playlist
   */
  router.delete('/', asyncHandler(async (req, res) => {
    const username = getCurrentUsername(req);
    debugLog('PLAYLIST', `Deleting playlist for user: ${username}`);

    const result = await pool.query(
      'DELETE FROM public.youtube_playlists WHERE user_username = $1 RETURNING *',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No playlist found to delete' });
    }

    // Audit log playlist deletion
    logAuditEvent('DELETE', 'playlist', {
      playlistId: result.rows[0].playlist_id,
      videoCount: result.rows[0].video_count
    }, req.user, req);

    res.json({
      message: 'Playlist deleted successfully',
      playlist: result.rows[0]
    });
  }));

  /**
   * PUT /api/playlist/status
   * Update playlist status (pause/resume/retry)
   * Body: { status: 'active' | 'paused' }
   */
  router.put('/status', asyncHandler(async (req, res) => {
    const { status } = req.body;

    if (!status || !['active', 'paused'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be "active" or "paused".' });
    }

    const username = getCurrentUsername(req);
    debugLog('PLAYLIST', `Updating playlist status for user: ${username}`, { status });

    const result = await pool.query(
      `UPDATE public.youtube_playlists
       SET status = $1, last_error = NULL, updated_at = NOW()
       WHERE user_username = $2
       RETURNING *`,
      [status, username]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No playlist found' });
    }

    // Audit log playlist status change
    logAuditEvent('UPDATE', 'playlist:status', {
      playlistId: result.rows[0].playlist_id,
      newStatus: status
    }, req.user, req);

    res.json({
      message: `Playlist ${status === 'active' ? 'resumed' : 'paused'} successfully`,
      playlist: result.rows[0]
    });
  }));

  /**
   * GET /api/playlist/videos
   * Preview playlist videos with import status
   * Shows which videos are already imported vs new
   */
  router.get('/videos', asyncHandler(async (req, res) => {
    const username = getCurrentUsername(req);
    debugLog('PLAYLIST', `Getting playlist videos for user: ${username}`);

    // Get user's playlist
    const playlistResult = await pool.query(
      'SELECT * FROM public.youtube_playlists WHERE user_username = $1',
      [username]
    );

    if (playlistResult.rows.length === 0) {
      return res.json({ playlist: null, videos: [] });
    }

    const playlist = playlistResult.rows[0];

    // Fetch videos from playlist
    let videos = [];
    try {
      videos = await fetchPlaylistVideos(playlist.playlist_url);
    } catch (fetchErr) {
      errorLog('PLAYLIST_VIDEOS', 'Failed to fetch playlist videos', {
        error: fetchErr.message,
        playlistId: playlist.playlist_id
      });
      return res.status(500).json({
        error: 'Failed to fetch playlist videos. The playlist may be private or unavailable.',
        playlist: playlist
      });
    }

    // Get video IDs that are already in import table
    const videoIds = videos.map(v => v.id);

    if (videoIds.length === 0) {
      return res.json({ playlist, videos: [] });
    }

    // Check which videos are already imported
    const existingResult = await pool.query(
      'SELECT videoid FROM public.import WHERE videoid = ANY($1)',
      [videoIds]
    );

    const existingVideoIds = new Set(existingResult.rows.map(r => r.videoid));

    // Mark videos as already imported or new
    const videosWithStatus = videos.map(video => ({
      ...video,
      already_imported: existingVideoIds.has(video.id)
    }));

    debugLog('PLAYLIST_VIDEOS', 'Returning videos with import status', {
      total: videos.length,
      already_imported: videosWithStatus.filter(v => v.already_imported).length,
      new: videosWithStatus.filter(v => !v.already_imported).length
    });

    res.json({
      playlist,
      videos: videosWithStatus
    });
  }));

  return router;
};