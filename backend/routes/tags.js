const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { debugLog } = require('../utils/debugUtils');

module.exports = function(pool) {
  const router = express.Router();

  // Get all unique tags - Simple and clean
  router.get('/', asyncHandler(async (req, res) => {
    debugLog('TAGS_API', 'Tags endpoint called');

    // Simple approach - get all tags and extract individual ones
    const result = await pool.query(
      "SELECT tags FROM public.summaries WHERE tags IS NOT NULL AND tags != '' AND tags != 'null'"
    );

    debugLog('TAGS_API', `Found ${result.rows.length} records with tags`);

    const allTags = new Set();

    result.rows.forEach(row => {
      if (row.tags) {
        // Split by comma and clean each tag
        const tags = row.tags.split(',').map(tag => tag.trim());
        tags.forEach(tag => {
          if (tag && tag.length > 0 && tag !== 'null' && tag !== 'undefined') {
            allTags.add(tag.trim());
          }
        });
      }
    });

    const tagsArray = [...allTags].sort();

    debugLog('TAGS_API', `Returning ${tagsArray.length} unique tags`);
    res.json(tagsArray);
  }));

  return router;
};
