const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const { debugLog, errorLog, isDebugEnabled } = require('../utils/debugUtils');

/**
 * Parse Python debug messages from stderr
 * Python scripts output debug logs in format: [DEBUG] {"component": "...", "message": "...", "data": {...}}
 *
 * @param {string} stderr - Stderr output from Python process
 */
function parsePythonDebugLogs(stderr) {
  if (!isDebugEnabled() || !stderr) {
    return;
  }

  const lines = stderr.split('\n');
  for (const line of lines) {
    const debugIndex = line.indexOf('[DEBUG] ');
    if (debugIndex !== -1) {
      try {
        const jsonStr = line.substring(debugIndex + 8).trim();
        const logEntry = JSON.parse(jsonStr);
        const component = logEntry.component || 'PYTHON';
        const message = logEntry.message;
        const data = logEntry.data;

        if (data !== undefined && data !== null) {
          debugLog(component, message, data);
        } else {
          debugLog(component, message);
        }
      } catch (e) {
        // Not valid JSON, skip
        continue;
      }
    }
  }
}

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
      console.log(`[ytDlpWorker] Auto-upgraded HTTP to HTTPS for secure cookie transmission: ${url} -> ${upgradedUrl}`);
      return upgradedUrl;
    }
  } catch (error) {
    console.error(`[ytDlpWorker] Invalid URL for HTTPS upgrade: ${url}`, error);
  }
  return url;
}

/**
 * YtDlpWorker - YouTube Transcript Extraction with Hybrid Approach
 * 
 * Merged functionality from my-yt-dlp container:
 * 1. Try youtube-transcript-api (fast, no cookies)
 * 2. Get metadata via yt-dlp
 * 3. If step 1 failed, try full yt-dlp extraction with optional cookies
 * 
 * Output: Updates database directly to NEW status (skips FOUND_YTDLP)
 * 
 * Updated 2026-02-21: Removed provider type selection - yt-dlp is now the only provider
 */
class YtDlpWorker {
  constructor(logger) {
    this.logger = logger || console;
    this.config = {};
    this.running = false;
  }

  async loadConfig() {
    this.logger.info('[YtDlpWorker] Loading configuration from database...');
    try {
      const configKeys = [
        'import_checker_interval_minutes',
        'yt_dlp_item_delay_seconds',
        // Proxy configuration keys
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
        'yt_dlp_proxy_enable_https_fallback',
        // Python provider timeout
        'python_provider_timeout_seconds',
        // Failed job retry interval
        'yt_dlp_failed_job_retry_hours'
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
      this.config.import_checker_interval_minutes = parseInt(this.config.import_checker_interval_minutes, 10) || 5;
      this.config.yt_dlp_item_delay_seconds = parseInt(this.config.yt_dlp_item_delay_seconds, 10) || 120;

      // Proxy configuration defaults
      this.config.yt_dlp_proxy_enabled = this.config.yt_dlp_proxy_enabled === 'true' || this.config.yt_dlp_proxy_enabled === true;
      this.config.yt_dlp_proxy_type = this.config.yt_dlp_proxy_type || 'free';
      this.config.yt_dlp_proxy_min_pool_size = parseInt(this.config.yt_dlp_proxy_min_pool_size, 10) || 3;
      this.config.yt_dlp_proxy_pool_size = parseInt(this.config.yt_dlp_proxy_pool_size, 10) || 20;
      this.config.yt_dlp_proxy_max_test_attempts = parseInt(this.config.yt_dlp_proxy_max_test_attempts, 10) || 50;
      this.config.yt_dlp_proxy_max_retries = parseInt(this.config.yt_dlp_proxy_max_retries, 10) || 5;
      this.config.yt_dlp_proxy_min_backoff = parseInt(this.config.yt_dlp_proxy_min_backoff, 10) || 10;
      this.config.yt_dlp_proxy_max_backoff = parseInt(this.config.yt_dlp_proxy_max_backoff, 10) || 60;
      this.config.yt_dlp_proxy_paid_api_key = this.config.yt_dlp_proxy_paid_api_key || '';
      this.config.yt_dlp_proxy_paid_endpoint = this.config.yt_dlp_proxy_paid_endpoint || '';
      this.config.yt_dlp_proxy_enable_https_fallback = this.config.yt_dlp_proxy_enable_https_fallback === 'false' ? false : true;  // default: true
      // Python provider timeout (default: 45 minutes to cover proxy retries)
      this.config.python_provider_timeout_seconds = parseInt(this.config.python_provider_timeout_seconds, 10) || 2700;
      // Failed job retry interval (default: 0 = disabled)
      this.config.yt_dlp_failed_job_retry_hours = parseInt(this.config.yt_dlp_failed_job_retry_hours, 10) || 0;

      this.logger.debug('[YtDlpWorker] Configuration loaded', {
        interval_minutes: this.config.import_checker_interval_minutes,
        item_delay_seconds: this.config.yt_dlp_item_delay_seconds
      });
    } catch (err) {
      this.logger.error('[YtDlpWorker] Failed to load configuration:', err);
    }
  }

  /**
   * Get transcript from Python provider script
   * @param {string} url - YouTube video URL
   * @param {number} timeoutMs - Optional timeout in milliseconds (overrides config)
   * @returns {Promise<Object>} Transcript data object
   */
  async getTranscriptFromProvider(url, timeoutMs = null) {
    return new Promise((resolve, reject) => {
      // Use configured timeout, default to 45 minutes (2700s) to cover proxy retries
      const effectiveTimeout = timeoutMs || (this.config.python_provider_timeout_seconds || 2700) * 1000;

      const pythonScript = path.join(__dirname, 'yt-dlp-provider.py');
      
      // Verify Python script exists
      if (!fs.existsSync(pythonScript)) {
        const error = new Error(`Python script not found: ${pythonScript}`);
        errorLog('YT_DLP_PROVIDER', 'Python script file not found', {
          python_script: pythonScript,
          error: error.message
        });
        return reject(error);
      }

      // Determine paths
      const cookiesPath = '/app/backend/yt-dlp/cookies/cookies.txt';
      const downloadDir = '/app/backend/yt-dlp/downloads';
      
      // Check if cookies file exists
      const cookiesExists = fs.existsSync(cookiesPath);
      
      debugLog('YT_DLP_PROVIDER', 'Calling Python provider script', {
        url: url,
        python_script: pythonScript,
        cookies_path: cookiesPath,
        cookies_exists: cookiesExists,
        download_dir: downloadDir,
        timeout_seconds: effectiveTimeout / 1000
      });

      // Spawn Python process with arguments
      // Always pass all 3 arguments in correct order: url, cookies_path, download_dir
      // Use empty string for cookies_path if not available
      // Auto-upgrade HTTP to HTTPS when cookies are present for secure cookie transmission
      const secureUrl = ensureHttpsWhenUsingCookies(url, cookiesExists);
      const args = [pythonScript, secureUrl, cookiesExists ? cookiesPath : '', downloadDir];

      // Set up environment variables, including proxy configuration if enabled
      const env = { ...process.env };

      // Add proxy configuration to environment if enabled
      if (this.config.yt_dlp_proxy_enabled) {
        env.YT_DLP_PROXY_ENABLED = 'true';
        env.YT_DLP_PROXY_TYPE = this.config.yt_dlp_proxy_type || 'free';
        env.YT_DLP_PROXY_MIN_POOL_SIZE = String(this.config.yt_dlp_proxy_min_pool_size || 3);
        env.YT_DLP_PROXY_POOL_SIZE = String(this.config.yt_dlp_proxy_pool_size || 20);
        env.YT_DLP_PROXY_MAX_TEST_ATTEMPTS = String(this.config.yt_dlp_proxy_max_test_attempts || 50);
        env.YT_DLP_PROXY_MAX_RETRIES = String(this.config.yt_dlp_proxy_max_retries || 5);
        env.YT_DLP_PROXY_MIN_BACKOFF = String(this.config.yt_dlp_proxy_min_backoff || 10);
        env.YT_DLP_PROXY_MAX_BACKOFF = String(this.config.yt_dlp_proxy_max_backoff || 60);

        if (this.config.yt_dlp_proxy_paid_api_key) {
          env.YT_DLP_PROXY_PAID_API_KEY = this.config.yt_dlp_proxy_paid_api_key;
        }
        if (this.config.yt_dlp_proxy_paid_endpoint) {
          env.YT_DLP_PROXY_PAID_ENDPOINT = this.config.yt_dlp_proxy_paid_endpoint;
        }
        env.YT_DLP_PROXY_ENABLE_HTTPS_FALLBACK = String(this.config.yt_dlp_proxy_enable_https_fallback !== false);

        debugLog('YT_DLP_PROVIDER', 'Proxy configuration enabled', {
          proxy_type: env.YT_DLP_PROXY_TYPE,
          pool_size: env.YT_DLP_PROXY_POOL_SIZE
        });
      } else {
        env.YT_DLP_PROXY_ENABLED = 'false';
      }

      const pythonProcess = spawn('python3', args, { env });
      
      let stdout = '';
      let stderr = '';
      let timeout;

      // Set timeout to prevent hanging
      timeout = setTimeout(() => {
        pythonProcess.kill('SIGTERM');
        const error = new Error(`Python provider timeout after ${effectiveTimeout / 1000} seconds`);
        errorLog('YT_DLP_PROVIDER', 'Python provider timed out', {
          url: url,
          timeout_seconds: effectiveTimeout / 1000,
          error: error.message
        });
        reject(error);
      }, effectiveTimeout);

      // Collect stdout (JSON response)
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      // Collect stderr (Python tracebacks and debug logs)
      pythonProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        // Parse and log Python debug messages in real-time
        parsePythonDebugLogs(chunk);
      });

      // Handle process completion
      pythonProcess.on('close', (code) => {
        clearTimeout(timeout);
        
        debugLog('YT_DLP_PROVIDER', 'Python provider completed', {
          url: url,
          exit_code: code,
          stdout_length: stdout.length,
          stderr_length: stderr.length,
          stdout_preview: stdout.substring(0, 200),
          stderr_preview: stderr.substring(0, 200)
        });

        // Try to parse stdout as JSON
        if (stdout && stdout.trim().length > 0) {
          try {
            const response = JSON.parse(stdout.trim());
            
            if (response.success) {
              debugLog('YT_DLP_PROVIDER', 'Python provider returned successful data', {
                url: url,
                method: response.method,
                transcript_length: response.transcript?.length || 0,
                title: response.title,
                channel: response.channel
              });
              return resolve(response);
            } else {
              const error = new Error(response.error || 'Unknown Python provider error');
              errorLog('YT_DLP_PROVIDER', 'Python provider reported failure', {
                url: url,
                error_message: response.error,
                exit_code: code
              });
              return reject(error);
            }
          } catch (parseError) {
            debugLog('YT_DLP_PROVIDER', 'Failed to parse stdout as JSON', {
              url: url,
              parse_error: parseError.message,
              stdout_preview: stdout.substring(0, 200)
            });
            // Fall through to stderr handling
          }
        }

        // Fallback: Use stderr if available
        if (stderr && stderr.trim().length > 0) {
          const error = new Error(`Python provider failed: ${stderr.trim()}`);
          errorLog('YT_DLP_PROVIDER', 'Python provider exited with stderr', {
            url: url,
            exit_code: code,
            stderr_preview: stderr.substring(0, 200)
          });
          return reject(error);
        }

        // No usable output
        const error = new Error(`Python provider failed with exit code ${code} - no output received`);
        errorLog('YT_DLP_PROVIDER', 'Python provider failed with no output', {
          url: url,
          exit_code: code
        });
        reject(error);
      });

      // Handle process errors
      pythonProcess.on('error', (error) => {
        clearTimeout(timeout);
        errorLog('YT_DLP_PROVIDER', 'Python process error', {
          url: url,
          error_message: error.message,
          error_code: error.code
        });
        reject(error);
      });
    });
  }

  async runYtDlpProcessor() {
    this.logger.info('[YtDlpWorker] Running yt-dlp Processor...');
    try {
      // Throttling: Check if any PENDING_YTDLP items exist
      // This prevents claiming more items while one is already being processed
      const pendingCheck = await pool.query(
        "SELECT COUNT(*) FROM public.import WHERE status = 'PENDING_YTDLP' LIMIT 1"
      );

      const pendingCount = parseInt(pendingCheck.rows[0].count, 10);
      if (pendingCount > 0) {
        this.logger.info(`[YtDlpWorker] Throttling: ${pendingCount} PENDING_YTDLP item(s) exist, waiting for current processing to complete`);
        return;
      }

      // Retry failed jobs if interval is configured
      if (this.config.yt_dlp_failed_job_retry_hours > 0) {
        const retryCutoffDate = new Date(Date.now() - (this.config.yt_dlp_failed_job_retry_hours * 60 * 60 * 1000));

        const failedJobsResult = await pool.query(
          `UPDATE public.import
           SET status = 'NEW_YTDLP', date_update = NOW()
           WHERE status = 'FAILED'
           AND date_update < $1
           RETURNING videoid`,
          [retryCutoffDate]
        );

        if (failedJobsResult.rows.length > 0) {
          this.logger.info(`[YtDlpWorker] Retrying ${failedJobsResult.rows.length} failed job(s) (older than ${this.config.yt_dlp_failed_job_retry_hours} hours)`);
          debugLog('YT_DLP_RETRY', 'Failed jobs reset to NEW_YTDLP', {
            count: failedJobsResult.rows.length,
            retry_hours: this.config.yt_dlp_failed_job_retry_hours,
            videoids: failedJobsResult.rows.map(r => r.videoid)
          });
        }
      }

      // Get imports with NEW_YTDLP status
      const result = await pool.query(
        "SELECT * FROM public.import WHERE status = 'NEW_YTDLP' ORDER BY date_import ASC"
      );

      if (result.rows.length === 0) {
        this.logger.debug('[YtDlpWorker] No NEW_YTDLP eligible imports found for processing.');
        return;
      }

      this.logger.info(`[YtDlpWorker] Found ${result.rows.length} NEW_YTDLP records to process`);

      for (let i = 0; i < result.rows.length; i++) {
        const row = result.rows[i];
        const isLastItem = i === result.rows.length - 1;
        
        // Claim the record
        this.logger.info(`[YtDlpWorker] Claiming NEW_YTDLP import ID: ${row.videoid} for processing.`);
        const claimResult = await pool.query(
          "UPDATE public.import SET status = 'PENDING_YTDLP' WHERE videoid = $1 RETURNING *",
          [row.videoid]
        );

        if (claimResult.rows.length === 0) {
          this.logger.warn(`[YtDlpWorker] Import ID ${row.videoid} was claimed by another worker. Skipping.`);
          continue;
        }

        this.logger.info(`[YtDlpWorker] Successfully claimed import ID: ${row.videoid}, status changed to PENDING_YTDLP`);

        // Process with Python provider
        try {
          this.logger.info(`[YtDlpWorker] Processing import ID: ${row.videoid}, URL: ${row.url}`);
          
          // Call Python provider
          const transcriptData = await this.getTranscriptFromProvider(row.url);
          
          this.logger.info('[YtDlpWorker] Transcript data received', {
            videoid: row.videoid,
            url: row.url,
            method: transcriptData.method,
            transcript_length: transcriptData.transcript?.length || 0,
            normalized_length: transcriptData.transcript_normalized?.length || 0,
            title: transcriptData.title,
            channel: transcriptData.channel
          });

          // Check if transcript is empty
          if (!transcriptData.transcript || transcriptData.transcript.length === 0) {
            this.logger.warn(`[YtDlpWorker] Empty transcript for import ID: ${row.videoid}`);
            errorLog('YT_DLP_EMPTY', 'No transcript data extracted from YouTube', {
              videoid: row.videoid,
              url: row.url,
              title: transcriptData.title,
              channel: transcriptData.channel
            });
            
            await pool.query("UPDATE public.import SET status = 'FAILED' WHERE videoid = $1", [row.videoid]);
            this.logger.info(`[YtDlpWorker] Import ID: ${row.videoid} marked as FAILED due to empty transcript`);
            
            // Add delay after processing (even on failure) to avoid rate limiting
            if (!isLastItem && this.config.yt_dlp_item_delay_seconds > 0) {
              this.logger.info(`[YtDlpWorker] Waiting ${this.config.yt_dlp_item_delay_seconds} seconds before next request to prevent YouTube API blocking`);
              await new Promise(resolve => setTimeout(resolve, this.config.yt_dlp_item_delay_seconds * 1000));
            }
            continue;
          }

          // Update import record directly to NEW status
          // This skips FOUND_YTDLP since we have all data already
          debugLog('YT_DLP_STORAGE', 'Storing transcript data in database', {
            videoid: row.videoid,
            transcript_length: transcriptData.transcript.length,
            title: transcriptData.title,
            channel: transcriptData.channel,
            method: transcriptData.method
          });

          await pool.query(
            `UPDATE import SET
              status = 'NEW',
              subtitles = $1,
              transcript_normalized = $2,
              title = COALESCE($3, title),
              channel = COALESCE($4, channel),
              description = COALESCE($5, description),
              date_update = NOW()
             WHERE videoid = $6`,
            [
              transcriptData.transcript,
              transcriptData.transcript_normalized || '',
              transcriptData.title || null,
              transcriptData.channel || null,
              transcriptData.description || null,
              row.videoid
            ]
          );

          // Validate metadata completeness - check if critical fields are missing or empty
          const hasIncompleteMetadata = !transcriptData.title || !transcriptData.channel ||
                                       !transcriptData.description || transcriptData.description.trim() === '';

          if (hasIncompleteMetadata) {
            this.logger.warn(`[YtDlpWorker] Incomplete metadata for import ID: ${row.videoid}`, {
              has_title: !!transcriptData.title,
              has_channel: !!transcriptData.channel,
              has_description: !!(transcriptData.description && transcriptData.description.trim() !== '')
            });

            // Mark as FAILED - existing retry mechanism will reset to NEW_YTDLP after yt_dlp_failed_job_retry_hours
            await pool.query(
              "UPDATE public.import SET status = 'FAILED', date_update = NOW() WHERE videoid = $1",
              [row.videoid]
            );

            this.logger.info(`[YtDlpWorker] Import ID: ${row.videoid} marked as FAILED due to incomplete metadata`);

            // Add delay after processing to avoid rate limiting
            if (!isLastItem && this.config.yt_dlp_item_delay_seconds > 0) {
              this.logger.info(`[YtDlpWorker] Waiting ${this.config.yt_dlp_item_delay_seconds} seconds before next request to prevent YouTube API blocking`);
              await new Promise(resolve => setTimeout(resolve, this.config.yt_dlp_item_delay_seconds * 1000));
            }
            continue;
          }

          this.logger.info(`[YtDlpWorker] Successfully processed transcript for import ID: ${row.videoid}`);
          this.logger.info(`[YtDlpWorker] Import ID: ${row.videoid} status changed from PENDING_YTDLP to NEW (ready for SummarizerWorker)`);

          // Add delay after successful processing to avoid rate limiting
          if (!isLastItem && this.config.yt_dlp_item_delay_seconds > 0) {
            this.logger.info(`[YtDlpWorker] Waiting ${this.config.yt_dlp_item_delay_seconds} seconds before next request to prevent YouTube API blocking`);
            await new Promise(resolve => setTimeout(resolve, this.config.yt_dlp_item_delay_seconds * 1000));
          }

        } catch (err) {
          this.logger.error(`[YtDlpWorker] Error processing import ID ${row.videoid}:`, err);
          this.logger.error('[YtDlpWorker] Error details:', {
            message: err.message,
            stack: err.stack
          });
          
          // Update status to FAILED on error
          this.logger.info(`[YtDlpWorker] Marking import ID: ${row.videoid} as FAILED due to error`);
          await pool.query("UPDATE public.import SET status = 'FAILED' WHERE videoid = $1", [row.videoid]);
          
          // Add delay after error to avoid rate limiting
          if (!isLastItem && this.config.yt_dlp_item_delay_seconds > 0) {
            this.logger.info(`[YtDlpWorker] Waiting ${this.config.yt_dlp_item_delay_seconds} seconds before next request to prevent YouTube API blocking`);
            await new Promise(resolve => setTimeout(resolve, this.config.yt_dlp_item_delay_seconds * 1000));
          }
        }
      }
      
      this.logger.info('[YtDlpWorker] Processor cycle completed');
    } catch (err) {
      this.logger.error('[YtDlpWorker] Error in Processor:', err);
      this.logger.error('[YtDlpWorker] Processor error details:', {
        message: err.message,
        stack: err.stack
      });
    }
  }

  start() {
    this.running = true;
    this.logger.info('[YtDlpWorker] Initializing...');
    
    // Load initial config asynchronously, then schedule cron job
    this.loadConfig()
      .then(() => {
        const intervalMin = this.config.import_checker_interval_minutes || 5;
        this.logger.info(`[YtDlpWorker] Scheduling processor every ${intervalMin} minutes.`);
        
        cron.schedule(`*/${intervalMin} * * * *`, async () => {
          if (this.running) {
            try {
              await this.loadConfig(); // Reload config periodically
              await this.runYtDlpProcessor();
            } catch (scheduleErr) {
              this.logger.error('[YtDlpWorker] Unhandled error in scheduled task:', scheduleErr);
            }
          }
        });
        
        this.logger.info('[YtDlpWorker] Started and tasks scheduled.');
      })
      .catch(err => {
        // Fallback: schedule with default interval if config fails to load
        const intervalMin = 5;
        this.logger.warn(`[YtDlpWorker] Config loading failed, using default interval of ${intervalMin} minutes.`, err);
        
        cron.schedule(`*/${intervalMin} * * * *`, async () => {
          if (this.running) {
            try {
              await this.loadConfig(); // Reload config periodically
              await this.runYtDlpProcessor();
            } catch (scheduleErr) {
              this.logger.error('[YtDlpWorker] Unhandled error in scheduled task:', scheduleErr);
            }
          }
        });
        
        this.logger.info('[YtDlpWorker] Started and tasks scheduled.');
      });
  }

  stop() {
    this.running = false;
    this.logger.info('[YtDlpWorker] Worker stopping...');
  }

  /**
   * Get worker health status for monitoring
   * @returns {Object} Worker health status
   */
  getHealthStatus() {
    return {
      worker_type: 'YtDlpWorker',
      is_running: this.running,
      interval_minutes: this.config.import_checker_interval_minutes || 'NOT_SET',
      item_delay_seconds: this.config.yt_dlp_item_delay_seconds || 'NOT_SET',
      config_loaded: Object.keys(this.config).length > 0
    };
  }
}

module.exports = YtDlpWorker;