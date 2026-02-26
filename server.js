const express = require('express');
const cors = require('cors');
const path = require('path');

// Import routes
const entriesRouter = require('./routes/entries');
const statsRouter = require('./routes/stats');
const categoriesRouter = require('./routes/categories');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const color = res.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';
        console.log(
            `${color}${req.method}\x1b[0m ${req.originalUrl} → ${res.statusCode} (${duration}ms)`
        );
    });
    next();
});

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/entries', entriesRouter);
app.use('/api/stats', statsRouter);
app.use('/api/categories', categoriesRouter);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});

// ─── Serve front-end (SPA fallback) ───────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            success: false,
            error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
        });
    }
    next();
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
    });
});

// ─── Start Server (local only — Vercel manages its own listener) ──────────────
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log('');
        console.log('┌──────────────────────────────────────────┐');
        console.log('│   📊 Spreadsheet Demo — Back-end API     │');
        console.log('│                                          │');
        console.log(`│   🌐 http://localhost:${PORT}              │`);
        console.log(`│   📡 API: http://localhost:${PORT}/api     │`);
        console.log('│                                          │');
        console.log('│   Routes:                                │');
        console.log('│   GET    /api/entries          (list)     │');
        console.log('│   GET    /api/entries/export   (csv)      │');
        console.log('│   GET    /api/entries/:id      (single)   │');
        console.log('│   POST   /api/entries          (create)   │');
        console.log('│   PUT    /api/entries/:id      (update)   │');
        console.log('│   DELETE /api/entries/:id      (delete)   │');
        console.log('│   PATCH  /api/entries/:id/status          │');
        console.log('│   GET    /api/stats/summary               │');
        console.log('│   GET    /api/stats/by-category           │');
        console.log('│   GET    /api/stats/by-month              │');
        console.log('│   GET    /api/stats/recent-activity       │');
        console.log('│   GET    /api/categories                  │');
        console.log('│   POST   /api/categories                  │');
        console.log('│   PUT    /api/categories/:id              │');
        console.log('│   DELETE /api/categories/:id              │');
        console.log('│   GET    /api/health                      │');
        console.log('└──────────────────────────────────────────┘');
        console.log('');
    });
}

module.exports = app;

