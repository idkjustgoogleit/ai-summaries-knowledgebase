const express = require('express');
const fs = require('fs');
const path = require('path');
const asyncHandler = require('../middleware/asyncHandler');
const { debugLog, errorLog } = require('../utils/debugUtils');

// Function to normalize subtitles content
function normalizeSubtitles(content) {
  // Remove timestamps and other metadata from .vtt or .srt files
  const lines = content.split('\n');
  let normalizedText = [];

  // Skip header lines for .vtt files
  let skipLines = 0;
  if (content.startsWith('WEBVTT')) {
    skipLines = 3; // Skip WEBVTT, Kind, and Language lines
  }

  // Process each line
  for (let i = skipLines; i < lines.length; i++) {
    const line = lines[i].trim();
    // Skip empty lines and timestamp lines
    if (line && !line.includes('-->') && !line.match(/^\d+$/)) {
      normalizedText.push(line);
    }
  }

  // Join lines with spaces and clean up
  return normalizedText.join(' ').replace(/\s+/g, ' ').trim();
}

module.exports = function(db) {
  const router = express.Router();

  // Handle yt-dlp callback after processing
  router.post('/download', asyncHandler(async (req, res) => {
      // Validate API key
      const apiKey = req.headers['x-api-key'];
      if (apiKey !== process.env.YT_DLP_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized - Invalid API key' });
      }

      const { url, status: processingStatus, videoid } = req.body;

      if (!url || !videoid) {
        return res.status(400).json({ error: 'Missing URL or videoid' });
      }

      // Find the import record by videoid (more reliable than URL)
      const importResult = await db.query(
        'SELECT videoid FROM public.import WHERE videoid = $1',
        [videoid]
      );

      if (importResult.rows.length === 0) {
        return res.status(404).json({ error: 'Import record not found' });
      }

      const row = importResult.rows[0];

      if (processingStatus === 'success') {
        // Attempt to read the subtitles file and metadata
        const downloadDir = path.join('/downloads', row.videoid);
        let srtPath = path.join(downloadDir, `${row.videoid}.en.srt`);
        let vttPath = path.join(downloadDir, `${row.videoid}.en.vtt`);

        try {
          let subtitlesContent = '';
          let autoCaptionsContent = '';
          let transcriptNormalized = '';

          // Check for .srt file first
          if (fs.existsSync(srtPath)) {
            const srtContent = fs.readFileSync(srtPath, 'utf-8');
            subtitlesContent = srtContent;
            transcriptNormalized = normalizeSubtitles(srtContent);
          }
          // If no .srt file, check for .vtt file
          else if (fs.existsSync(vttPath)) {
            const vttContent = fs.readFileSync(vttPath, 'utf-8');
            autoCaptionsContent = vttContent;
            transcriptNormalized = normalizeSubtitles(vttContent);
          }
          else {
            throw new Error('No subtitles file found');
          }

          // Read metadata from info.json
          let title = '';
          let channelName = '';
          let description = '';

          const infoJsonPath = path.join(downloadDir, `${row.videoid}.info.json`);
          if (fs.existsSync(infoJsonPath)) {
            try {
              const infoContent = fs.readFileSync(infoJsonPath, 'utf-8');
              const infoData = JSON.parse(infoContent);

              title = infoData.title || '';
              channelName = infoData.channel || infoData.uploader || '';
              description = infoData.description || '';
            } catch (infoErr) {
              errorLog('YTDLP_CALLBACK', `Failed to parse info.json for video ${row.videoid}`, infoErr);
            }
          }

          await db.query(
            `UPDATE import SET
              status = 'NEW',
              title = $1,
              channel = $2,
              description = $3,
              subtitles = $4,
              auto_captions = $5,
              transcript_normalized = $6
             WHERE videoid = $7`,
            [title, channelName, description, subtitlesContent, autoCaptionsContent, transcriptNormalized, row.videoid]
          );

          debugLog('YTDLP_CALLBACK', `Successfully updated video ${row.videoid} with NEW status and metadata`);
        } catch (err) {
          // If subtitles file doesn't exist or can't be read
          await db.query(
            `UPDATE import SET status = 'FAILED' WHERE videoid = $1`,
            [row.videoid]
          );

          errorLog('YTDLP_CALLBACK', `Failed to read subtitles for video ${row.videoid}`, err);
        }
      } else {
        // Handle failure case
        await db.query(
          `UPDATE import SET status = 'FAILED' WHERE videoid = $1`,
          [row.videoid]
        );

        debugLog('YTDLP_CALLBACK', `Marked video ${row.videoid} as FAILED due to processing error`);
      }

      res.status(200).send('Processed');
  }));

  return router;
};
