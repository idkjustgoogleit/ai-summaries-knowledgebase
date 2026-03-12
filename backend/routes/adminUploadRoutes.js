// backend/routes/adminUploadRoutes.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { debugLog, errorLog } = require('../utils/debugUtils');
const asyncHandler = require('../middleware/asyncHandler');
const { logAuditEvent } = require('../auth/shared');

module.exports = function(pool) {
  const router = express.Router();

  const checkAdminRights = require('../middleware/checkAdminRights');

  // Protect all routes in this section - admin only
  router.use(checkAdminRights);

  // Configure multer for cookies.txt upload with validation
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = '/app/backend/yt-dlp/cookies';
      // Create directory if it doesn't exist
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      // Always save as cookies.txt
      cb(null, 'cookies.txt');
    }
  });

  // File upload configuration with validation
  const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
      // Validate file extension
      const allowedExtensions = ['.txt'];
      const fileExtension = path.extname(file.originalname).toLowerCase();

      if (!allowedExtensions.includes(fileExtension)) {
        return cb(new Error('Only .txt files are allowed'), false);
      }

      // Validate MIME type
      if (file.mimetype !== 'text/plain') {
        return cb(new Error('Invalid file type. Only plain text files are allowed.'), false);
      }

      cb(null, true);
    },
    limits: {
      fileSize: 1024 * 10 // 10KB max for cookies file
    }
  });

  // POST /api/admin/config/cookies - Upload cookies.txt file
  router.post('/cookies', upload.single('cookies'), asyncHandler(async (req, res) => {
    debugLog('ADMIN_UPLOAD', "Cookies upload request received");

    if (!req.file) {
      errorLog('ADMIN_UPLOAD', "No file uploaded");
      return res.status(400).json({ error: 'No file uploaded' });
    }

    debugLog('ADMIN_UPLOAD', `Cookies file uploaded: ${req.file.filename}, size: ${req.file.size} bytes`);

    // Verify the file was written correctly
    const cookiesPath = path.join('/app/backend/yt-dlp/cookies', 'cookies.txt');
    if (fs.existsSync(cookiesPath)) {
      const stats = fs.statSync(cookiesPath);
      debugLog('ADMIN_UPLOAD', `Cookies file verified at ${cookiesPath}, size: ${stats.size} bytes`);

      // Audit log the file upload
      logAuditEvent('UPLOAD', 'cookies', {
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
        originalName: req.file.originalname
      }, req.user, req);

      return res.json({ message: 'Cookies file uploaded successfully' });
    } else {
      errorLog('ADMIN_UPLOAD', `Cookies file not found at ${cookiesPath} after upload`);
      return res.status(500).json({ error: 'Failed to save cookies file' });
    }
  }));

  // Multer error handler for file validation errors
  router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size exceeds limit of 10KB' });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Unexpected file field' });
      }
      return res.status(400).json({ error: err.message });
    }
    next(err);
  });

  return router;
};
