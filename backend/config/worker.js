// backend/config/worker.js
/**
 * Worker-specific configuration
 * Handles configuration for background worker processes
 */

const { authConfig } = require('./auth');

const workerConfig = {
    // Worker mode settings
    appMode: 'WORKER',
    
    // Authentication bypass for worker
    bypassAuthentication: true,
    
    // Database configuration (inherited from main config)
    database: {
        connectionString: process.env.DATABASE_URL,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME
    },
    
    // Worker task configuration
    tasks: {
        // Processing intervals
        summaryProcessorInterval: parseInt(process.env.SUMMARY_PROCESSOR_INTERVAL_MINUTES) || 4,
        itemDelaySeconds: parseInt(process.env.SUMMARY_PROCESSOR_ITEM_DELAY_SECONDS) || 60,
        initialDelaySeconds: parseInt(process.env.SUMMARY_PROCESSOR_DELAY_SECONDS) || 75,
        retryDelaySeconds: parseInt(process.env.SUMMARY_RETRY_DELAY_SECONDS) || 60,
        
        // Concurrency settings
        maxConcurrentTasks: parseInt(process.env.WORKER_MAX_CONCURRENT_TASKS) || 3,
        
        // Error handling
        maxRetries: parseInt(process.env.WORKER_MAX_RETRIES) || 3,
        retryBackoffMultiplier: parseFloat(process.env.WORKER_RETRY_BACKOFF_MULTIPLIER) || 2.0
    },
    
    // Logging configuration
    logging: {
        enabled: true,
        level: process.env.WORKER_LOG_LEVEL || 'info',
        includeTimestamps: true,
        includeMetadata: true
    },
    
    // External service configuration
    services: {
        openai: {
            apiKey: process.env.OPENAI_API_KEY,
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            apiUrl: process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions'
        }
    }
};

/**
 * Validate worker configuration
 * @returns {boolean} True if configuration is valid
 */
function validateWorkerConfig() {
    const errors = [];
    
    // Validate database configuration
    if (!workerConfig.database.connectionString) {
        errors.push('DATABASE_URL is required for worker');
    }
    
    // Validate task configuration
    if (workerConfig.tasks.summaryProcessorInterval < 1) {
        errors.push('SUMMARY_PROCESSOR_INTERVAL_MINUTES must be at least 1');
    }
    
    if (workerConfig.tasks.maxConcurrentTasks < 1) {
        errors.push('WORKER_MAX_CONCURRENT_TASKS must be at least 1');
    }
    
    // Validate service configuration
    // Note: OPENAI_API_KEY is optional - database config takes precedence
    // See loadSummaryAIConfig() in workers/openaiSummarizerHelper.js
    
    if (errors.length > 0) {
        console.error('[WORKER] Configuration validation failed:');
        errors.forEach(error => console.error(`[WORKER] - ${error}`));
        return false;
    }
    
    return true;
}

/**
 * Get worker mode description
 * @returns {string} Worker mode description
 */
function getWorkerMode() {
    return `WORKER (authentication bypassed)`;
}

// Validate configuration on module load
if (!validateWorkerConfig()) {
    throw new Error('Worker configuration validation failed');
}

console.log(`[WORKER] Configuration loaded successfully - Mode: ${getWorkerMode()}`);

module.exports = {
    workerConfig,
    validateWorkerConfig,
    getWorkerMode
};
