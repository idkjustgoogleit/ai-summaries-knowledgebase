/**
 * Security middleware for rate limiting, security headers, and request validation
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');
const { debugLog, errorLog } = require('../utils/debugUtils');

/**
 * Rate limiting configuration
 */
const createRateLimiter = (windowMs, max, message) => {
    return rateLimit({
        windowMs,
        max,
        message: {
            error: message,
            timestamp: new Date().toISOString()
        },
        standardHeaders: true,
        legacyHeaders: false,
        // Skip rate limiting for health checks, static files, OIDC endpoints, and auth config
        skip: (req) => {
            return req.path === '/api/test' ||
                   req.path.startsWith('/public/') ||
                   req.path.startsWith('/api/auth/oidc/') || // Skip OIDC endpoints
                   req.path === '/api/auth/config' || // Skip auth config endpoint
                   (req.method === 'GET' && req.path === '/');
        }
    });
};

/**
 * Dynamic general API rate limiter
 * Loads rate limit from database (config table, key: rate_limit_max)
 * Default: 1000 requests per 15 minutes
 * Range: 100-10000 requests per 15 minutes
 */
let generalLimiterInstance = null;

const createDynamicGeneralLimiter = async (pool) => {
    try {
        const result = await pool.query(
            "SELECT value FROM public.config WHERE key = 'rate_limit_max'"
        );
        let maxRequests = 1000; // Default
        if (result.rows.length > 0) {
            maxRequests = parseInt(result.rows[0].value, 10) || 1000;
        }
        // Clamp between 100 and 10000
        maxRequests = Math.max(100, Math.min(10000, maxRequests));

        debugLog('SECURITY', `Rate limiter initialized with max: ${maxRequests} requests per 15 minutes`);

        return rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: maxRequests,
            message: {
                error: `Too many requests from this IP, please try again later (limit: ${maxRequests} per 15min)`,
                timestamp: new Date().toISOString()
            },
            standardHeaders: true,
            legacyHeaders: false,
            skip: (req) => {
                return req.path === '/api/test' ||
                       req.path.startsWith('/public/') ||
                       req.path.startsWith('/api/auth/oidc/') ||
                       req.path === '/api/auth/config' ||
                       (req.method === 'GET' && req.path === '/');
            }
        });
    } catch (error) {
        errorLog('SECURITY', 'Error loading rate limit from DB, using default 1000', error);
        return createRateLimiter(15 * 60 * 1000, 1000, 'Too many requests from this IP');
    }
};

/**
 * Static general API rate limiter (fallback)
 * 500 requests per 15 minutes
 * Increased from 100 to prevent 429 errors during normal rapid navigation
 * NOTE: This is only used as a fallback before database initialization
 */
const generalLimiter = createRateLimiter(
    15 * 60 * 1000,
    500,
    'Too many requests from this IP, please try again later'
);

/**
 * Strict rate limiter for authentication endpoints
 * FIXED: Increased from 5 to 20 attempts per 15 minutes for better testing experience
 */
const authLimiter = createRateLimiter(
    15 * 60 * 1000,
    20,
    'Too many authentication attempts from this IP, please try again later'
);

/**
 * Data modification endpoints rate limiter
 * 30 requests per 15 minutes
 */
const dataModificationLimiter = createRateLimiter(
    15 * 60 * 1000,
    30,
    'Too many data modification requests from this IP'
);

/**
 * File upload rate limiter
 * 10 uploads per hour
 */
const fileUploadLimiter = createRateLimiter(
    60 * 60 * 1000,
    10,
    'File upload limit exceeded for this IP'
);

/**
 * Security headers configuration
 * FIXED: Added 'unsafe-inline' for script-src-attr to allow inline event handlers
 */
const securityHeaders = helmet({
    // Configure Content Security Policy
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://huggingface.co", "https://*.hf.co", "https://raw.githubusercontent.com"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            // CRITICAL FIX: Allow inline event handlers for admin functionality
            scriptSrcAttr: ["'unsafe-inline'"],
        },
    },
    // Configure other security headers
    crossOriginEmbedderPolicy: false, // Allow file uploads
    crossOriginResourcePolicy: { policy: "cross-origin" }
});

/**
 * Request validation middleware
 */
const validateRequest = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Request validation failed',
            details: errors.array(),
            timestamp: new Date().toISOString()
        });
    }
    next();
};

/**
 * Input sanitization for common fields
 */
const sanitizeInput = [
    body('username')
        .trim()
        .isLength({ min: 3, max: 50 })
        .withMessage('Username must be between 3 and 50 characters')
        .matches(/^[a-zA-Z0-9_-]+$/)
        .withMessage('Username contains invalid characters'),
    
    body('email')
        .trim()
        .isEmail()
        .withMessage('Invalid email format')
        .normalizeEmail(),
    
    body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    
    // File upload validation
    body('filename')
        .optional()
        .trim()
        .matches(/^[a-zA-Z0-9._-]+$/)
        .withMessage('Invalid filename format'),
    
    // Content validation
    body('content')
        .optional()
        .isLength({ max: 10000 })
        .withMessage('Content too long'),
    
    // URL validation for external content
    body('url')
        .optional()
        .isURL({ protocols: ['http', 'https'] })
        .withMessage('Invalid URL format')
];

/**
 * Global error handler middleware
 * Must be registered AFTER all routes in server.js
 * Catches all errors passed via next() and returns consistent error responses
 */
const globalErrorHandler = (err, req, res, next) => {
    // Log the error with context
    errorLog('GLOBAL_ERROR_HANDLER', `${req.method} ${req.path}`, err);

    // Don't leak error details in production
    const isDevelopment = process.env.NODE_ENV !== 'production';

    // Determine status code
    const statusCode = err.status || err.statusCode || 500;

    res.status(statusCode).json({
        error: err.message || 'Internal server error',
        ...(isDevelopment && { stack: err.stack, details: err.message })
    });
};

module.exports = {
    getGeneralLimiter: () => generalLimiterInstance,
    initRateLimiters: async (pool) => {
        generalLimiterInstance = await createDynamicGeneralLimiter(pool);
        return generalLimiterInstance;
    },
    refreshGeneralLimiter: async (pool) => {
        generalLimiterInstance = await createDynamicGeneralLimiter(pool);
        debugLog('SECURITY', 'Rate limiter refreshed');
        return generalLimiterInstance;
    },
    generalLimiter, // For backward compatibility (static fallback)
    authLimiter,
    dataModificationLimiter,
    fileUploadLimiter,
    securityHeaders,
    validateRequest,
    sanitizeInput,
    createRateLimiter,
    globalErrorHandler
};
