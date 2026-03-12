// backend/workers/openaiSummarizerHelper.js
const { Pool } = require('pg'); // Import Pool for database access
const { debugLog, errorLog, isDebugEnabled } = require('../utils/debugUtils'); // Import debug utilities
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

/**
 * Ensure API URL includes /chat/completions path
 * Mirrors the ensurePublicAIEndpoint function from chat.js
 * @param {string} url - The API URL
 * @returns {string} URL with /chat/completions path
 */
function ensureChatCompletionsPath(url) {
    if (!url) return url;
    const normalizedUrl = url.trim();
    if (normalizedUrl.endsWith('/chat/completions')) {
        return normalizedUrl;
    }
    return normalizedUrl.endsWith('/')
        ? `${normalizedUrl}chat/completions`
        : `${normalizedUrl}/chat/completions`;
}

class OpenAISummarizerHelper {
    /**
     * Analyze content for debugging and sizing
     * @param {string} content - The content to analyze
     * @returns {Object} Content analysis metrics
     */
    static analyzeContent(content) {
        const analysis = {
            characterCount: content.length,
            lineCount: content.split('\n').length,
            wordCount: content.split(/\s+/).filter(word => word.length > 0).length,
            estimatedTokens: Math.ceil(content.length / 4), // Rough estimate: 1 token ≈ 4 characters
            hasSpecialChars: /[^\w\s\n\r\t.,!?;:'"-]/.test(content),
            preview: {
                first: content.substring(0, 200),
                last: content.substring(content.length - 200)
            },
            sizeCategory: this.categorizeContentSize(content.length)
        };
        return analysis;
    }

    /**
     * Categorize content size for debugging
     * @param {number} characterCount - Number of characters
     * @returns {string} Size category
     */
    static categorizeContentSize(characterCount) {
        if (characterCount < 10000) return 'SMALL';
        if (characterCount < 50000) return 'MEDIUM';
        if (characterCount < 200000) return 'LARGE';
        if (characterCount < 1000000) return 'VERY_LARGE';
        return 'MASSIVE';
    }

    /**
     * Determine if content should be chunked based on configuration
     * @param {Object} contentAnalysis - Content analysis from analyzeContent()
     * @param {Object} config - Configuration object
     * @returns {boolean} Whether to chunk content
     */
    static shouldChunkContent(contentAnalysis, config) {
        if (!config.enable_chunking) {
            debugLog('CHUNKING', 'Chunking disabled in configuration', {
                enable_chunking: config.enable_chunking,
                contentSize: contentAnalysis.characterCount
            });
            return false;
        }

        // Use max_context_window as the token limit for chunking decisions
        const maxContextWindow = config.max_context_window;
        
        // Use token count as primary decision factor for better alignment with OpenAI limits
        const shouldChunkByTokens = contentAnalysis.estimatedTokens > maxContextWindow;
        // Use character-based check as secondary factor (rough conversion: 1 token ≈ 4 characters)
        const shouldChunkByChars = contentAnalysis.characterCount > (maxContextWindow * 4);
        const shouldChunk = shouldChunkByTokens || shouldChunkByChars;
        
        // Determine primary reason for chunking decision
        const primaryReason = shouldChunkByTokens ? 'Token limit exceeded' : 'Character limit exceeded';
        
        debugLog('CHUNKING', 'Chunking decision made', {
            enable_chunking: config.enable_chunking,
            contentSize: contentAnalysis.characterCount,
            estimatedTokens: contentAnalysis.estimatedTokens,
            maxContextWindow: maxContextWindow,
            shouldChunk: shouldChunk,
            decision: primaryReason,
            tokenBasedDecision: shouldChunkByTokens,
            characterBasedDecision: shouldChunkByChars
        });

        return shouldChunk;
    }

    /**
     * Create content chunks based on configuration
     * @param {string} content - Full content to chunk
     * @param {Object} config - Configuration object
     * @returns {Array} Array of content chunks
     */
    static createContentChunks(content, config) {
        // Use max_context_window converted to characters (1 token ≈ 4 characters) for chunking
        const maxChunkSize = config.max_context_window * 4;
        const overlapSize = config.chunk_overlap_size || 500;
        const strategy = config.chunking_strategy || 'simple';
        const maxChunks = config.max_chunks || 10; // Safety limit to prevent memory issues

        debugLog('CHUNKING', 'Creating content chunks', {
            contentLength: content.length,
            maxChunkSize: maxChunkSize,
            maxContextWindow: config.max_context_window,
            overlapSize: overlapSize,
            strategy: strategy,
            maxChunks: maxChunks
        });

        if (strategy === 'simple') {
            return this.createSimpleChunks(content, maxChunkSize, overlapSize, maxChunks);
        } else if (strategy === 'semantic') {
            return this.createSemanticChunks(content, maxChunkSize, overlapSize, maxChunks);
        } else {
            errorLog('CHUNKING', 'Unknown chunking strategy, falling back to simple', { strategy });
            return this.createSimpleChunks(content, maxChunkSize, overlapSize, maxChunks);
        }
    }

    /**
     * Create simple character-based chunks with overlap
     * @param {string} content - Content to chunk
     * @param {number} maxChunkSize - Maximum chunk size
     * @param {number} overlapSize - Overlap between chunks
     * @returns {Array} Array of chunks
     */
    static createSimpleChunks(content, maxChunkSize, overlapSize, maxChunks = 10) {
        const chunks = [];
        let startIndex = 0;
        let loopCount = 0;
        const maxLoops = 1000; // Prevent infinite loops
        const minProgressSize = Math.max(100, maxChunkSize * 0.1); // Minimum progress per loop

        while (startIndex < content.length && loopCount < maxLoops && chunks.length < maxChunks) {
            let endIndex = Math.min(startIndex + maxChunkSize, content.length);
            
            // Try to break at sentence boundary if possible
            if (endIndex < content.length) {
                const lastPeriod = content.lastIndexOf('.', endIndex);
                const lastNewline = content.lastIndexOf('\n', endIndex);
                const bestBreak = Math.max(lastPeriod, lastNewline);
                
                if (bestBreak > startIndex + (maxChunkSize * 0.5)) { // Don't go back too far
                    endIndex = bestBreak + 1;
                }
            }

            const chunk = content.substring(startIndex, endIndex);
            chunks.push({
                content: chunk,
                startIndex: startIndex,
                endIndex: endIndex,
                chunkNumber: chunks.length + 1,
                estimatedTokens: Math.ceil(chunk.length / 4)
            });

            // CRITICAL FIX: Ensure forward progress to prevent infinite loops
            const newStartIndex = endIndex - overlapSize;
            if (newStartIndex <= startIndex) {
                // If we're not making progress, force minimum progress
                startIndex = startIndex + minProgressSize;
                debugLog('CHUNKING', 'Forcing minimum progress to prevent infinite loop', {
                    originalStartIndex: startIndex,
                    newStartIndex: newStartIndex,
                    forcedStartIndex: startIndex,
                    minProgressSize: minProgressSize,
                    loopCount: loopCount + 1
                });
            } else {
                startIndex = newStartIndex;
            }

            loopCount++;
        }

        // Safety check: if we hit max loops or max chunks, truncate last chunk and finish
        if (loopCount >= maxLoops || chunks.length >= maxChunks) {
            const reason = loopCount >= maxLoops ? 'max loops' : 'max chunks';
            errorLog('CHUNKING', `Chunking stopped due to ${reason} limit`, {
                totalLoops: loopCount,
                maxChunks: maxChunks,
                contentLength: content.length,
                currentStartIndex: startIndex,
                chunksCreated: chunks.length,
                reason: reason
            });
            
            // Add final chunk if there's remaining content and we haven't hit max chunks
            if (startIndex < content.length && chunks.length < maxChunks) {
                chunks.push({
                    content: content.substring(startIndex),
                    startIndex: startIndex,
                    endIndex: content.length,
                    chunkNumber: chunks.length + 1,
                    estimatedTokens: Math.ceil((content.length - startIndex) / 4)
                });
            }
        }

        debugLog('CHUNKING', 'Created simple chunks', {
            totalChunks: chunks.length,
            averageChunkSize: chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length,
            overlapSize: overlapSize,
            loopCount: loopCount,
            contentLength: content.length,
            maxChunksLimit: maxChunks
        });

        return chunks;
    }

    /**
     * Create semantic chunks (paragraph-based) with overlap
     * @param {string} content - Content to chunk
     * @param {number} maxChunkSize - Maximum chunk size
     * @param {number} overlapSize - Overlap between chunks
     * @returns {Array} Array of chunks
     */
    static createSemanticChunks(content, maxChunkSize, overlapSize, maxChunks = 10) {
        const paragraphs = content.split(/\n\s*\n/);
        const chunks = [];
        let currentChunk = '';
        let chunkNumber = 1;

        for (let i = 0; i < paragraphs.length && chunks.length < maxChunks; i++) {
            const paragraph = paragraphs[i];
            const testChunk = currentChunk + (currentChunk ? '\n\n' : '') + paragraph;

            if (testChunk.length <= maxChunkSize) {
                currentChunk = testChunk;
            } else {
                if (currentChunk) {
                    chunks.push({
                        content: currentChunk,
                        chunkNumber: chunkNumber++,
                        estimatedTokens: Math.ceil(currentChunk.length / 4),
                        paragraphStart: i - Math.floor(currentChunk.split('\n\n').length) + 1,
                        paragraphEnd: i - 1
                    });
                }

                // Handle paragraph that's too long for a single chunk
                if (paragraph.length > maxChunkSize) {
                    const subChunks = this.createSimpleChunks(paragraph, maxChunkSize, overlapSize, maxChunks);
                    subChunks.forEach((subChunk, index) => {
                        if (chunks.length < maxChunks) {
                            chunks.push({
                                content: subChunk.content,
                                chunkNumber: chunkNumber++,
                                estimatedTokens: subChunk.estimatedTokens,
                                isSubChunk: true,
                                parentParagraph: i
                            });
                        }
                    });
                } else {
                    currentChunk = paragraph;
                }
            }
        }

        // Add final chunk if we haven't hit max chunks
        if (currentChunk && chunks.length < maxChunks) {
            chunks.push({
                content: currentChunk,
                chunkNumber: chunkNumber,
                estimatedTokens: Math.ceil(currentChunk.length / 4),
                paragraphStart: paragraphs.length - Math.floor(currentChunk.split('\n\n').length) + 1,
                paragraphEnd: paragraphs.length - 1
            });
        }

        // Check if we hit max chunks limit
        if (chunks.length >= maxChunks) {
            errorLog('CHUNKING', 'Semantic chunking stopped due to max chunks limit', {
                maxChunks: maxChunks,
                totalParagraphs: paragraphs.length,
                chunksCreated: chunks.length,
                remainingParagraphs: paragraphs.length - i
            });
        }

        debugLog('CHUNKING', 'Created semantic chunks', {
            totalChunks: chunks.length,
            totalParagraphs: paragraphs.length,
            averageChunkSize: chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length,
            maxChunksLimit: maxChunks
        });

        return chunks;
    }

    /**
     * Classify error type for appropriate handling
     * @param {Error} error - The error to classify
     * @returns {string} Error type classification
     */
    static classifyError(error) {
        if (error.message.includes('Failed to read connection') || 
            error.message.includes('proxy error') ||
            error.message.includes('ECONNRESET') ||
            error.message.includes('timeout') ||
            error.message.includes('ENOTFOUND') ||
            error.message.includes('ECONNREFUSED')) {
            return 'NETWORK_ERROR';
        } else if (error.message.includes('rate limit') ||
                   error.message.includes('429') ||
                   error.message.includes('too many requests')) {
            return 'RATE_LIMIT_ERROR';
        } else if (error.message.includes('500') ||
                   error.message.includes('502') ||
                   error.message.includes('503') ||
                   error.message.includes('504')) {
            return 'SERVER_ERROR';
        } else if (error.message.includes('OpenAI API Error')) {
            return 'API_ERROR';
        } else if (error.code === 'UND_ERR_HEADERS_TIMEOUT') {
            return 'HEADERS_TIMEOUT_ERROR';
        } else if (error.name === 'AbortError') {
            return 'TIMEOUT_ERROR';
        } else {
            return 'UNKNOWN_ERROR';
        }
    }

    /**
     * Process a single chunk with 3-retry logic and fixed delays
     * @param {Object} chunk - Chunk object with content and metadata
     * @param {string} systemPrompt - System prompt for API
     * @param {Object} importData - Original import data
     * @param {Object} config - Configuration object
     * @param {number} retryDelaySeconds - Delay between retries from config
     * @returns {Object} Chunk summary result
     */
    static async processChunkWithRetry(chunk, systemPrompt, importData, config, retryDelaySeconds) {
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                debugLog('CHUNKING', `Processing chunk ${chunk.chunkNumber}, attempt ${attempt}/${maxRetries}`, {
                    chunkNumber: chunk.chunkNumber,
                    attempt: attempt,
                    maxRetries: maxRetries,
                    contentLength: chunk.content.length,
                    estimatedTokens: chunk.estimatedTokens,
                    retryDelay: retryDelaySeconds
                });
                
                const result = await this.processChunk(chunk, systemPrompt, importData, config);
                
                // CRITICAL FIX: Check success flag before returning
                if (result.success) {
                    debugLog('CHUNKING', `Chunk ${chunk.chunkNumber} succeeded on attempt ${attempt}`, {
                        chunkNumber: chunk.chunkNumber,
                        successfulAttempt: attempt,
                        duration: result.duration
                    });
                    return result;
                } else {
                    // Convert failure to exception for retry logic
                    throw new Error(`Chunk processing failed: ${result.error}`);
                }
                
            } catch (error) {
                const errorType = this.classifyError(error);
                
                errorLog('CHUNKING', `Chunk ${chunk.chunkNumber} failed on attempt ${attempt}`, {
                    chunkNumber: chunk.chunkNumber,
                    attempt: attempt,
                    maxRetries: maxRetries,
                    error: error.message,
                    errorType: errorType,
                    contentLength: chunk.content.length
                });
                
                // If this is the last attempt, throw the error
                if (attempt === maxRetries) {
                    errorLog('CHUNKING', `Chunk ${chunk.chunkNumber} exhausted all retries`, {
                        chunkNumber: chunk.chunkNumber,
                        totalAttempts: maxRetries,
                        finalError: error.message,
                        errorType: errorType
                    });
                    throw error;
                }
                
                // Use fixed delay from config for all retries
                const delaySeconds = retryDelaySeconds || 60;
                
                debugLog('CHUNKING', `Delaying before retry for chunk ${chunk.chunkNumber}`, {
                    chunkNumber: chunk.chunkNumber,
                    attempt: attempt,
                    nextAttempt: attempt + 1,
                    delaySeconds: delaySeconds,
                    errorType: errorType
                });
                
                await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
            }
        }
    }

    /**
     * Process a single chunk with OpenAI API (original method, kept for compatibility)
     * @param {Object} chunk - Chunk object with content and metadata
     * @param {string} systemPrompt - System prompt for API
     * @param {Object} importData - Original import data
     * @param {Object} config - Configuration object
     * @returns {Object} Chunk summary result
     */
    static async processChunk(chunk, systemPrompt, importData, config) {
        const chunkStartTime = Date.now();
        
        const chunkContent = `
        video id: ${importData.videoid}
        channel: ${importData.channel}
        title: ${importData.title}
        description: ${importData.description}
        url: ${importData.url}
        chunk ${chunk.chunkNumber} of ${chunk.totalChunks}:
        ${chunk.content}

        CRITICAL INSTRUCTION: Do NOT include or repeat the original transcript content in your response. 
        Only provide the structured summary data in the required JSON format.
        `;

        debugLog('CHUNKING', 'Processing chunk', {
            chunkNumber: chunk.chunkNumber,
            totalChunks: chunk.totalChunks,
            contentLength: chunk.content.length,
            estimatedTokens: chunk.estimatedTokens
        });

        try {
            const chunkSummary = await this.callOpenAIDirect(chunkContent, systemPrompt, config);
            const chunkDuration = Date.now() - chunkStartTime;

            debugLog('CHUNKING', 'Chunk processed successfully', {
                chunkNumber: chunk.chunkNumber,
                duration: chunkDuration,
                summaryLength: JSON.stringify(chunkSummary).length
            });

            return {
                success: true,
                chunkNumber: chunk.chunkNumber,
                summary: chunkSummary,
                duration: chunkDuration
            };
        } catch (error) {
            const chunkDuration = Date.now() - chunkStartTime;
            errorLog('CHUNKING', 'Chunk processing failed', {
                chunkNumber: chunk.chunkNumber,
                duration: chunkDuration,
                error: error.message,
                contentLength: chunk.content.length
            });

            return {
                success: false,
                chunkNumber: chunk.chunkNumber,
                error: error.message,
                duration: chunkDuration
            };
        }
    }

    /**
     * Merge chunk results into a coherent summary
     * @param {Array} chunkResults - Array of chunk processing results
     * @param {Object} importData - Original import data
     * @param {string} systemPrompt - System prompt for final merge
     * @param {Object} config - Configuration object
     * @returns {Object} Merged summary
     */
    static async mergeChunkResults(chunkResults, importData, systemPrompt, config) {
        debugLog('CHUNKING', 'Merging chunk results', {
            totalChunks: chunkResults.length,
            successfulChunks: chunkResults.filter(r => r.success).length,
            failedChunks: chunkResults.filter(r => !r.success).length
        });

        const successfulResults = chunkResults.filter(r => r.success);
        
        if (successfulResults.length === 0) {
            throw new Error('All chunks failed to process');
        }

        if (successfulResults.length === 1) {
            debugLog('CHUNKING', 'Only one successful chunk, returning directly');
            return successfulResults[0].summary;
        }

        // Create merge content from all chunk summaries using compact JSON to reduce memory usage
        const mergeContent = `
        video id: ${importData.videoid}
        channel: ${importData.channel}
        title: ${importData.title}
        description: ${importData.description}
        url: ${importData.url}

        The following are partial summaries from different chunks of transcript:
        ${successfulResults.map((result, index) => `
        Chunk ${result.chunkNumber} Summary:
        ${JSON.stringify(result.summary)}
        `).join('\n')}

        CRITICAL INSTRUCTION: Do NOT include or repeat any original transcript content in your response. 
        Only provide the structured summary data in the required JSON format.
        `;

        try {
            debugLog('CHUNKING', 'Calling OpenAI to merge chunk results');
            const mergedSummary = await this.callOpenAIDirect(mergeContent, systemPrompt, config);
            
            debugLog('CHUNKING', 'Chunk results merged successfully', {
                mergedSummaryLength: JSON.stringify(mergedSummary).length,
                inputChunks: successfulResults.length
            });

            return mergedSummary;
        } catch (error) {
            errorLog('CHUNKING', 'Failed to merge chunk results', error);
            
            // Fallback: return the first successful chunk's summary
            debugLog('CHUNKING', 'Falling back to first successful chunk');
            return successfulResults[0].summary;
        }
    }

    /**
     * Helper function to load summarizing AI configuration from database with fallback to environment variables
     * @param {Object} pool - Database pool
     * @returns {Object} Configuration object
     */
    static async loadSummaryAIConfig(pool) {
        try {
            const configKeys = [
                'summary_openai_api_url', 'summary_openai_model', 'summary_openai_api_key',
                'summary_openai_failover_enabled', 'summary_openai_failover_mode',
                'summary_openai_failover_timeout_seconds',
                'summary_openai_secondary_api_url', 'summary_openai_secondary_api_key',
                'summary_openai_secondary_model'
            ];
            const configResult = await pool.query(
                'SELECT key, value FROM public.config WHERE key = ANY($1)',
                [configKeys]
            );

            const config = {
                summary_openai_api_url: process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions',
                summary_openai_model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                summary_openai_api_key: process.env.OPENAI_API_KEY,
                summary_openai_failover_enabled: true,
                summary_openai_failover_mode: 'failover',
                summary_openai_failover_timeout_seconds: 60,
                summary_openai_secondary_api_url: '',
                summary_openai_secondary_api_key: '',
                summary_openai_secondary_model: ''
            };
            
            configResult.rows.forEach(row => {
                try {
                    const parsedValue = JSON.parse(row.value);
                    config[row.key] = parsedValue.system_prompt !== undefined ? parsedValue.system_prompt : parsedValue;
                } catch (e) {
                    config[row.key] = row.value;
                }
            });
            
            // Log configuration source
            const configSource = {
                api_url: config.summary_openai_api_url === (process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions') ? 'env' : 'db',
                model: config.summary_openai_model === (process.env.OPENAI_MODEL || 'gpt-4o-mini') ? 'env' : 'db',
                api_key: config.summary_openai_api_key ? 'db' : 'env'
            };
            
            debugLog('SUMMARY_CONFIG', 'Summarizing AI configuration loaded', configSource);
            return config;
        } catch (error) {
            errorLog('SUMMARY_CONFIG', 'Error loading summarizing AI configuration from database, using environment variables', error);
            // Fallback to environment variables
            return {
                summary_openai_api_url: process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions',
                summary_openai_model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                summary_openai_api_key: process.env.OPENAI_API_KEY,
                summary_openai_failover_enabled: true,
                summary_openai_failover_mode: 'failover',
                summary_openai_failover_timeout_seconds: 60,
                summary_openai_secondary_api_url: '',
                summary_openai_secondary_api_key: '',
                summary_openai_secondary_model: ''
            };
        }
    }

    /**
     * Direct OpenAI API call to a specific endpoint (internal helper)
     * @param {string} apiUrl - API endpoint URL
     * @param {string} apiKey - API key
     * @param {string} model - Model name
     * @param {string} content - Content to process
     * @param {string} systemPrompt - System prompt
     * @param {number} timeoutMs - Timeout in milliseconds
     * @returns {Object} API response
     */
    static async callOpenAIEndpoint(apiUrl, apiKey, model, content, systemPrompt, timeoutMs) {
        if (!apiKey) {
            throw new Error('OpenAI API key not configured');
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        debugLog('OPENAI_TIMEOUT', 'OpenAI API call configured', {
            timeoutMs: timeoutMs,
            contentLength: content.length,
            model: model,
            apiUrl: apiUrl
        });

        try {
            const requestBody = {
                model: model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: content }
                ],
                response_format: { type: "json_object" }
            };

            // Normalize URL to ensure it includes /chat/completions path
            const normalizedApiUrl = ensureChatCompletionsPath(apiUrl);

            debugLog('OPENAI_URL_NORMALIZATION', 'API URL normalization', {
                originalUrl: apiUrl,
                normalizedUrl: normalizedApiUrl,
                wasModified: apiUrl !== normalizedApiUrl
            });

            debugLog('OPENAI_REQUEST', 'Sending request to OpenAI API', {
                url: normalizedApiUrl,
                model: model,
                contentSize: content.length,
                systemPromptSize: systemPrompt.length,
                timeoutMs: timeoutMs,
                requestSize: JSON.stringify(requestBody).length
            });

            const fetchStartTime = Date.now();
            const response = await fetch(normalizedApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
                timeout: timeoutMs
            });

            const fetchDuration = Date.now() - fetchStartTime;
            clearTimeout(timeoutId);

            debugLog('OPENAI_RESPONSE', 'Received response from OpenAI API', {
                fetchDuration: fetchDuration,
                httpStatus: response.status,
                httpStatusText: response.statusText,
                responseHeaders: Object.fromEntries(response.headers.entries())
            });

            if (!response.ok) {
                const errorText = await response.text();
                const error = new Error(`OpenAI API Error: ${response.status} - ${errorText}`);
                error.httpStatus = response.status;
                error.httpStatusText = response.statusText;
                error.errorText = errorText;
                error.fetchDuration = fetchDuration;
                throw error;
            }

            const responseStartTime = Date.now();

            // Process non-streaming response
            const data = await response.json();
            const rawSummaryText = data.choices?.[0]?.message?.content?.trim();
            const responseDuration = Date.now() - responseStartTime;

            debugLog('OPENAI_RESPONSE', 'OpenAI API response processed successfully', {
                responseParseDuration: responseDuration,
                hasContent: !!rawSummaryText,
                contentLength: rawSummaryText ? rawSummaryText.length : 0
            });

            if (!rawSummaryText) {
                throw new Error('OpenAI API response is missing or empty content');
            }

            // Parse the response as JSON
            try {
                return JSON.parse(rawSummaryText);
            } catch (parseError) {
                errorLog('OPENAI_RESPONSE', 'Failed to parse response as JSON', {
                    contentPreview: rawSummaryText.substring(0, 500),
                    error: parseError.message,
                    totalLength: rawSummaryText.length
                });
                throw new Error(`OpenAI API response is not valid JSON: ${parseError.message}`);
            }
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    /**
     * Direct OpenAI API call with failover support
     * @param {string} content - Content to process
     * @param {string} systemPrompt - System prompt
     * @param {Object} config - Configuration object
     * @returns {Object} API response
     */
    static async callOpenAIDirect(content, systemPrompt, config) {
        // Load summarizing AI configuration from database with fallback to environment variables
        const summaryConfig = await this.loadSummaryAIConfig(pool);
        const failoverMode = summaryConfig.summary_openai_failover_mode || 'failover';
        const failoverTimeoutMs = (summaryConfig.summary_openai_failover_timeout_seconds || 60) * 1000;
        const configuredTimeoutMinutes = config.openai_timeout_minutes || 30;
        const overallTimeoutMs = configuredTimeoutMinutes * 60 * 1000;

        // Determine which endpoint to use based on failover mode
        let primaryUrl, primaryApiKey, primaryModel, secondaryUrl, secondaryApiKey, secondaryModel;
        const defaultModel = summaryConfig.summary_openai_model;

        if (failoverMode === 'secondary_only') {
            // Use secondary as primary (no failover)
            primaryUrl = summaryConfig.summary_openai_secondary_api_url || summaryConfig.summary_openai_api_url;
            primaryApiKey = summaryConfig.summary_openai_secondary_api_key || summaryConfig.summary_openai_api_key;
            primaryModel = summaryConfig.summary_openai_secondary_model || defaultModel;
            secondaryUrl = null; // No failover when using secondary only
        } else if (failoverMode === 'secondary_to_primary') {
            // Use secondary as primary, with failover to original primary
            primaryUrl = summaryConfig.summary_openai_secondary_api_url || summaryConfig.summary_openai_api_url;
            primaryApiKey = summaryConfig.summary_openai_secondary_api_key || summaryConfig.summary_openai_api_key;
            primaryModel = summaryConfig.summary_openai_secondary_model || defaultModel;
            secondaryUrl = summaryConfig.summary_openai_api_url;
            secondaryApiKey = summaryConfig.summary_openai_api_key;
            secondaryModel = defaultModel;
        } else {
            // Normal or primary_only mode
            primaryUrl = summaryConfig.summary_openai_api_url;
            primaryApiKey = summaryConfig.summary_openai_api_key;
            primaryModel = defaultModel;
            secondaryUrl = summaryConfig.summary_openai_secondary_api_url;
            secondaryApiKey = summaryConfig.summary_openai_secondary_api_key || summaryConfig.summary_openai_api_key;
            secondaryModel = summaryConfig.summary_openai_secondary_model;
        }

        debugLog('FAILOVER_CONFIG', 'OpenAI failover configuration', {
            failoverMode: failoverMode,
            primaryUrl: primaryUrl,
            primaryModel: primaryModel,
            hasSecondary: !!secondaryUrl,
            secondaryUrl: secondaryUrl,
            hasSecondaryModel: !!secondaryModel,
            secondaryModel: secondaryModel,
            failoverTimeoutMs: failoverTimeoutMs,
            overallTimeoutMs: overallTimeoutMs
        });

        let lastError;
        const startTime = Date.now();

        // Try primary endpoint first
        try {
            // Use failover timeout for primary endpoint
            const primaryTimeout = Math.min(failoverTimeoutMs, overallTimeoutMs);
            return await this.callOpenAIEndpoint(primaryUrl, primaryApiKey, primaryModel, content, systemPrompt, primaryTimeout);
        } catch (primaryError) {
            lastError = primaryError;

            // Check if we should failover
            const timeElapsed = Date.now() - startTime;
            const canFailover = (failoverMode === 'failover' || failoverMode === 'secondary_to_primary') && secondaryUrl && (timeElapsed < overallTimeoutMs);

            if (canFailover) {
                // Check if secondary model is provided
                if (!secondaryModel) {
                    errorLog('FAILOVER_ERROR', 'Secondary endpoint configured but secondary model is missing', {
                        hasSecondaryUrl: !!secondaryUrl,
                        hasSecondaryModel: !!secondaryModel
                    });
                    throw new Error('Secondary model is required when using secondary endpoint for failover');
                }

                debugLog('FAILOVER', 'Primary endpoint failed, attempting failover to secondary', {
                    errorType: primaryError.errorType || primaryError.name,
                    errorMessage: primaryError.message,
                    httpStatus: primaryError.httpStatus,
                    timeElapsed: timeElapsed,
                    secondaryModel: secondaryModel
                });

                try {
                    // Remaining time for secondary attempt
                    const remainingTimeout = overallTimeoutMs - timeElapsed;
                    return await this.callOpenAIEndpoint(secondaryUrl, secondaryApiKey, secondaryModel, content, systemPrompt, remainingTimeout);
                } catch (secondaryError) {
                    debugLog('FAILOVER_FAILED', 'Both primary and secondary endpoints failed', {
                        primaryError: primaryError.message,
                        secondaryError: secondaryError.message,
                        totalDuration: Date.now() - startTime
                    });
                    lastError = secondaryError;
                }
            } else {
                debugLog('FAILOVER_SKIPPED', 'Failover not available or disabled', {
                    failoverMode: failoverMode,
                    hasSecondary: !!secondaryUrl,
                    errorType: primaryError.errorType || primaryError.name
                });
            }

            // Enhanced error classification for the final error
            if (lastError.name === 'AbortError') {
                errorLog('OPENAI_TIMEOUT', 'OpenAI API call timed out', {
                    configuredTimeoutMinutes: configuredTimeoutMinutes,
                    actualDuration: lastError.fetchDuration || 'unknown',
                    errorType: 'TIMEOUT_ERROR',
                    contentLength: content.length
                });
                lastError.errorType = 'TIMEOUT_ERROR';
            } else if (lastError.code === 'UND_ERR_HEADERS_TIMEOUT') {
                errorLog('HEADERS_TIMEOUT', 'Node.js headers timeout - check openai_timeout_minutes configuration', {
                    configuredTimeoutMinutes: configuredTimeoutMinutes,
                    timeoutMs: overallTimeoutMs,
                    errorMessage: lastError.message
                });
                lastError.errorType = 'HEADERS_TIMEOUT_ERROR';
            } else if (lastError.message && lastError.message.includes('Failed to read connection')) {
                errorLog('OPENAI_CONNECTION', 'OpenAI API connection failed', {
                    configuredTimeoutMinutes: configuredTimeoutMinutes,
                    fetchDuration: lastError.fetchDuration || 'unknown',
                    httpStatus: lastError.httpStatus,
                    errorType: 'NETWORK_ERROR',
                    errorMessage: lastError.message
                });
                lastError.errorType = 'NETWORK_ERROR';
            } else {
                errorLog('OPENAI_ERROR', 'OpenAI API call failed', {
                    configuredTimeoutMinutes: configuredTimeoutMinutes,
                    fetchDuration: lastError.fetchDuration || 'unknown',
                    httpStatus: lastError.httpStatus,
                    errorType: lastError.errorType || 'UNKNOWN_ERROR',
                    errorMessage: lastError.message
                });
            }

            throw lastError;
        }
    }

    static async getSummary(importData, systemPrompt, timeoutMinutes = null) {
        const requestStartTime = Date.now();
        
        // Construct prompt content from importData structure [9]
        const content = `
        video id: ${importData.videoid}
        channel: ${importData.channel}
        title: ${importData.title}
        description: ${importData.description}
        url: ${importData.url}
        transcript:
        ${importData.transcript_normalized}
        `;

        // Analyze content for debugging
        const contentAnalysis = this.analyzeContent(content);
        debugLog('OPENAI_REQUEST', 'Processing video summary request', {
            videoId: importData.videoid,
            contentAnalysis: contentAnalysis,
            systemPromptLength: systemPrompt.length
        });

        // Load chunking configuration
        let chunkingConfig = {};
        try {
            const configKeys = ['enable_chunking', 'max_context_window', 'chunk_overlap_size', 'chunking_strategy', 'openai_timeout_minutes', 'summary_retry_delay_seconds', 'summary_processor_delay_seconds'];
            const configResult = await pool.query(
                'SELECT key, value FROM public.config WHERE key = ANY($1)',
                [configKeys]
            );
            
            configResult.rows.forEach(row => {
                try {
                    chunkingConfig[row.key] = JSON.parse(row.value);
                } catch (e) {
                    chunkingConfig[row.key] = row.value;
                }
            });

            // Set defaults
            chunkingConfig.enable_chunking = chunkingConfig.enable_chunking !== false; // Default to true
            chunkingConfig.max_context_window = parseInt(chunkingConfig.max_context_window, 10) || 8000;
            chunkingConfig.chunk_overlap_size = parseInt(chunkingConfig.chunk_overlap_size, 10) || 500;
            chunkingConfig.chunking_strategy = chunkingConfig.chunking_strategy || 'simple';
            chunkingConfig.openai_timeout_minutes = parseInt(chunkingConfig.openai_timeout_minutes, 10) || 3;
            chunkingConfig.summary_processor_delay_seconds = parseInt(chunkingConfig.summary_processor_delay_seconds, 10) || 5;
        } catch (configError) {
            errorLog('CHUNKING', 'Error loading chunking configuration, using defaults', configError);
            chunkingConfig = {
                enable_chunking: false,
                max_context_window: 8000,
                chunk_overlap_size: 500,
                chunking_strategy: 'simple',
                openai_timeout_minutes: 3
            };
        }

        debugLog('CHUNKING', 'Chunking configuration loaded', {
            config: chunkingConfig,
            contentSize: contentAnalysis.characterCount
        });

        // Determine if chunking is needed
        const shouldChunk = this.shouldChunkContent(contentAnalysis, chunkingConfig);
        
        if (!shouldChunk) {
            debugLog('CHUNKING', 'Processing content as single chunk', {
                reason: chunkingConfig.enable_chunking ? 'Content too small' : 'Chunking disabled',
                contentSize: contentAnalysis.characterCount,
                maxContextWindow: chunkingConfig.max_context_window,
                estimatedTokens: contentAnalysis.estimatedTokens
            });
            
            // Use existing single-chunk logic
            return await this.processSingleChunk(content, systemPrompt, chunkingConfig);
        }

        debugLog('CHUNKING', 'Processing content with chunking', {
            contentSize: contentAnalysis.characterCount,
            maxContextWindow: chunkingConfig.max_context_window,
            estimatedTokens: contentAnalysis.estimatedTokens,
            strategy: chunkingConfig.chunking_strategy
        });

        // Process with chunking
        return await this.processWithChunking(content, systemPrompt, importData, chunkingConfig);
    }

    /**
     * Process content as a single chunk (original logic)
     * @param {string} content - Content to process
     * @param {string} systemPrompt - System prompt
     * @param {Object} config - Configuration object
     * @returns {Object} Summary result
     */
    static async processSingleChunk(content, systemPrompt, config) {
        try {
            return await this.callOpenAIDirect(content, systemPrompt, config);
        } catch (error) {
            errorLog('OPENAI_ERROR', 'Single chunk processing failed', error);
            throw error;
        }
    }

    /**
     * Process content with chunking strategy
     * @param {string} content - Content to process
     * @param {string} systemPrompt - System prompt
     * @param {Object} importData - Original import data
     * @param {Object} config - Configuration object
     * @returns {Object} Merged summary result
     */
    static async processWithChunking(content, systemPrompt, importData, config) {
        try {
            // Memory monitoring function
            const getMemoryUsage = () => {
                const usage = process.memoryUsage();
                return {
                    rss: Math.round(usage.rss / 1024 / 1024) + ' MB',
                    heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + ' MB',
                    heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + ' MB',
                    external: Math.round(usage.external / 1024 / 1024) + ' MB'
                };
            };

            const initialMemory = getMemoryUsage();
            debugLog('CHUNKING', 'Memory usage at start', {
                memory: initialMemory,
                contentSize: content.length
            });

            // Create chunks
            const chunks = this.createContentChunks(content, config);
            
            const afterChunkingMemory = getMemoryUsage();
            debugLog('CHUNKING', 'Memory usage after chunk creation', {
                memory: afterChunkingMemory,
                chunksCreated: chunks.length
            });
            
            // Add total chunks to each chunk for context
            chunks.forEach(chunk => {
                chunk.totalChunks = chunks.length;
            });

            debugLog('CHUNKING', 'Starting chunked processing', {
                totalChunks: chunks.length,
                strategy: config.chunking_strategy,
                totalContentLength: content.length
            });

            // Get delays from config
            const retryDelaySeconds = config.summary_retry_delay_seconds || 60;
            const processorDelaySeconds = config.summary_processor_delay_seconds || 5;
            
            debugLog('CHUNKING', 'Starting chunked processing with retry logic', {
                totalChunks: chunks.length,
                retryDelay: retryDelaySeconds,
                processorDelay: processorDelaySeconds,
                strategy: config.chunking_strategy
            });

            // Process chunks with early termination on first failure
            const chunkResults = [];
            
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                
                try {
                    debugLog('CHUNKING', `Starting chunk ${i + 1}/${chunks.length}`, {
                        chunkNumber: i + 1,
                        totalChunks: chunks.length,
                        contentLength: chunk.content.length,
                        estimatedTokens: chunk.estimatedTokens,
                        retryDelay: retryDelaySeconds
                    });
                    
                    const result = await this.processChunkWithRetry(
                        chunk, 
                        systemPrompt, 
                        importData, 
                        config, 
                        retryDelaySeconds
                    );
                    
                    chunkResults.push(result);
                    
                    // Add delay between successful chunks using processor delay (not retry delay)
                    if (i < chunks.length - 1) {
                        debugLog('CHUNKING', `Delaying before next chunk`, {
                            completedChunk: i + 1,
                            nextChunk: i + 2,
                            delaySeconds: processorDelaySeconds
                        });
                        await new Promise(resolve => setTimeout(resolve, processorDelaySeconds * 1000));
                    }
                    
                } catch (chunkError) {
                    errorLog('CHUNKING', `Chunk ${i + 1} failed after all retries - TERMINATING PROCESSING`, {
                        chunkNumber: i + 1,
                        totalChunks: chunks.length,
                        error: chunkError.message,
                        action: 'EARLY_TERMINATION'
                    });
                    
                    // Mark entire processing as failed and stop immediately
                    throw new Error(`Chunk ${i + 1} failed after ${retryDelaySeconds * 3} seconds of retries. Processing terminated: ${chunkError.message}`);
                }
            }

            const beforeMergeMemory = getMemoryUsage();
            debugLog('CHUNKING', 'Memory before merge', {
                memory: beforeMergeMemory,
                successfulChunks: chunkResults.filter(r => r.success).length
            });

            // Merge results
            const mergedSummary = await this.mergeChunkResults(chunkResults, importData, systemPrompt, config);
            
            const finalMemory = getMemoryUsage();
            debugLog('CHUNKING', 'Final memory usage', {
                memory: finalMemory,
                totalChunks: chunks.length,
                successfulChunks: chunkResults.filter(r => r.success).length,
                failedChunks: chunkResults.filter(r => !r.success).length,
                totalDuration: Date.now() - Date.now()
            });

            return mergedSummary;

        } catch (chunkingError) {
            errorLog('CHUNKING', 'Chunked processing failed, falling back to single chunk', chunkingError);
            
            // Fallback to single chunk processing
            debugLog('CHUNKING', 'Attempting fallback to single chunk processing');
            try {
                return await this.processSingleChunk(content, systemPrompt, config);
            } catch (fallbackError) {
                errorLog('CHUNKING', 'Fallback single chunk processing also failed', fallbackError);
                throw fallbackError;
            }
        }
    }

    static validateSummary(summaryData) {
        const requiredFields = ["Label", "Source", "Video ID", "Tags", "Channel", "Type", "TLDR", "Description", "Summary", "Key Insights", "Actionable Takeaways", "Notes", "Confidence"];

         if (!summaryData || typeof summaryData !== 'object') {
             console.log('Validate: Summary data is not a valid object.');
             return false;
         }

         for (const field of requiredFields) {
             if (!(field in summaryData)) {
                 console.log(`Validate: Missing required field '${field}'.`);
                 return false;
             }

             if (field === "Tags" || field === "Key Insights" || field === "Actionable Takeaways") {
                 // These fields should be arrays
                 if (!Array.isArray(summaryData[field])) {
                     console.log(`Validate: Field '${field}' is not an array.`);
                      return false;
                 }
                 // Check if array is empty or contains empty strings
                 if (summaryData[field].length === 0 || summaryData[field].some(item => !item || item.toString().trim() === '')) {
                     console.log(`Validate: Field '${field}' is empty or contains empty items.`);
                      return false;
                 }
             } else {
                 // Other fields should be non-empty strings
                 const value = summaryData[field];
                 if (value === null || value === undefined || value.toString().trim() === '') {
                     console.log(`Validate: Field '${field}' is null, undefined, or empty.`);
                      return false;
                 }
             }
         }

         console.log('Validate: Summary data is valid.');
         return true;
    }

    // --- NEW GENERIC HELPER METHOD FOR SUMMARIZING ARBITRARY CONTENT ---
    static async summarizeContent(textToSummarize, promptKey, config) {
        // Load summarizing AI configuration from database with fallback to environment variables
        const summaryConfig = await this.loadSummaryAIConfig(pool);
        const openaiApiKey = summaryConfig.summary_openai_api_key;
        const openaiModel = summaryConfig.summary_openai_model;
        const openaiApiUrl = summaryConfig.summary_openai_api_url;

        if (!openaiApiKey) {
            throw new Error('OpenAI API key not configured in database (summary_openai_api_key)');
        }

        // Fetch the system prompt from the database using the provided key
        let systemPrompt = '';
        try {
            const configResult = await pool.query('SELECT value FROM public.config WHERE key = $1', [promptKey]);
            if (configResult.rows.length > 0) {
                try {
                    const parsedConfig = JSON.parse(configResult.rows[0].value);
                    systemPrompt = parsedConfig.system_prompt;
                } catch (e) {
                    systemPrompt = configResult.rows[0].value; // Fallback if not JSON
                }
            } else {
                throw new Error(`System prompt for key '${promptKey}' not found in config table.`);
            }
        } catch (dbError) {
            console.error(`Error fetching system prompt for key '${promptKey}':`, dbError);
            throw new Error(`Failed to retrieve system prompt: ${dbError.message}`);
        }

        // Enhanced timeout configuration from database
        const configuredTimeoutMinutes = config?.openai_timeout_minutes || 30;
        const timeoutMs = configuredTimeoutMinutes * 60 * 1000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        debugLog('OPENAI_TIMEOUT', 'OpenAI API call configured for custom summary', {
            configuredTimeoutMinutes: configuredTimeoutMinutes,
            timeoutMs: timeoutMs,
            contentLength: textToSummarize.length,
            model: openaiModel,
            apiUrl: openaiApiUrl,
            promptKey: promptKey
        });

        console.log(`Requesting summary from OpenAI (Model: ${openaiModel}) using prompt key: ${promptKey}`);
        console.debug(`System Prompt: ${systemPrompt}`);
        console.debug(`User Content Preview (first 200 chars): ${textToSummarize.substring(0, 200)}...`);

        try {
            const response = await fetch(openaiApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openaiApiKey}`
                },
                body: JSON.stringify({
                    model: openaiModel,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: textToSummarize }
                    ],
                    response_format: { type: "json_object" }
                }),
                signal: controller.signal,
                timeout: timeoutMs
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`OpenAI API request failed with status ${response.status}: ${response.statusText}`, errorText);
                throw new Error(`OpenAI API Error: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            const rawSummaryText = data.choices?.[0]?.message?.content?.trim();

            if (!rawSummaryText) {
                throw new Error('OpenAI API response is missing or empty content.');
            }

            console.debug(`Received raw summary text: ${rawSummaryText}`);

            try {
                const parsedSummary = JSON.parse(rawSummaryText);
                console.log(`Successfully parsed summary JSON using prompt key: ${promptKey}`);
                return parsedSummary;
            } catch (parseError) {
                console.error(`Failed to parse OpenAI response as JSON:`, parseError);
                console.error(`Raw OpenAI response text that failed JSON parsing:`, rawSummaryText);
                throw new Error(`OpenAI API response is not valid JSON: ${parseError.message}`, { cause: parseError });
            }
        } catch (error) {
            clearTimeout(timeoutId);
            
            // Enhanced error classification
            if (error.name === 'AbortError') {
                errorLog('OPENAI_TIMEOUT', 'OpenAI API call timed out for custom summary', {
                    configuredTimeoutMinutes: configuredTimeoutMinutes,
                    errorMessage: error.message,
                    promptKey: promptKey
                });
            } else if (error.message && error.message.includes('Incorrect API key')) {
                errorLog('OPENAI_AUTH', 'OpenAI API authentication failed for custom summary', {
                    errorMessage: error.message,
                    promptKey: promptKey
                });
            }
            
            throw error;
        }
    }
    // --- END NEW GENERIC HELPER METHOD ---

    // --- NEW HELPER METHOD FOR WEBSITE SUMMARIES ---
    static async getWebsiteSummary(importData, systemPrompt, config) {
        // Load summarizing AI configuration from database with fallback to environment variables
        const summaryConfig = await this.loadSummaryAIConfig(pool);
        const openaiApiKey = summaryConfig.summary_openai_api_key;
        const openaiModel = summaryConfig.summary_openai_model;
        const openaiApiUrl = summaryConfig.summary_openai_api_url;

        if (!openaiApiKey) {
            throw new Error('OpenAI API key not configured in database (summary_openai_api_key)');
        }

        // Construct prompt content for website. ImportData here is a row from summaries_websites
        // which has 'url' as the key field.
        const content = `Please summarize the content found at the following URL: ${importData.url}`;

        // Enhanced timeout configuration from database
        const configuredTimeoutMinutes = config?.openai_timeout_minutes || 30;
        const timeoutMs = configuredTimeoutMinutes * 60 * 1000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        debugLog('OPENAI_TIMEOUT', 'OpenAI API call configured for website summary', {
            configuredTimeoutMinutes: configuredTimeoutMinutes,
            timeoutMs: timeoutMs,
            contentLength: content.length,
            model: openaiModel,
            apiUrl: openaiApiUrl
        });

        console.log(`Requesting website summary from OpenAI (Model: ${openaiModel}) for URL: ${importData.url}`);
        console.debug(`System Prompt: ${systemPrompt}`);
        console.debug(`User Content Preview (first 200 chars): ${content.substring(0, 200)}...`);

        try {
            const response = await fetch(openaiApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openaiApiKey}`
                },
                body: JSON.stringify({
                    model: openaiModel,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: content }
                    ],
                    // --- FORCE JSON RESPONSE ---
                    response_format: { "type": "json_object" } // Ensure JSON output
                    // --- END FORCE JSON ---
                }),
                signal: controller.signal,
                timeout: timeoutMs
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`OpenAI API request failed with status ${response.status}: ${response.statusText}`, errorText);
                throw new Error(`OpenAI API Error: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            const rawSummaryText = data.choices?.[0]?.message?.content?.trim();

            if (!rawSummaryText) {
                throw new Error('OpenAI API response is missing or empty content.');
            }

            console.debug(`Received raw website summary text: ${rawSummaryText}`);

            // Attempt to parse the response as JSON
            try {
                const parsedSummary = JSON.parse(rawSummaryText);
                console.log(`Successfully parsed website summary JSON for URL: ${importData.url}`);
                return parsedSummary;
            } catch (parseError) {
                console.error(`Failed to parse OpenAI website response as JSON:`, parseError);
                console.error(`Raw OpenAI website response text that failed JSON parsing:`, rawSummaryText);
                throw new Error(`OpenAI API response is not valid JSON: ${parseError.message}`, { cause: parseError });
            }
        } catch (error) {
            clearTimeout(timeoutId);
            
            // Enhanced error classification
            if (error.name === 'AbortError') {
                errorLog('OPENAI_TIMEOUT', 'OpenAI API call timed out for website summary', {
                    configuredTimeoutMinutes: configuredTimeoutMinutes,
                    errorMessage: error.message,
                    url: importData.url
                });
            } else if (error.message && error.message.includes('Incorrect API key')) {
                errorLog('OPENAI_AUTH', 'OpenAI API authentication failed for website summary', {
                    errorMessage: error.message,
                    url: importData.url
                });
            }
            
            throw error;
        }
    }
    // --- END NEW HELPER METHOD ---

    // --- NEW VALIDATION METHOD FOR WEBSITE SUMMARIES ---
    static validateWebsiteSummary(summaryData) {
        // Define the fields required by the new prompt schema
        const requiredFields = ["Title", "URL", "Mainpaige", "Tags", "Type", "TLDR", "Description", "Summary", "Key Insights", "Actionable Takeaways", "Notes", "Confidence"];

        if (!summaryData || typeof summaryData !== 'object') {
            console.log('Validate Website: Summary data is not a valid object.');
            return false;
        }

        for (const field of requiredFields) {
            if (!(field in summaryData)) {
                console.log(`Validate Website: Missing required field '${field}'.`);
                return false;
            }

            // Specific checks for array fields
            if (field === "Tags" || field === "Key Insights" || field === "Actionable Takeaways" || field === "Summary") {
                if (!Array.isArray(summaryData[field])) {
                    console.log(`Validate Website: Field '${field}' is not an array.`);
                    return false;
                }
                if (summaryData[field].length === 0 || summaryData[field].some(item => !item || item.toString().trim() === '')) {
                    console.log(`Validate Website: Field '${field}' is empty or contains empty items.`);
                    return false;
                }
            } else {
                // Other fields should be non-empty strings
                const value = summaryData[field];
                if (value === null || value === undefined || value.toString().trim() === '') {
                    console.log(`Validate Website: Field '${field}' is null, undefined, or empty.`);
                    return false;
                }
            }
        }

        console.log('Validate Website: Summary data is valid.');
        return true;
    }
    // --- END NEW VALIDATION METHOD ---

    // --- NEW VALIDATION METHOD FOR CUSTOM SUMMARIES ---
    static validateCustomSummary(summaryData) {
        const requiredFields = ["Title", "Content", "Tags", "TLDR", "Description", "Summary", "Key Insights", "Actionable Takeaways", "Notes", "Confidence"];

        if (!summaryData || typeof summaryData !== 'object') {
            console.log('Validate Custom: Summary data is not a valid object.');
            return false;
        }

        for (const field of requiredFields) {
            if (!(field in summaryData)) {
                console.log(`Validate Custom: Missing required field '${field}'.`);
                return false;
            }

            if (field === "Tags" || field === "Key Insights" || field === "Actionable Takeaways" || field === "Summary") {
                if (!Array.isArray(summaryData[field])) {
                    console.log(`Validate Custom: Field '${field}' is not an array.`);
                    return false;
                }
                if (summaryData[field].length === 0 || summaryData[field].some(item => !item || item.toString().trim() === '')) {
                    console.log(`Validate Custom: Field '${field}' is empty or contains empty items.`);
                    return false;
                }
            } else {
                // Other fields should be non-empty strings
                const value = summaryData[field];
                if (value === null || value === undefined || value.toString().trim() === '') {
                    console.log(`Validate Custom: Field '${field}' is null, undefined, or empty.`);
                    return false;
                }
            }
        }

        console.log('Validate Custom: Summary data is valid.');
        return true;
    }
    // --- END NEW VALIDATION METHOD ---
}

module.exports = OpenAISummarizerHelper;
