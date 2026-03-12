/**
 * PlaylistWorker - YouTube Playlist Sync Worker
 *
 * Periodically checks user-subscribed playlists for new videos
 * and imports them for summarization.
 *
 * Features:
 * - Fetches playlist videos via yt-dlp
 * - Compares against existing imports to avoid duplicates
 * - Limits new videos per sync cycle (configurable)
 * - Logs errors but keeps playlists active (auto-retry on next cycle)
 * - Auto-upgrades HTTP to HTTPS when cookies are present (security)
 * - Logs to Docker logs
 *
 * Created: February 22, 2026
 * Updated: March 2, 2026 - Removed auto-pause, added HTTPS upgrade
 */

const cron = require('node-cron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { debugLog, errorLog } = require('../utils/debugUtils');

/**
 * Upgrade HTTP URL to HTTPS when cookies are present
 * This ensures cookies are always transmitted over a secure connection
 *
 * @param {string} url - The URL to check
 * @param {boolean} hasCookies - Whether cookies are being used
 * @returns {string} - The upgraded URL (or original if no cookies or already HTTPS)
 */
function ensureHttpsWhenUsingCookies(url, hasCookies) {
  if (!hasCookies) {
    return url;
  }

  try {
    const urlObj = new URL(url);
    if (urlObj.protocol === 'http:') {
      urlObj.protocol = 'https:';
      const upgradedUrl = urlObj.toString();
      console.log(`[PlaylistWorker] Auto-upgraded HTTP to HTTPS for secure cookie transmission: ${url} -> ${upgradedUrl}`);
      return upgradedUrl;
    }
  } catch (error) {
    console.error(`[PlaylistWorker] Invalid URL for HTTPS upgrade: ${url}`, error);
  }
  return url;
}

class PlaylistWorker {
  constructor(logger) {
    this.logger = logger || console;
    this.config = {};
    this.running = false;
  }

  /**
   * Load configuration from database
   */
  async loadConfig() {
    this.logger.info('[PlaylistWorker] Loading configuration from database...');
    try {
      const configKeys = [
        'playlist_checker_interval_minutes',
        'playlist_max_new_videos_per_sync'
      ];

      const result = await pool.query(
        'SELECT key, value FROM public.config WHERE key = ANY($1)',
        [configKeys]
      );

      result.rows.forEach(row => {
        try {
          this.config[row.key] = JSON.parse(row.value);
        } catch (e) {
          this.config[row.key] = row.value;
        }
      });

      // Set sensible defaults if not found in DB
      this.config.playlist_checker_interval_minutes = parseInt(this.config.playlist_checker_interval_minutes, 10) || 60;
      this.config.playlist_max_new_videos_per_sync = parseInt(this.config.playlist_max_new_videos_per_sync, 10) || 10;

      this.logger.debug('[PlaylistWorker] Configuration loaded', {
        interval_minutes: this.config.playlist_checker_interval_minutes,
        max_new_videos: this.config.playlist_max_new_videos_per_sync
      });
    } catch (err) {
      this.logger.error('[PlaylistWorker] Failed to load configuration:', err);
      // Use defaults
      this.config.playlist_checker_interval_minutes = 60;
      this.config.playlist_max_new_videos_per_sync = 10;
    }
  }

  /**
   * Fetch playlist videos using yt-dlp with --flat-playlist
   * @param {string} playlistUrl - YouTube playlist URL
   * @returns {Promise<Array>} Array of video objects
   */
  async fetchPlaylistVideos(playlistUrl) {
    // Check if cookies file exists (same location as YtDlpWorker)
    const cookiesPath = path.join(__dirname, '../../cookies.txt');
    const hasCookies = fs.existsSync(cookiesPath);

    // Upgrade to HTTPS if using cookies for security
    const secureUrl = ensureHttpsWhenUsingCookies(playlistUrl, hasCookies);

    return new Promise((resolve, reject) => {
      debugLog('PLAYLIST_WORKER', 'Fetching playlist videos', { playlistUrl, secureUrl, hasCookies });

      const args = [
        '--flat-playlist',
        '--dump-json',
        '--no-warnings',
        '--no-progress'
      ];

      // Add cookies file if exists
      if (hasCookies) {
        args.push('--cookies', cookiesPath);
      }

      args.push(secureUrl);

      const ytDlpProcess = spawn('yt-dlp', args);
      
      let stdout = '';
      let stderr = '';
      let timeout;
      
      // Set timeout to prevent hanging (3 minutes for large playlists)
      timeout = setTimeout(() => {
        ytDlpProcess.kill('SIGTERM');
        reject(new Error('yt-dlp playlist fetch timeout'));
      }, 180000);
      
      ytDlpProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      ytDlpProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ytDlpProcess.on('close', (code) => {
        clearTimeout(timeout);

        if (code !== 0) {
          errorLog('PLAYLIST_WORKER', 'yt-dlp failed', {
            exitCode: code,
            stderr: stderr.substring(0, 500)
          });

          const errorStr = stderr.substring(0, 500);
          return reject(new Error(`yt-dlp failed with code ${code}: ${errorStr.substring(0, 200)}`));
        }
        
        try {
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
              debugLog('PLAYLIST_WORKER', 'Failed to parse video line', { 
                line: line.substring(0, 100) 
              });
            }
          }
          
          debugLog('PLAYLIST_WORKER', 'Successfully fetched playlist videos', {
            count: videos.length
          });
          
          resolve(videos);
        } catch (err) {
          errorLog('PLAYLIST_WORKER', 'Failed to parse yt-dlp output', { error: err.message });
          reject(err);
        }
      });
      
      ytDlpProcess.on('error', (err) => {
        clearTimeout(timeout);
        errorLog('PLAYLIST_WORKER', 'yt-dlp process error', { error: err.message });
        reject(err);
      });
    });
  }

  /**
   * Main playlist processing cycle
   */
  async runPlaylistProcessor() {
    this.logger.info('[PlaylistWorker] Running Playlist Processor...');
    
    try {
      // Get all active playlists
      const playlistsResult = await pool.query(
        "SELECT * FROM public.youtube_playlists WHERE status = 'active' ORDER BY created_at ASC"
      );
      
      if (playlistsResult.rows.length === 0) {
        this.logger.debug('[PlaylistWorker] No active playlists to process.');
        return;
      }
      
      this.logger.info(`[PlaylistWorker] Found ${playlistsResult.rows.length} active playlists to process`);
      
      // Reload config to get latest settings
      await this.loadConfig();
      const maxNewVideos = this.config.playlist_max_new_videos_per_sync;
      
      for (const playlist of playlistsResult.rows) {
        this.logger.info(`[PlaylistWorker] Processing playlist for user: ${playlist.user_username}`, {
          playlist_id: playlist.playlist_id,
          playlist_url: playlist.playlist_url
        });
        
        try {
          // Fetch videos from playlist
          const videos = await this.fetchPlaylistVideos(playlist.playlist_url);
          
          // Update last_checked_at and video_count
          await pool.query(
            `UPDATE public.youtube_playlists 
             SET last_checked_at = NOW(), video_count = $1, updated_at = NOW() 
             WHERE id = $2`,
            [videos.length, playlist.id]
          );
          
          if (videos.length === 0) {
            this.logger.warn(`[PlaylistWorker] Playlist has no videos: ${playlist.playlist_id}`);
            continue;
          }
          
          // Get existing video IDs for this user from import table
          const videoIds = videos.map(v => v.id);
          const existingResult = await pool.query(
            'SELECT videoid FROM public.import WHERE videoid = ANY($1)',
            [videoIds]
          );
          const existingVideoIds = new Set(existingResult.rows.map(r => r.videoid));
          
          // Find new videos (not in import table)
          const newVideos = videos.filter(v => !existingVideoIds.has(v.id));
          
          if (newVideos.length === 0) {
            this.logger.info(`[PlaylistWorker] No new videos found for playlist: ${playlist.playlist_id}`);
            await pool.query(
              `UPDATE public.youtube_playlists
               SET last_sync_at = NOW(), last_error = NULL, updated_at = NOW()
               WHERE id = $1`,
              [playlist.id]
            );
            continue;
          }
          
          this.logger.info(`[PlaylistWorker] Found ${newVideos.length} new videos for playlist: ${playlist.playlist_id}`);
          
          // Limit new videos per sync cycle
          const videosToImport = newVideos.slice(0, maxNewVideos);
          const remainingVideos = newVideos.length - videosToImport.length;
          
          this.logger.info(`[PlaylistWorker] Importing ${videosToImport.length} videos (${remainingVideos} remaining for next sync)`);
          
          // Import new videos
          let importedCount = 0;
          for (const video of videosToImport) {
            try {
              // Insert into import table
              await pool.query(
                `INSERT INTO public.import (videoid, url, title, channel, status, platform, date_import, addedBy)
                 VALUES ($1, $2, $3, $4, 'NEW_YTDLP', 'YouTube', NOW(), $5)
                 ON CONFLICT (videoid) DO NOTHING`,
                [video.id, video.url, video.title, video.channel, playlist.user_username]
              );
              importedCount++;
              debugLog('PLAYLIST_WORKER', 'Imported video', {
                videoId: video.id,
                title: video.title,
                user: playlist.user_username
              });
            } catch (importErr) {
              errorLog('PLAYLIST_WORKER', 'Failed to import video', {
                videoId: video.id,
                error: importErr.message
              });
            }
          }
          
          // Update last_sync_at on success
          await pool.query(
            `UPDATE public.youtube_playlists 
             SET last_sync_at = NOW(), last_error = NULL, updated_at = NOW() 
             WHERE id = $1`,
            [playlist.id]
          );
          
          this.logger.info(`[PlaylistWorker] Successfully imported ${importedCount} videos for playlist: ${playlist.playlist_id}`);
          
          if (remainingVideos > 0) {
            this.logger.info(`[PlaylistWorker] ${remainingVideos} videos remaining for next sync cycle`);
          }
          
        } catch (err) {
          // Error processing playlist - log error but keep playlist active
          errorLog('PLAYLIST_WORKER', 'Error processing playlist', {
            playlist_id: playlist.playlist_id,
            error: err.message
          });

          // Store error but keep playlist active - will retry next scheduled cycle
          await pool.query(
            `UPDATE public.youtube_playlists
             SET last_error = $1, updated_at = NOW()
             WHERE id = $2`,
            [err.message.substring(0, 500), playlist.id]
          );

          this.logger.info(`[PlaylistWorker] Error occurred but playlist ${playlist.playlist_id} remains active - will retry next scheduled cycle`);
          // Continue processing other playlists
          continue;
        }
      }
      
      this.logger.info('[PlaylistWorker] Playlist Processor cycle completed');
      
    } catch (err) {
      this.logger.error('[PlaylistWorker] Error in Playlist Processor:', err);
      this.logger.error('[PlaylistWorker] Processor error details:', {
        message: err.message,
        stack: err.stack
      });
    }
  }

  /**
   * Start the worker
   */
  start() {
    this.running = true;
    this.logger.info('[PlaylistWorker] Initializing...');
    
    // Load initial config asynchronously, then schedule cron job
    this.loadConfig()
      .then(() => {
        const intervalMin = this.config.playlist_checker_interval_minutes || 60;
        this.logger.info(`[PlaylistWorker] Scheduling processor every ${intervalMin} minutes.`);
        
        cron.schedule(`*/${intervalMin} * * * *`, async () => {
          if (this.running) {
            try {
              await this.loadConfig(); // Reload config periodically
              await this.runPlaylistProcessor();
            } catch (scheduleErr) {
              this.logger.error('[PlaylistWorker] Unhandled error in scheduled task:', scheduleErr);
            }
          }
        });
        
        this.logger.info('[PlaylistWorker] Started and tasks scheduled.');
      })
      .catch(err => {
        // Fallback: schedule with default interval if config fails to load
        const intervalMin = 60;
        this.logger.warn(`[PlaylistWorker] Config loading failed, using default interval of ${intervalMin} minutes.`, err);
        
        cron.schedule(`*/${intervalMin} * * * *`, async () => {
          if (this.running) {
            try {
              await this.loadConfig();
              await this.runPlaylistProcessor();
            } catch (scheduleErr) {
              this.logger.error('[PlaylistWorker] Unhandled error in scheduled task:', scheduleErr);
            }
          }
        });
        
        this.logger.info('[PlaylistWorker] Started and tasks scheduled.');
      });
  }

  /**
   * Stop the worker
   */
  stop() {
    this.running = false;
    this.logger.info('[PlaylistWorker] Worker stopping...');
  }

  /**
   * Get worker health status for monitoring
   * @returns {Object} Worker health status
   */
  getHealthStatus() {
    return {
      worker_type: 'PlaylistWorker',
      is_running: this.running,
      interval_minutes: this.config.playlist_checker_interval_minutes || 'NOT_SET',
      max_new_videos_per_sync: this.config.playlist_max_new_videos_per_sync || 'NOT_SET',
      config_loaded: Object.keys(this.config).length > 0
    };
  }
}

module.exports = PlaylistWorker;