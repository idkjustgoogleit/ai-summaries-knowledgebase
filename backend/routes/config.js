const express = require('express');
const router = express.Router();

router.get('/config', (req, res) => {
    res.json({
        TZ: process.env.TZ || 'Europe/Amsterdam' // Default to Europe/Amsterdam if TZ is not set
    });
});

module.exports = router;
