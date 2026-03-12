// backend/workers/summarizerWorker.js
const cron = require('node-cron');
const pool = require('../config/db');
const OpenAISummarizerHelper = require('./openaiSummarizerHelper');
const customSummarizerWorker = require('./customSummarizerWorker'); // NEW: Import custom summarizer worker
const { debugLog, errorLog } = require('../utils/debugUtils'); // Import debug utilities
// Make sure ../utils.js exists with extractVideoId function
// const { extractVideoId } = require('../utils'); // Not needed anymore if import checker doesn't parse URLs

class SummarizerWorker {
    constructor(logger) {
        this.logger = logger || console;
        this.config = {};
        this.running = false;
    }

    async loadConfig() {
        this.logger.info('Loading configuration from database...');
        try {
            // --- UPDATE CONFIG KEYS TO INCLUDE WEBSITE PROMPT AND CHUNKING ---
            const configKeys = [
                'import_checker_interval_minutes',
                'summary_processor_interval_minutes',
                'summary_processor_delay_seconds',
                'summary_retry_delay_seconds',
                'summary_processor_item_delay_seconds',
                'openai_timeout_minutes', // <-- ADD THIS KEY
                'summary_system_prompt',
                'website_summary_system_prompt', // <-- ADD THIS KEY
                'custom_summary_system_prompt', // NEW: Add custom summary prompt key
                'enable_chunking', // NEW: Master switch for chunking functionality
                'chunk_overlap_size', // NEW: Overlap between chunks for context continuity
                'chunking_strategy' // NEW: Strategy for breaking content
            ];
            // --- END UPDATE ---

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
            this.config.summary_processor_interval_minutes = parseInt(this.config.summary_processor_interval_minutes, 10) || 4;
            this.config.summary_processor_delay_seconds = parseInt(this.config.summary_processor_delay_seconds, 10) || 75;
            this.config.summary_retry_delay_seconds = parseInt(this.config.summary_retry_delay_seconds, 10) || 60;
            this.config.summary_processor_item_delay_seconds = parseInt(this.config.summary_processor_item_delay_seconds, 10) || 60;
            this.config.openai_timeout_minutes = parseInt(this.config.openai_timeout_minutes, 10) || 3;
            
            // Set defaults for chunking configuration
            this.config.enable_chunking = this.config.enable_chunking !== false; // Default to true
            this.config.max_context_window = parseInt(this.config.max_context_window, 10) || 8000;
            this.config.chunk_overlap_size = parseInt(this.config.chunk_overlap_size, 10) || 500;
            this.config.chunking_strategy = this.config.chunking_strategy || 'simple';

            // this.logger.debug('Configuration loaded:', this.config); // DEBUG ONLY
        } catch (err) {
            this.logger.error('Failed to load configuration:', err);
        }
    }

    /**
     * SEQUENTIAL PROCESSING: Process video summaries one at a time
     * 
     * Design Change (2026-02-22): Modified to fetch and process ONE record at a time
     * instead of fetching all records and looping. This ensures:
     * 1. Strict sequential processing - only one OpenAI API call at a time
     * 2. No concurrent API calls that could overwhelm the endpoint
     * 3. Better transaction safety with FOR UPDATE SKIP LOCKED
     * 4. Clearer logs showing single-record processing
     */
    async runSummaryProcessor() {
        this.logger.info('Running Video Summary Processor (Sequential Mode)...');
        
        // Process records one at a time in a loop
        let recordsProcessed = 0;
        let hasMore = true;
        
        while (hasMore) {
            let client;
            try {
                // Get a dedicated client for this transaction
                client = await pool.connect();
                await client.query('BEGIN');
                
                // FETCH AND CLAIM ONE RECORD ATOMICALLY
                // FOR UPDATE SKIP LOCKED prevents race conditions with multiple workers
                const claimQuery = `
                    SELECT * FROM public.import 
                    WHERE status = 'NEW' 
                    AND transcript_normalized IS NOT NULL 
                    AND title IS NOT NULL 
                    AND description IS NOT NULL 
                    AND channel IS NOT NULL
                    ORDER BY date_import ASC
                    LIMIT 1 
                    FOR UPDATE SKIP LOCKED
                `;
                const claimResult = await client.query(claimQuery);
                
                if (claimResult.rows.length === 0) {
                    // No more records to process
                    hasMore = false;
                    await client.query('COMMIT');
                    client.release();
                    break;
                }
                
                const row = claimResult.rows[0];
                this.logger.info(`[SEQUENTIAL] Claiming NEW video import ID: ${row.videoid} for processing.`);
                
                // Update status to PENDING within the same transaction
                await client.query("UPDATE public.import SET status = 'PENDING' WHERE videoid = $1", [row.videoid]);
                
                // Commit the claim
                await client.query('COMMIT');
                client.release();
                
                this.logger.info(`[SEQUENTIAL] Successfully claimed video import ID ${row.videoid}. Processing...`);
                
                // Initial delay before processing (as per configuration)
                this.logger.info(`[SEQUENTIAL] Delaying initial processing for ${this.config.summary_processor_delay_seconds} seconds...`);
                await new Promise(resolve => setTimeout(resolve, this.config.summary_processor_delay_seconds * 1000));
                
                // Check if summary already exists and is DONE
                const summaryExistsResult = await pool.query(
                    "SELECT count(*) as found FROM public.summaries WHERE videoid = $1 AND status='DONE'",
                    [row.videoid]
                );
                if (parseInt(summaryExistsResult.rows[0].found, 10) > 0) {
                    this.logger.info(`[SEQUENTIAL] Summary for video ID ${row.videoid} already exists. Marking as DONE.`);
                    await pool.query("UPDATE public.import SET status = 'DONE' WHERE videoid = $1", [row.videoid]);
                    recordsProcessed++;
                    // Delay before next record
                    this.logger.info(`[SEQUENTIAL] Delaying before next video item for ${this.config.summary_processor_item_delay_seconds} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, this.config.summary_processor_item_delay_seconds * 1000));
                    continue;
                }

                let summaryData = null;
                let isValid = false;
                let retries = 3;
                
                // Calculate retry delay based on OpenAI timeout to prevent race conditions
                const openaiTimeoutSeconds = this.config.openai_timeout_minutes * 60;
                const retryDelaySeconds = openaiTimeoutSeconds + 30; // Add 30 second buffer
                
                while (!isValid && retries > 0) {
                    try {
                        this.logger.info(`[SEQUENTIAL] Calling OpenAI API for video ID ${row.videoid} (${retries} retries remaining)...`);
                        summaryData = await OpenAISummarizerHelper.getSummary(row, this.config.summary_system_prompt.system_prompt);
                        isValid = OpenAISummarizerHelper.validateSummary(summaryData);
                        if (!isValid) {
                            this.logger.warn(`[SEQUENTIAL] Summary for video ID ${row.videoid} validation failed. Retrying in ${retryDelaySeconds} seconds... (${retries} attempts left)`);
                            await new Promise(resolve => setTimeout(resolve, retryDelaySeconds * 1000));
                            retries--;
                        }
                    } catch (summaryError) {
                        // Check if this is a chunking early termination error
                        if (summaryError.message && summaryError.message.includes('TERMINATING PROCESSING')) {
                            this.logger.error(`[SEQUENTIAL] Chunking failed for video ID ${row.videoid}: ${summaryError.message}`);
                            
                            // Mark as FAILED immediately
                            await pool.query("UPDATE public.import SET status = 'FAILED' WHERE videoid = $1", [row.videoid]);
                            this.logger.error(`[SEQUENTIAL] Video ID ${row.videoid} marked as FAILED due to chunking failure`);
                            
                            // Break out of retry loop, continue to next record
                            break;
                        }
                        
                        // Existing error handling for other types
                        this.logger.error(`[SEQUENTIAL] OpenAI API error for video ID ${row.videoid}:`, summaryError);
                        this.logger.warn(`[SEQUENTIAL] OpenAI API call failed. Retrying in ${retryDelaySeconds} seconds... (${retries} attempts left)`);
                        await new Promise(resolve => setTimeout(resolve, retryDelaySeconds * 1000));
                        retries--;
                    }
                }
                
                if (isValid && summaryData) {
                    this.logger.info(`[SEQUENTIAL] Valid summary data received for video ID ${row.videoid}. Inserting into summaries table.`);
                    try {
                        const now = new Date().toISOString();
                        
                        // Preserve the addedby field from import record, with fallback to 'admin'
                        const addedByUser = row.addedby && row.addedby.trim() !== '' ? row.addedby : 'admin';
                        debugLog('SUMMARIZER_WORKER', `Preserving addedby user for video ${row.videoid}: ${addedByUser} (original: ${row.addedby})`);
                        
                        await pool.query(
                            `INSERT INTO public.summaries (
                                name, url, channel, tldr, description, summary,
                                key_insights, actionable_takeaways, notes, confidence, tags, videoid, status, date_update, addedby
                            ) VALUES (
                                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'DONE', $13, $14
                            )`,
                            [
                                summaryData.Label,
                                row.url,
                                summaryData.Channel || row.channel,
                                summaryData.TLDR,
                                summaryData.Description || row.description,
                                summaryData.Summary,
                                JSON.stringify(summaryData["Key Insights"]),
                                JSON.stringify(summaryData["Actionable Takeaways"]),
                                summaryData.Notes,
                                summaryData.Confidence,
                                JSON.stringify(summaryData.Tags),
                                row.videoid,
                                now,
                                addedByUser
                            ]
                        );
                        await pool.query("UPDATE public.import SET status = 'DONE' WHERE videoid = $1", [row.videoid]);
                        this.logger.info(`[SEQUENTIAL] Successfully processed and saved summary for video ID ${summaryData["Video ID"]}`);
                        recordsProcessed++;
                    } catch (dbErr) {
                        this.logger.error(`[SEQUENTIAL] Database error during video summary insert for video ID ${row.videoid}:`, dbErr);
                        this.logger.error(`[SEQUENTIAL] Full error details:`, {
                            message: dbErr.message,
                            code: dbErr.code,
                            detail: dbErr.detail,
                            constraint: dbErr.constraint,
                            videoid: row.videoid
                        });
                        await pool.query("UPDATE public.import SET status = 'FAILED' WHERE videoid = $1", [row.videoid]);
                    }
                } else {
                    this.logger.error(`[SEQUENTIAL] Failed to get valid summary for video ID ${row.videoid} after retries. Marking import as FAILED.`);
                    await pool.query("UPDATE public.import SET status = 'FAILED' WHERE videoid = $1", [row.videoid]);
                }
                
                // Delay before next record
                this.logger.info(`[SEQUENTIAL] Delaying before next video item for ${this.config.summary_processor_item_delay_seconds} seconds...`);
                await new Promise(resolve => setTimeout(resolve, this.config.summary_processor_item_delay_seconds * 1000));
                
            } catch (err) {
                this.logger.error('[SEQUENTIAL] Error in Video Summary Processor loop:', err);
                if (client) {
                    try {
                        await client.query('ROLLBACK');
                    } catch (rollbackErr) {
                        this.logger.error('[SEQUENTIAL] Error during rollback:', rollbackErr);
                    }
                    try {
                        client.release();
                    } catch (releaseErr) {
                        this.logger.error('[SEQUENTIAL] Error releasing client:', releaseErr);
                    }
                }
                // Continue to next record even on error
            }
        }
        
        this.logger.info(`[SEQUENTIAL] Video Summary Processor completed. Records processed: ${recordsProcessed}`);
    }

    /**
     * SEQUENTIAL PROCESSING: Process website summaries one at a time
     * 
     * Design Change (2026-02-22): Modified to fetch and process ONE record at a time
     * instead of fetching all records and looping. This ensures:
     * 1. Strict sequential processing - only one OpenAI API call at a time
     * 2. No concurrent API calls that could overwhelm the endpoint
     * 3. Better transaction safety with FOR UPDATE SKIP LOCKED
     * 4. Clearer logs showing single-record processing
     */
    async runWebsiteSummaryProcessor() {
        this.logger.info('Running Website Summary Processor (Sequential Mode)...');
        
        // Process records one at a time in a loop
        let recordsProcessed = 0;
        let hasMore = true;
        
        while (hasMore) {
            let client;
            try {
                // Get a dedicated client for this transaction
                client = await pool.connect();
                await client.query('BEGIN');
                
                // FETCH AND CLAIM ONE RECORD ATOMICALLY
                // FOR UPDATE SKIP LOCKED prevents race conditions with multiple workers
                const claimQuery = `
                    SELECT * FROM public.summaries_websites 
                    WHERE status = 'NEW' 
                    ORDER BY date_created ASC
                    LIMIT 1 
                    FOR UPDATE SKIP LOCKED
                `;
                const claimResult = await client.query(claimQuery);
                
                if (claimResult.rows.length === 0) {
                    // No more records to process
                    hasMore = false;
                    await client.query('COMMIT');
                    client.release();
                    break;
                }
                
                const row = claimResult.rows[0];
                this.logger.info(`[SEQUENTIAL] Claiming NEW website record ID: ${row.id} (URL: ${row.url}) for processing.`);
                
                // Update status to PENDING within the same transaction
                await client.query("UPDATE public.summaries_websites SET status = 'PENDING' WHERE id = $1", [row.id]);
                
                // Commit the claim
                await client.query('COMMIT');
                client.release();
                
                this.logger.info(`[SEQUENTIAL] Successfully claimed website record ID ${row.id}. Processing...`);
                
                // Initial delay before processing (as per configuration)
                this.logger.info(`[SEQUENTIAL] Delaying initial processing for ${this.config.summary_processor_delay_seconds} seconds...`);
                await new Promise(resolve => setTimeout(resolve, this.config.summary_processor_delay_seconds * 1000));

                // --- PREPARE FOR WEBSITE SUMMARY CALL ---
                let summaryData = null;
                let isValid = false;
                let retries = 3;

                while (!isValid && retries > 0) {
                    try {
                        this.logger.info(`[SEQUENTIAL] Calling OpenAI API for website URL ${row.url} (${retries} retries remaining)...`);
                        // --- CALL NEW HELPER METHOD FOR WEBSITES ---
                        // Pass the full row (contains url), the website prompt, and worker config
                        summaryData = await OpenAISummarizerHelper.getWebsiteSummary(row, this.config.website_summary_system_prompt?.system_prompt, this.config);
                        
                        // --- VALIDATE USING NEW WEBSITE SCHEMA ---
                        isValid = OpenAISummarizerHelper.validateWebsiteSummary(summaryData);
                        
                        if (!isValid) {
                            this.logger.warn(`[SEQUENTIAL] Website summary for URL ${row.url} (ID: ${row.id}) validation failed. Retrying in ${this.config.summary_retry_delay_seconds} seconds... (${retries} attempts left)`);
                            await new Promise(resolve => setTimeout(resolve, this.config.summary_retry_delay_seconds * 1000));
                            retries--;
                        }
                    } catch (openaiErr) {
                        this.logger.error(`[SEQUENTIAL] OpenAI API error for website URL ${row.url} (ID: ${row.id}):`, openaiErr);
                        this.logger.warn(`[SEQUENTIAL] OpenAI API call failed. Retrying in ${this.config.summary_retry_delay_seconds} seconds... (${retries} attempts left)`);
                        await new Promise(resolve => setTimeout(resolve, this.config.summary_retry_delay_seconds * 1000));
                        retries--;
                    }
                }

                // --- HANDLE SUCCESS OR FAILURE ---
                if (isValid && summaryData) {
                    this.logger.info(`[SEQUENTIAL] Valid website summary data received for URL ${row.url} (ID: ${row.id}). Updating database record.`);
                    try {
                        const now = new Date().toISOString();

                        // --- UPDATE THE EXISTING RECORD AND PREPARE DATA FOR JSONB FIELDS ---
                        // Ensure these fields are valid JSON before sending to DB
                        let finalTags = null;
                        let finalSummary = null;
                        let finalKeyInsights = null;
                        let finalActionableTakeaways = null;
                        let finalNotes = null; // Explicitly initialize

                        try {
                            // Tags
                            if (Array.isArray(summaryData.Tags)) {
                                finalTags = JSON.stringify(summaryData.Tags);
                            } else if (typeof summaryData.Tags === 'string' && summaryData.Tags) {
                                // If AI returned a string and it's not empty, wrap in array or treat as single-item array string?
                                // Based on your prompt, Tags should be array. Log a warning and store as string array.
                                this.logger.warn(`Website summary ID ${row.id}: Tags field was a string, converting to array. Value: ${summaryData.Tags}`);
                                finalTags = JSON.stringify([summaryData.Tags]); // Treat as single-item array
                            } else {
                                this.logger.warn(`Website summary ID ${row.id}: Tags field is invalid, storing empty array.`);
                                finalTags = JSON.stringify([]);
                            }

                            // Summary
                            if (Array.isArray(summaryData.Summary)) {
                                finalSummary = JSON.stringify(summaryData.Summary);
                            } else {
                                this.logger.warn(`Website summary ID ${row.id}: Summary field is not an array. Value type: ${typeof summaryData.Summary}. Storing as empty array.`);
                                finalSummary = JSON.stringify([]);
                            }

                            // Key Insights
                            if (Array.isArray(summaryData["Key Insights"])) {
                                finalKeyInsights = JSON.stringify(summaryData["Key Insights"]);
                            } else {
                                this.logger.warn(`Website summary ID ${row.id}: Key Insights field is not an array. Storing empty array.`);
                                finalKeyInsights = JSON.stringify([]);
                            }

                            // Actionable Takeaways
                            if (Array.isArray(summaryData["Actionable Takeaways"])) {
                                finalActionableTakeaways = JSON.stringify(summaryData["Actionable Takeaways"]);
                            } else {
                                this.logger.warn(`Website summary ID ${row.id}: Actionable Takeaways field is not an array. Storing empty array.`);
                                finalActionableTakeaways = JSON.stringify([]);
                            }

                            // Notes - This is the main culprit
                            // The AI returned "no notes". We need valid JSON.
                            const rawNotes = summaryData.Notes;
                            if (rawNotes === null || rawNotes === undefined || rawNotes === '' || (typeof rawNotes === 'string' && rawNotes.trim().toLowerCase() === 'no notes')) {
                                // If explicitly "no notes" or empty, store an empty string or empty array as valid JSON
                                this.logger.debug(`Website summary ID ${row.id}: Notes field is empty/'no notes'. Storing empty string as valid JSON.`);
                                finalNotes = JSON.stringify(""); // or JSON.stringify([]) if you prefer
                            } else if (typeof rawNotes === 'string') {
                                // It's a string, wrap it. It could also be valid JSON string, but let's be safe.
                                finalNotes = JSON.stringify(rawNotes);
                            } else if (Array.isArray(rawNotes)) {
                                // It's already an array, should be fine.
                                finalNotes = JSON.stringify(rawNotes);
                            } else {
                                // It's an object or something else? Stringify it.
                                this.logger.warn(`Website summary ID ${row.id}: Notes field is an object or unexpected type. Stringifying.`);
                                finalNotes = JSON.stringify(rawNotes);
                            }

                        } catch (prepError) {
                            this.logger.error(`Website summary ID ${row.id}: Error preparing JSONB fields:`, prepError);
                            // Fallback to storing empty strings/arrays
                            finalTags = JSON.stringify([]);
                            finalSummary = JSON.stringify([]);
                            finalKeyInsights = JSON.stringify([]);
                            finalActionableTakeaways = JSON.stringify([]);
                            finalNotes = JSON.stringify(""); // Fallback for notes
                        }
                        // --- END DATA PREPARATION ---

                        // Preserve the addedby field from website record, with fallback to 'admin'
                        const addedByUser = row.addedby && row.addedby.trim() !== '' ? row.addedby : 'admin';
                        debugLog('SUMMARIZER_WORKER', `Preserving addedby user for website ${row.id}: ${addedByUser} (original: ${row.addedby})`);
                        
                        // --- UPDATE THE EXISTING RECORD WITH VALIDATED JSON ---
                        await pool.query(
                            `UPDATE public.summaries_websites SET
                                title = $1, main_url = $2, type = $3, tldr = $4,
                                description = $5, summary = $6, key_insights = $7,
                                actionable_takeaways = $8, notes = $9, confidence = $10,
                                tags = $11, status = 'DONE', date_update = $12, addedby = $13
                            WHERE id = $14`,
                            [
                                summaryData.Title,
                                summaryData.Mainpaige,
                                summaryData.Type,
                                summaryData.TLDR,
                                summaryData.Description,
                                finalSummary, // <-- Use processed JSON string
                                finalKeyInsights, // <-- Use processed JSON string
                                finalActionableTakeaways, // <-- Use processed JSON string
                                finalNotes, // <-- FIXED: Now a valid JSON *string*
                                summaryData.Confidence,
                                finalTags, // <-- Use processed JSON string
                                now,
                                addedByUser,
                                row.id
                            ]
                        );
                        this.logger.info(`[SEQUENTIAL] Successfully updated website summary record ID ${row.id}.`);
                        recordsProcessed++;
                    } catch (dbErr) {
                        this.logger.error(`[SEQUENTIAL] Database error updating website summary record ID ${row.id}:`, dbErr);
                        await pool.query(
                            "UPDATE public.summaries_websites SET status = 'FAILED', notes = $1 WHERE id = $2",
                            [JSON.stringify(["Database Error: " + dbErr.message]), row.id]
                        );
                    }
                } else {
                    this.logger.error(`[SEQUENTIAL] Failed to get valid website summary for URL ${row.url} (ID: ${row.id}) after retries. Marking as FAILED.`);
                    const errorMessage = "Failed to generate valid summary after retries.";
                    await pool.query(
                        "UPDATE public.summaries_websites SET status = 'FAILED', notes = $1 WHERE id = $2",
                        [JSON.stringify([errorMessage]), row.id]
                    );
                }
                // --- END HANDLE SUCCESS/FAILURE ---

                // Delay before next record
                this.logger.info(`[SEQUENTIAL] Delaying before next website item for ${this.config.summary_processor_item_delay_seconds} seconds...`);
                await new Promise(resolve => setTimeout(resolve, this.config.summary_processor_item_delay_seconds * 1000));
                
            } catch (err) {
                this.logger.error('[SEQUENTIAL] Error in Website Summary Processor loop:', err);
                if (client) {
                    try {
                        await client.query('ROLLBACK');
                    } catch (rollbackErr) {
                        this.logger.error('[SEQUENTIAL] Error during rollback:', rollbackErr);
                    }
                    try {
                        client.release();
                    } catch (releaseErr) {
                        this.logger.error('[SEQUENTIAL] Error releasing client:', releaseErr);
                    }
                }
                // Continue to next record even on error
            }
        }
        
        this.logger.info(`[SEQUENTIAL] Website Summary Processor completed. Records processed: ${recordsProcessed}`);
    }
    // --- END SEQUENTIAL WEBSITE PROCESSOR METHOD ---

    start() {
        this.running = true;
        this.processing = false;  // Add execution guard
        this.logger.info('Summarizer Worker initializing...');

        // Load initial config
        this.loadConfig().catch(err => this.logger.error('Initial config load failed:', err));

        // --- SCHEDULE COMBINED PROCESSOR (VIDEO + WEBSITE) ---
        const summaryIntervalMin = this.config.summary_processor_interval_minutes || 4;
        this.logger.info(`Scheduling combined Processor (Video then Website) every ${summaryIntervalMin} minutes.`);
        cron.schedule(`*/${summaryIntervalMin} * * * *`, async () => {
            if (this.running) {
                try {
                    // Add execution guard to prevent overlapping runs
                    if (this.processing) {
                        this.logger.info('Processing already in progress, skipping this scheduled run.');
                        return;
                    }
                    this.processing = true;
                    
                    await this.loadConfig(); // Reload config once per cycle
                    this.logger.info('--- Starting Processing Cycle ---');
                    await this.runSummaryProcessor(); // 1. Process Videos
                    this.logger.info('--- Video Processing Complete, Starting Website Processing ---');
                    await this.runWebsiteSummaryProcessor(); // 2. Process Websites afterwards
                    this.logger.info('--- Website Processing Complete, Starting Custom Summaries Processing ---');
                    await customSummarizerWorker.processCustomImports(); // 3. Process Custom Imports afterwards
                    this.logger.info('--- Custom Summaries Processing Complete ---');
                } catch (scheduleErr) {
                    this.logger.error('Unhandled error in combined Processor schedule:', scheduleErr);
                } finally {
                    // Always reset processing flag
                    this.processing = false;
                }
            }
        });
        // --- END SCHEDULING ---

        this.logger.info('Summarizer Worker started and tasks scheduled.');
    }

    stop() {
        this.running = false;
        this.logger.info('Summarizer Worker stopping.');
    }
}

module.exports = SummarizerWorker;
