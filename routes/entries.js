const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/database');

const router = express.Router();

// ─── GET /api/entries ─── List entries with search, filter, sort, pagination ───
router.get('/', (req, res) => {
    try {
        const db = getDb();

        const {
            page = 1,
            limit = 20,
            search = '',
            status = '',
            category = '',
            sort_by = 'date',
            sort_order = 'DESC',
            date_from = '',
            date_to = '',
            amount_min = '',
            amount_max = '',
        } = req.query;

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        // Validate sort
        const allowedSortFields = ['date', 'amount', 'status', 'category', 'description', 'created_at'];
        const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'date';
        const sortDir = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        // Build WHERE clause
        const conditions = [];
        const params = [];

        if (search) {
            conditions.push('(e.description LIKE ? OR c.name LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        if (status && ['Approved', 'Pending', 'Rejected'].includes(status)) {
            conditions.push('e.status = ?');
            params.push(status);
        }

        if (category) {
            conditions.push('c.name = ?');
            params.push(category);
        }

        if (date_from) {
            conditions.push('e.date >= ?');
            params.push(date_from);
        }

        if (date_to) {
            conditions.push('e.date <= ?');
            params.push(date_to);
        }

        if (amount_min) {
            conditions.push('e.amount >= ?');
            params.push(parseFloat(amount_min));
        }

        if (amount_max) {
            conditions.push('e.amount <= ?');
            params.push(parseFloat(amount_max));
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        // Map sort field to actual column
        let orderColumn;
        switch (sortField) {
            case 'category': orderColumn = 'c.name'; break;
            case 'description': orderColumn = 'e.description'; break;
            default: orderColumn = `e.${sortField}`;
        }

        // Count total
        const countSql = `
      SELECT COUNT(*) as total
      FROM entries e
      JOIN categories c ON e.category_id = c.id
      ${whereClause}
    `;
        const { total } = db.prepare(countSql).get(...params);

        // Fetch entries
        const dataSql = `
      SELECT
        e.id,
        e.date,
        c.name as category,
        c.color as category_color,
        e.description,
        e.amount,
        e.status,
        e.notes,
        e.created_at,
        e.updated_at
      FROM entries e
      JOIN categories c ON e.category_id = c.id
      ${whereClause}
      ORDER BY ${orderColumn} ${sortDir}
      LIMIT ? OFFSET ?
    `;

        const entries = db.prepare(dataSql).all(...params, limitNum, offset);

        // Format dates for display
        const formattedEntries = entries.map(entry => ({
            ...entry,
            date_display: formatDate(entry.date),
            amount_display: formatCurrency(entry.amount),
        }));

        const totalPages = Math.ceil(total / limitNum);

        res.json({
            success: true,
            data: formattedEntries,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                total_pages: totalPages,
                has_prev: pageNum > 1,
                has_next: pageNum < totalPages,
            },
        });
    } catch (error) {
        console.error('GET /api/entries error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch entries' });
    }
});

// ─── GET /api/entries/export ─── Export all filtered entries as CSV ────────────
router.get('/export', (req, res) => {
    try {
        const db = getDb();

        const { search = '', status = '', category = '', date_from = '', date_to = '' } = req.query;

        const conditions = [];
        const params = [];

        if (search) {
            conditions.push('(e.description LIKE ? OR c.name LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }
        if (status && ['Approved', 'Pending', 'Rejected'].includes(status)) {
            conditions.push('e.status = ?');
            params.push(status);
        }
        if (category) {
            conditions.push('c.name = ?');
            params.push(category);
        }
        if (date_from) {
            conditions.push('e.date >= ?');
            params.push(date_from);
        }
        if (date_to) {
            conditions.push('e.date <= ?');
            params.push(date_to);
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        const sql = `
      SELECT e.date, c.name as category, e.description, e.amount, e.status
      FROM entries e
      JOIN categories c ON e.category_id = c.id
      ${whereClause}
      ORDER BY e.date DESC
    `;

        const entries = db.prepare(sql).all(...params);

        // Build CSV
        const header = 'Date,Category,Description,Amount,Status\n';
        const rows = entries.map(e =>
            `"${e.date}","${e.category}","${e.description}","${e.amount}","${e.status}"`
        ).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=spreadsheet_export.csv');
        res.send(header + rows);
    } catch (error) {
        console.error('GET /api/entries/export error:', error);
        res.status(500).json({ success: false, error: 'Failed to export entries' });
    }
});

// ─── GET /api/entries/:id ─── Get single entry ────────────────────────────────
router.get('/:id', (req, res) => {
    try {
        const db = getDb();
        const entry = db.prepare(`
      SELECT e.*, c.name as category, c.color as category_color
      FROM entries e
      JOIN categories c ON e.category_id = c.id
      WHERE e.id = ?
    `).get(req.params.id);

        if (!entry) {
            return res.status(404).json({ success: false, error: 'Entry not found' });
        }

        res.json({
            success: true,
            data: {
                ...entry,
                date_display: formatDate(entry.date),
                amount_display: formatCurrency(entry.amount),
            },
        });
    } catch (error) {
        console.error('GET /api/entries/:id error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch entry' });
    }
});

// ─── POST /api/entries ─── Create new entry ───────────────────────────────────
router.post('/', (req, res) => {
    try {
        const db = getDb();
        const { date, category, description, amount, status = 'Pending', notes = '' } = req.body;

        // Validate required fields
        if (!date || !category || !description || amount === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: date, category, description, amount',
            });
        }

        // Validate status
        if (!['Approved', 'Pending', 'Rejected'].includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'Status must be one of: Approved, Pending, Rejected',
            });
        }

        // Validate amount
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount < 0) {
            return res.status(400).json({
                success: false,
                error: 'Amount must be a positive number',
            });
        }

        // Find or create category
        let cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(category);
        if (!cat) {
            const catId = crypto.randomUUID();
            const colors = ['#3b82f6', '#a855f7', '#6366f1', '#f97316', '#10b981', '#ef4444', '#eab308', '#06b6d4'];
            const color = colors[Math.floor(Math.random() * colors.length)];
            db.prepare('INSERT INTO categories (id, name, color) VALUES (?, ?, ?)').run(catId, category, color);
            cat = { id: catId };
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        db.prepare(`
      INSERT INTO entries (id, date, category_id, description, amount, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, date, cat.id, description, parsedAmount, status, notes, now, now);

        // Fetch the created entry with joined data
        const created = db.prepare(`
      SELECT e.*, c.name as category, c.color as category_color
      FROM entries e
      JOIN categories c ON e.category_id = c.id
      WHERE e.id = ?
    `).get(id);

        res.status(201).json({
            success: true,
            data: {
                ...created,
                date_display: formatDate(created.date),
                amount_display: formatCurrency(created.amount),
            },
        });
    } catch (error) {
        console.error('POST /api/entries error:', error);
        res.status(500).json({ success: false, error: 'Failed to create entry' });
    }
});

// ─── PUT /api/entries/:id ─── Update entry ────────────────────────────────────
router.put('/:id', (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;

        // Check existence
        const existing = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Entry not found' });
        }

        const { date, category, description, amount, status, notes } = req.body;

        // Build update fields
        const updates = {};
        if (date !== undefined) updates.date = date;
        if (description !== undefined) updates.description = description;
        if (notes !== undefined) updates.notes = notes;

        if (amount !== undefined) {
            const parsedAmount = parseFloat(amount);
            if (isNaN(parsedAmount) || parsedAmount < 0) {
                return res.status(400).json({ success: false, error: 'Amount must be a positive number' });
            }
            updates.amount = parsedAmount;
        }

        if (status !== undefined) {
            if (!['Approved', 'Pending', 'Rejected'].includes(status)) {
                return res.status(400).json({ success: false, error: 'Invalid status' });
            }
            updates.status = status;
        }

        if (category !== undefined) {
            let cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(category);
            if (!cat) {
                const catId = crypto.randomUUID();
                const colors = ['#3b82f6', '#a855f7', '#6366f1', '#f97316', '#10b981', '#ef4444'];
                const color = colors[Math.floor(Math.random() * colors.length)];
                db.prepare('INSERT INTO categories (id, name, color) VALUES (?, ?, ?)').run(catId, category, color);
                cat = { id: catId };
            }
            updates.category_id = cat.id;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        updates.updated_at = new Date().toISOString();

        const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = Object.values(updates);

        db.prepare(`UPDATE entries SET ${setClauses} WHERE id = ?`).run(...values, id);

        // Fetch updated
        const updated = db.prepare(`
      SELECT e.*, c.name as category, c.color as category_color
      FROM entries e
      JOIN categories c ON e.category_id = c.id
      WHERE e.id = ?
    `).get(id);

        res.json({
            success: true,
            data: {
                ...updated,
                date_display: formatDate(updated.date),
                amount_display: formatCurrency(updated.amount),
            },
        });
    } catch (error) {
        console.error('PUT /api/entries/:id error:', error);
        res.status(500).json({ success: false, error: 'Failed to update entry' });
    }
});

// ─── DELETE /api/entries/:id ─── Delete entry ─────────────────────────────────
router.delete('/:id', (req, res) => {
    try {
        const db = getDb();
        const existing = db.prepare('SELECT id FROM entries WHERE id = ?').get(req.params.id);

        if (!existing) {
            return res.status(404).json({ success: false, error: 'Entry not found' });
        }

        db.prepare('DELETE FROM entries WHERE id = ?').run(req.params.id);

        res.json({ success: true, message: 'Entry deleted successfully' });
    } catch (error) {
        console.error('DELETE /api/entries/:id error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete entry' });
    }
});

// ─── PATCH /api/entries/:id/status ─── Quick status update ────────────────────
router.patch('/:id/status', (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const { status } = req.body;

        if (!status || !['Approved', 'Pending', 'Rejected'].includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'Status must be one of: Approved, Pending, Rejected',
            });
        }

        const existing = db.prepare('SELECT id FROM entries WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Entry not found' });
        }

        const now = new Date().toISOString();
        db.prepare('UPDATE entries SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);

        const updated = db.prepare(`
      SELECT e.*, c.name as category, c.color as category_color
      FROM entries e
      JOIN categories c ON e.category_id = c.id
      WHERE e.id = ?
    `).get(id);

        res.json({
            success: true,
            data: {
                ...updated,
                date_display: formatDate(updated.date),
                amount_display: formatCurrency(updated.amount),
            },
        });
    } catch (error) {
        console.error('PATCH /api/entries/:id/status error:', error);
        res.status(500).json({ success: false, error: 'Failed to update status' });
    }
});

// ─── Helper Functions ─────────────────────────────────────────────────────────
function formatDate(dateStr) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date(dateStr + 'T00:00:00');
    return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;
}

function formatCurrency(amount) {
    return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = router;
