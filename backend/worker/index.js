// backend/worker/index.js
/**
 * Dedicated worker entry point
 * Independent worker process with authentication bypass
 * 
 * Updated 2026-02-21: Removed LangChain workers - yt-dlp is now the only provider
 */

// CRITICAL: Import undici configuration FIRST to override 5-minute header timeout
require('../config/undici');

const { Pool } = require('pg');
const { workerConfig, getWorkerMode } = require('../config/worker');
const { sharedAuth } = require('../auth');

// Import worker classes
const SummarizerWorker = require('../workers/summarizerWorker');
const CustomSummarizerWorker = require('../workers/customSummarizerWorker');
const YtDlpWorker = require('../workers/ytDlpWorker');
const PlaylistWorker = require('../workers/playlistWorker');
// DEPRECATED: YtDlpParserWorker - functionality merged into YtDlpWorker
// DEPRECATED: LangChainYoutubeWorker - yt-dlp is now the only provider
// DEPRECATED: LangChainParserWorker - yt-dlp is now the only provider

let db = null;
let isRunning = false;

// Worker instances
let summarizerWorkerInstance = null;
let customSummarizerWorkerInstance = null;
let ytDlpWorkerInstance = null;
let playlistWorkerInstance = null;
// DEPRECATED: ytDlpParserWorkerInstance, langChainYoutubeWorkerInstance, langChainParserWorkerInstance

/**
 * Initialize worker process
 */
async function initializeWorker() {
    try {
        console.log('[WORKER] Initializing worker process...');
        console.log(`[WORKER] Mode: ${getWorkerMode()}`);
        
        // Use shared database connection from config/db
        db = require('../config/db');
        
        // Test database connection
        await testDatabaseConnection();
        
        // Initialize shared auth components (for logging)
        sharedAuth.initialize(db);
        
        console.log('[WORKER] Worker initialized successfully');
        
        // Start worker tasks
        startWorkerTasks();
        
    } catch (error) {
        console.error('[WORKER] Failed to initialize worker:', error);
        process.exit(1);
    }
}

/**
 * Test database connection
 */
async function testDatabaseConnection() {
    try {
        const result = await db.query('SELECT NOW()');
        console.log('[WORKER] Database connection successful');
    } catch (error) {
        console.error('[WORKER] Database connection failed:', error);
        throw error;
    }
}

/**
 * Start all worker tasks
 */
async function startWorkerTasks() {
    if (isRunning) {
        console.log('[WORKER] Worker tasks already running');
        return;
    }
    
    isRunning = true;
    console.log('[WORKER] Starting worker tasks...');
    
    // Initialize worker instances with logger
    const logger = console;
    
    summarizerWorkerInstance = new SummarizerWorker(logger);
    ytDlpWorkerInstance = new YtDlpWorker(logger);
    playlistWorkerInstance = new PlaylistWorker(logger);
    // DEPRECATED: YtDlpParserWorker - functionality merged into YtDlpWorker
    // DEPRECATED: LangChainYoutubeWorker, LangChainParserWorker - yt-dlp is now the only provider
    
    // CustomSummarizerWorker exports a function, not a class
    // It manages its own scheduling and processing
    customSummarizerWorkerInstance = {
        start: () => {
            logger.info('[CustomSummarizerWorker] Starting custom import processor...');
            // CustomSummarizerWorker doesn't have start method, but it processes when called
            logger.info('[CustomSummarizerWorker] Custom import processor ready (function-based)');
        },
        stop: () => {
            logger.info('[CustomSummarizerWorker] Stopping custom import processor...');
        }
    };
    
    // Start class-based workers with individual error handling
    try {
        summarizerWorkerInstance.start();
        console.log('[WORKER] SummarizerWorker started');
    } catch (err) {
        console.error('[WORKER] FAILED to start SummarizerWorker:', err);
    }

    try {
        ytDlpWorkerInstance.start();
        console.log('[WORKER] YtDlpWorker started');
    } catch (err) {
        console.error('[WORKER] FAILED to start YtDlpWorker:', err);
    }

    try {
        playlistWorkerInstance.start();
        console.log('[WORKER] PlaylistWorker started');
    } catch (err) {
        console.error('[WORKER] FAILED to start PlaylistWorker:', err);
    }
    
    // Start function-based CustomSummarizerWorker
    customSummarizerWorkerInstance.start();
    
    console.log('[WORKER] All worker tasks started');
}

/**
 * Graceful shutdown
 */
function gracefulShutdown() {
    console.log('[WORKER] Shutting down gracefully...');
    isRunning = false;
    
    // Stop all worker instances
    if (summarizerWorkerInstance) {
        summarizerWorkerInstance.stop();
    }
    if (customSummarizerWorkerInstance) {
        customSummarizerWorkerInstance.stop();
    }
    if (ytDlpWorkerInstance) {
        ytDlpWorkerInstance.stop();
    }
    if (playlistWorkerInstance) {
        playlistWorkerInstance.stop();
    }
    
    if (db) {
        db.end(() => {
            console.log('[WORKER] Database connection closed');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
}

// Handle process signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('[WORKER] Uncaught exception:', error);
    gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[WORKER] Unhandled rejection at:', promise, 'reason:', reason);
    gracefulShutdown();
});

// Start worker if this file is run directly
if (require.main === module) {
    initializeWorker();
}

module.exports = {
    initializeWorker,
    // Export instances for testing if needed
    getWorkerInstances: () => ({
        summarizerWorkerInstance,
        customSummarizerWorkerInstance,
        ytDlpWorkerInstance,
        playlistWorkerInstance
    })
};
