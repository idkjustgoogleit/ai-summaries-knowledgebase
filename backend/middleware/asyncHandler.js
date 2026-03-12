/**
 * Async Handler Middleware
 *
 * Wraps async Express route handlers to catch errors and pass them to the
 * Express error handling middleware. This eliminates the need for repetitive
 * try-catch blocks in every route handler.
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => {
 *     // Your async route logic here
 *     // No try-catch needed - errors are automatically caught
 *   }));
 *
 * @see https://expressjs.com/en/guide/error-handling.html
 */

const { errorLog } = require('../utils/debugUtils');

/**
 * Async handler wrapper that catches errors and passes them to Express error handler
 * @param {Function} fn - Async route handler function
 * @returns {Function} Express middleware function
 */
const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch((error) => {
            // Log the error with context (method + path)
            const routePath = `${req.method} ${req.path}`;
            errorLog(routePath, 'Async handler caught error', error);

            // Pass to error handler (must be registered in server.js)
            next(error);
        });
    };
};

module.exports = asyncHandler;
