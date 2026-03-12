// backend/server.js

/**
 * Entry point for the main server application.
 * - Sets up core Express server.
 * - Initializes middleware.
 * - Defines API routes.
 * - Serves static frontend assets.
 */

// CRITICAL: Import undici configuration FIRST to override 5-minute header timeout
require('./config/undici');

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const jwt = require('jsonwebtoken'); // Kept as potentially used indirectly via imported route modules
const { debugLog, errorLog } = require('./utils/debugUtils');
require('dotenv').config();

// Validate environment variables early in startup
const { validateOrExit } = require('./utils/envValidation');
validateOrExit();

// Import authentication system
const { initializeAuth, localAuth, oidcAuth } = require('./auth');

// Import security middleware
const {
    getGeneralLimiter,
    initRateLimiters,
    refreshGeneralLimiter,
    generalLimiter, // Fallback (static)
    authLimiter,
    dataModificationLimiter,
    fileUploadLimiter,
    securityHeaders,
    globalErrorHandler
} = require('./middleware/security');

// Import route protection middleware
const { createRootProtection } = require('./middleware/routeProtection');

// Import API authentication middleware
const authenticateApiRequest = require('./middleware/apiAuthMiddleware');

// Import all API routes
const authRouter = require('./routes/auth'); // Handles /api/auth/login, /api/auth/logout
const summariesRouter = require('./routes/summaries'); // Handles /api/summaries/*
const favoritesRouter = require('./routes/favorites'); // Handles /api/favorites/*
const importRouter = require('./routes/import'); // Handles /api/import/*
const chatRouter = require('./routes/chat'); // Handles /api/chat/*
const tagsRouter = require('./routes/tags'); // Handles /api/tags/*
const checkAdminRights = require('./middleware/checkAdminRights');
const adminConfigRouter = require('./routes/adminConfig'); // Handles /api/admin/config/*
const adminUploadRouter = require('./routes/adminUploadRoutes'); // Handles /api/admin/config/cookies
const websiteGrabRouter = require('./routes/websiteGrab');
// ytDlpCallbackRouter deprecated - functionality merged into YtDlpWorker
const grabCustomRouter = require('./routes/grabCustom'); // NEW: For custom content submission
const summariesCustomRouter = require('./routes/summariesCustom'); // NEW: For custom summaries
const configRoutes = require('./routes/config'); // NEW: For fetching frontend configuration
const playlistRouter = require('./routes/playlist'); // NEW: For playlist subscription management
const app = express();
const PORT = process.env.PORT || 5000;

// --- SECURITY FIX: Trust Proxy Setting ---
// Trust proxy headers from nginx/load balancer (secure configuration)
app.set('trust proxy', '172.18.0.0/16'); // Trust only Docker network

// --- Security Middleware ---
// Apply security headers first
app.use(securityHeaders);

// Apply general rate limiting to all API routes
// Note: Uses dynamic rate limiter loaded from database (rate_limit_max config)
// Falls back to static generalLimiter until database is initialized
app.use('/api', (req, res, next) => {
    const limiter = getGeneralLimiter() || generalLimiter;
    return limiter(req, res, next);
});

// --- Core Middleware ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Configure CORS with origin whitelist for security
// In production, ALWAYS set FRONTEND_URL environment variable
// For development, you can set FRONTEND_URL to multiple comma-separated origins
const allowedOrigins = process.env.FRONTEND_URL 
    ? process.env.FRONTEND_URL.split(',').map(origin => origin.trim())
    : [];

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl, Postman)
        if (!origin) return callback(null, true);
        
        // In production mode, reject requests without allowed origin
        if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
            return callback(new Error('CORS: FRONTEND_URL must be set in production'), false);
        }
        
        // Check if origin is in whitelist
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else if (allowedOrigins.length === 0 && process.env.NODE_ENV !== 'production') {
            // Development mode: allow all origins if FRONTEND_URL not set
            debugLog('CORS', `Allowing unlisted origin in development: ${origin}`);
            callback(null, true);
        } else {
            debugLog('CORS', `Blocking unlisted origin: ${origin}`);
            callback(new Error('CORS: Origin not allowed'));
        }
    },
    credentials: true
};

app.use(cors(corsOptions));

// --- Database Connection Pooling ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
});

// Gracefully test initial database connection and initialize rate limiters
pool.query('SELECT NOW()', async (err, res) => {
  if (err) {
    errorLog('? Database initial connection error:', err.stack);
  } else {
    debugLog('? Database connected successfully');
    // Initialize dynamic rate limiter from database configuration
    try {
      await initRateLimiters(pool);
      debugLog('? Rate limiters initialized from database config');
    } catch (initError) {
      errorLog('? Error initializing rate limiters from DB:', initError);
      debugLog('? Using fallback static rate limiter (500 requests/15min)');
    }
  }
});

// --- CRITICAL FIX: Initialize Authentication BEFORE Routes ---
// Initialize authentication system BEFORE registering API routes to ensure proper middleware order
initializeAuth(app, pool);

// --- CRITICAL FIX: Route Protection ---
// Apply conditional route protection based on SSO_OIDC mode
const { routeProtection } = require('./middleware/routeProtection');
app.use(routeProtection);

// --- Test Endpoint (for debugging connectivity) ---
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is operational!', timestamp: new Date().toISOString() });
});

// --- API Routes - ORDER IS CRITICAL ---
// Critical: Register config endpoint BEFORE rate limiting to prevent rate limiting conflicts
const { authConfig } = require('./config/auth');
app.get('/api/auth/config', (req, res) => {
    res.json({
        ssoOidc: authConfig.ssoOidc,
        appMode: authConfig.appMode,
        authMethod: authConfig.ssoOidc ? 'oidc' : 'local'
    });
});

// Register authentication endpoints (/api/auth) with strict rate limiting (excludes /api/auth/config above)
app.use('/api/auth', authLimiter, authRouter());

// Register import management endpoints (/api/import) with authentication and data modification rate limiting
app.use('/api/import', authenticateApiRequest, dataModificationLimiter, importRouter(pool));

// yt-dlp callback endpoint deprecated - functionality merged into YtDlpWorker

// Register chat functionality endpoints (/api/chat)
app.use('/api/chat', chatRouter(pool));

// Register tag management endpoints (/api/tags)
app.use('/api/tags', tagsRouter(pool));

// Register admin configuration endpoints (/api/admin/config)
// Protected by authenticateApiRequest middleware (OIDC session validation)
app.use('/api/admin/config', authenticateApiRequest, adminConfigRouter(pool));
// Register admin upload endpoints (/api/admin/config/cookies)
app.use('/api/admin/config', adminUploadRouter(pool));

// Registers /api/grab-website, /api/summaries-websites/:id etc.
app.use('/api/grab-website', websiteGrabRouter(pool)); 

// Register custom content grab endpoint
app.use('/api/grabCustom', grabCustomRouter);

// Register custom summaries endpoint
app.use('/api/summariesCustom', summariesCustomRouter(pool));

// Register summary management endpoints (/api/summaries) with authentication
// Must come after /api/tags to prevent routing conflict with summary ID 'latest'
app.use('/api/summaries', authenticateApiRequest, summariesRouter(pool));

// Register favorites endpoints (/api/favorites) with authentication
app.use('/api/favorites', authenticateApiRequest, favoritesRouter(pool));

// Register user detection test endpoint
app.use('/api/test', require('./routes/testUserDetection')(pool));

// Register config endpoint
app.use('/api', configRoutes); // Mount configRoutes under /api

// Register playlist subscription endpoints (/api/playlist)
app.use('/api/playlist', playlistRouter(pool));

// --- Static Assets & Frontend Single Page App Routing ---
// Serve built frontend files (HTML, JS, CSS, etc.)
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));

// Serve PWA assets from public directory (sw.js, manifest.json, icons)
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist', 'public')));

// Serve @mlc-ai/web-llm from custom /webllm/ path (bypasses nginx /node_modules blocking)
app.use('/webllm/@mlc-ai/web-llm', 
    express.static(path.join(__dirname, '..', 'node_modules', '@mlc-ai', 'web-llm')));

// OPTIONAL DIRECT PAGE SERVE (if using individual page handlers):
// If you have specific server-rendered login or index pages separate from static files:
// Create these tiny handlers inline below instead of requiring non-existent files.

// Example optional direct handler for index.html (already covered by static serve + catchall mostly):
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

// Example optional direct handler for admin.html:
app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'admin.html'));
});

// Removed login.html route as it's not needed - admin.html has built-in login form

// Catch-all for client-side routing (React Router, Vue Router, etc.)
// Sends index.html so frontend router takes over
app.get('*', (req, res) => {
    // Exclude API routes from catching
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
        return res.status(404).send('Not Found');
    }
    res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

// --- Global Error Handler ---
// Must be registered AFTER all routes to catch errors from all middleware and routes
app.use(globalErrorHandler);

// --- Start Server ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`?? Server is now listening on port ${PORT}`);
});

module.exports = app;
