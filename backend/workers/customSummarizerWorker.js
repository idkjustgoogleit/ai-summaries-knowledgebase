const { Pool } = require('pg');
const openaiSummarizerHelper = require('./openaiSummarizerHelper'); // Re-use existing helper
const { debugLog, errorLog } = require('../utils/debugUtils'); // Import debug utilities
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Helper function to load worker configuration from database
async function loadConfigForWorker() {
    try {
        const configKeys = ['openai_timeout_minutes'];
        const configResult = await pool.query(
            'SELECT key, value FROM public.config WHERE key = ANY($1)',
            [configKeys]
        );
        
        const config = {};
        configResult.rows.forEach(row => {
            try {
                config[row.key] = JSON.parse(row.value);
            } catch (e) {
                config[row.key] = row.value;
            }
        });

        // Set defaults
        config.openai_timeout_minutes = parseInt(config.openai_timeout_minutes, 10) || 30;
        
        debugLog('CUSTOM_SUMMARIZER_WORKER', 'Custom summarizer worker configuration loaded', config);
        return config;
    } catch (error) {
        errorLog('CUSTOM_SUMMARIZER_WORKER', 'Error loading worker configuration, using defaults', error);
        return {
            openai_timeout_minutes: 30
        };
    }
}

async function processCustomImports() {
    console.log('[CustomSummarizerWorker] Checking for new custom imports...');
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Find a 'NEW' custom import
        const selectQuery = `
            SELECT id, title, content, source, other1, addedby
            FROM import_custom
            WHERE status = 'NEW'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED;
        `;
        const result = await client.query(selectQuery);
        const customImport = result.rows[0];

        if (!customImport) {
            console.log('[CustomSummarizerWorker] No new custom imports found.');
            await client.query('COMMIT');
            return;
        }

        console.log(`[CustomSummarizerWorker] Processing custom import ID: ${customImport.id}`);

        // 2. Update status to 'PENDING'
        const updatePendingQuery = `
            UPDATE import_custom
            SET status = 'PENDING', date_update = NOW()
            WHERE id = $1;
        `;
        await client.query(updatePendingQuery, [customImport.id]);
        await client.query('COMMIT'); // Commit the status update immediately

        // --- Summarization Logic ---
        let summaryResult;
        try {
            // Load configuration to pass to summarizeContent method
            const config = await loadConfigForWorker();
            
            // Use the existing openaiSummarizerHelper, passing the content, prompt key, and config
            summaryResult = await openaiSummarizerHelper.summarizeContent(
                customImport.content,
                'custom_summary_system_prompt', // Use the new config key for custom prompt
                config // Pass worker configuration for timeout and API settings
            );

            // Preserve the addedby field from import_custom record, with fallback to 'admin'
            const addedByUser = customImport.addedby && customImport.addedby.trim() !== '' ? customImport.addedby : 'admin';
            debugLog('CUSTOM_SUMMARIZER_WORKER', `Preserving addedby user for custom import ${customImport.id}: ${addedByUser} (original: ${customImport.addedby})`);

            // 3. Insert into summaries_custom table
            const insertSummaryQuery = `
                INSERT INTO summaries_custom (
                    title, content, status, description, tldr, summary,
                    key_insights, actionable_takeaways, notes, confidence, tags, other1, import_id, addedby
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                RETURNING id;
            `;
            const insertSummaryValues = [
                customImport.title,
                customImport.source, 
                'DONE',
                summaryResult.Description,
                summaryResult.TLDR,
                JSON.stringify(summaryResult.Summary),
                JSON.stringify(summaryResult["Key Insights"]),
                JSON.stringify(summaryResult["Actionable Takeaways"]),
                JSON.stringify(summaryResult.Notes),
                summaryResult.Confidence,
                summaryResult.Tags ? JSON.stringify(summaryResult.Tags) : null,
                '/public/android-chrome-512x512.png', // Thumbnail path for custom summaries
                customImport.id,
                addedByUser
            ];
            await pool.query(insertSummaryQuery, insertSummaryValues);

            // 4. Update import_custom status to 'DONE'
            const updateDoneQuery = `
            UPDATE import_custom
            SET status = 'DONE', date_update = NOW()
            WHERE id = $1;
            `;
            await pool.query(updateDoneQuery, [customImport.id]);
            console.log(`[CustomSummarizerWorker] Custom import ID: ${customImport.id} summarized and saved successfully.`);

        } catch (summarizationError) {
            console.error(`[CustomSummarizerWorker] Error summarizing custom import ID ${customImport.id}:`, summarizationError);
            // Update import_custom status to 'FAILED'
            const updateFailedQuery = `
            UPDATE import_custom
            SET status = 'FAILED', date_update = NOW()
            WHERE id = $1;
            `;
            await pool.query(updateFailedQuery, [customImport.id]);
        }

    } catch (error) {
        console.error('[CustomSummarizerWorker] Transaction or worker error:', error);
        if (client) {
            try {
                await client.query('ROLLBACK');
                console.log('[CustomSummarizerWorker] Transaction rolled back.');
            } catch (rollbackError) {
                console.error('[CustomSummarizerWorker] Error during rollback:', rollbackError);
            }
        }
    } finally {
        if (client) client.release();
    }
}

module.exports = {
    processCustomImports
};
