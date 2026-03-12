/**
 * Undici Global Dispatcher Configuration
 * 
 * This module configures the global undici dispatcher to override
 * the default 5-minute header timeout that causes issues with
 * large content processing in Node.js.
 * 
 * Must be imported BEFORE any other HTTP requests or fetch calls.
 */

const { setGlobalDispatcher, Agent } = require('undici');

// Configure global undici agent with extended timeouts
// This overrides Docker environment variables that undici may ignore
const agent = new Agent({
    headersTimeout: 30 * 60 * 1000,  // 30 minutes for headers
    bodyTimeout: 2 * 60 * 60 * 1000, // 2 hours for body
    connectTimeout: 30 * 1000        // 30 seconds for initial connection
});

// Set as global dispatcher for all HTTP requests
setGlobalDispatcher(agent);

console.log('[UNDICI] Global dispatcher configured with extended timeouts:');
console.log('[UNDICI] - Headers timeout: 30 minutes');
console.log('[UNDICI] - Body timeout: 2 hours');
console.log('[UNDICI] - Connect timeout: 30 seconds');

module.exports = agent;