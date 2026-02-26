const express = require('express');
const { getDb } = require('../db/database');

const router = express.Router();

// ─── GET /api/stats/summary ─── Dashboard summary cards ──────────────────────
router.get('/summary', (req, res) => {
    try {
        const db = getDb();

        // Total entries
        const { total_entries } = db.prepare('SELECT COUNT(*) as total_entries FROM entries').get();

        // Average amount
        const { avg_amount } = db.prepare('SELECT ROUND(AVG(amount), 2) as avg_amount FROM entries').get();

        // Pending count
        const { pending_count } = db.prepare("SELECT COUNT(*) as pending_count FROM entries WHERE status = 'Pending'").get();

        // Approved count
        const { approved_count } = db.prepare("SELECT COUNT(*) as approved_count FROM entries WHERE status = 'Approved'").get();

        // Rejected count
        const { rejected_count } = db.prepare("SELECT COUNT(*) as rejected_count FROM entries WHERE status = 'Rejected'").get();

        // Total amount
        const { total_amount } = db.prepare('SELECT ROUND(SUM(amount), 2) as total_amount FROM entries').get();

        // Trend calculations (compare last 30 days vs previous 30 days)
        const now = new Date();
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const sixtyDaysAgo = new Date(now);
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

        const recentStr = thirtyDaysAgo.toISOString().split('T')[0];
        const prevStr = sixtyDaysAgo.toISOString().split('T')[0];
        const nowStr = now.toISOString().split('T')[0];

        const { recent_count } = db.prepare(
            'SELECT COUNT(*) as recent_count FROM entries WHERE date >= ? AND date <= ?'
        ).get(recentStr, nowStr);

        const { prev_count } = db.prepare(
            'SELECT COUNT(*) as prev_count FROM entries WHERE date >= ? AND date < ?'
        ).get(prevStr, recentStr);

        const { recent_avg } = db.prepare(
            'SELECT ROUND(AVG(amount), 2) as recent_avg FROM entries WHERE date >= ? AND date <= ?'
        ).get(recentStr, nowStr);

        const { prev_avg } = db.prepare(
            'SELECT ROUND(AVG(amount), 2) as prev_avg FROM entries WHERE date >= ? AND date < ?'
        ).get(prevStr, recentStr);

        const { recent_pending } = db.prepare(
            "SELECT COUNT(*) as recent_pending FROM entries WHERE status = 'Pending' AND date >= ? AND date <= ?"
        ).get(recentStr, nowStr);

        const { prev_pending } = db.prepare(
            "SELECT COUNT(*) as prev_pending FROM entries WHERE status = 'Pending' AND date >= ? AND date < ?"
        ).get(prevStr, recentStr);

        function calcTrend(recent, prev) {
            if (!prev || prev === 0) return { value: 0, direction: 'neutral' };
            const pct = ((recent - prev) / prev * 100).toFixed(1);
            return {
                value: Math.abs(pct),
                direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral',
            };
        }

        res.json({
            success: true,
            data: {
                total_entries: {
                    value: total_entries,
                    trend: calcTrend(recent_count, prev_count),
                    progress: Math.min(100, Math.round((total_entries / 1000) * 100)),
                },
                average_amount: {
                    value: avg_amount || 0,
                    display: '$' + (avg_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }),
                    trend: calcTrend(recent_avg, prev_avg),
                    progress: Math.min(100, Math.round(((avg_amount || 0) / 1000) * 100)),
                },
                pending_items: {
                    value: pending_count,
                    trend: calcTrend(recent_pending, prev_pending),
                    progress: Math.min(100, Math.round((pending_count / total_entries) * 100)),
                },
                status_breakdown: {
                    approved: approved_count,
                    pending: pending_count,
                    rejected: rejected_count,
                },
                total_amount: {
                    value: total_amount || 0,
                    display: '$' + (total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }),
                },
            },
        });
    } catch (error) {
        console.error('GET /api/stats/summary error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch summary stats' });
    }
});

// ─── GET /api/stats/by-category ─── Spending by category ─────────────────────
router.get('/by-category', (req, res) => {
    try {
        const db = getDb();

        const data = db.prepare(`
      SELECT
        c.name as category,
        c.color,
        COUNT(e.id) as entry_count,
        ROUND(SUM(e.amount), 2) as total_amount,
        ROUND(AVG(e.amount), 2) as avg_amount
      FROM entries e
      JOIN categories c ON e.category_id = c.id
      GROUP BY c.id
      ORDER BY total_amount DESC
    `).all();

        res.json({ success: true, data });
    } catch (error) {
        console.error('GET /api/stats/by-category error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch category stats' });
    }
});

// ─── GET /api/stats/by-month ─── Monthly spending trend ──────────────────────
router.get('/by-month', (req, res) => {
    try {
        const db = getDb();

        const data = db.prepare(`
      SELECT
        strftime('%Y-%m', date) as month,
        COUNT(id) as entry_count,
        ROUND(SUM(amount), 2) as total_amount,
        ROUND(AVG(amount), 2) as avg_amount,
        SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) as rejected
      FROM entries
      GROUP BY strftime('%Y-%m', date)
      ORDER BY month ASC
    `).all();

        // Format month labels
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const formattedData = data.map(row => ({
            ...row,
            month_label: `${months[parseInt(row.month.split('-')[1]) - 1]} ${row.month.split('-')[0]}`,
        }));

        res.json({ success: true, data: formattedData });
    } catch (error) {
        console.error('GET /api/stats/by-month error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch monthly stats' });
    }
});

// ─── GET /api/stats/recent-activity ─── Latest 10 entries ────────────────────
router.get('/recent-activity', (req, res) => {
    try {
        const db = getDb();

        const data = db.prepare(`
      SELECT
        e.id,
        e.date,
        c.name as category,
        c.color as category_color,
        e.description,
        e.amount,
        e.status,
        e.created_at
      FROM entries e
      JOIN categories c ON e.category_id = c.id
      ORDER BY e.created_at DESC
      LIMIT 10
    `).all();

        res.json({ success: true, data });
    } catch (error) {
        console.error('GET /api/stats/recent-activity error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch recent activity' });
    }
});

module.exports = router;
