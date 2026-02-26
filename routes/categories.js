const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');

const router = express.Router();

// ─── GET /api/categories ─── List all categories ──────────────────────────────
router.get('/', (req, res) => {
    try {
        const db = getDb();

        const categories = db.prepare(`
      SELECT
        c.id,
        c.name,
        c.color,
        COUNT(e.id) as entry_count,
        ROUND(SUM(e.amount), 2) as total_amount,
        c.created_at
      FROM categories c
      LEFT JOIN entries e ON e.category_id = c.id
      GROUP BY c.id
      ORDER BY c.name ASC
    `).all();

        res.json({ success: true, data: categories });
    } catch (error) {
        console.error('GET /api/categories error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch categories' });
    }
});

// ─── POST /api/categories ─── Create a new category ──────────────────────────
router.post('/', (req, res) => {
    try {
        const db = getDb();
        const { name, color = '#3b82f6' } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, error: 'Category name is required' });
        }

        // Check if already exists
        const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
        if (existing) {
            return res.status(409).json({ success: false, error: 'Category already exists' });
        }

        const id = uuidv4();
        db.prepare('INSERT INTO categories (id, name, color) VALUES (?, ?, ?)').run(id, name, color);

        const created = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);

        res.status(201).json({ success: true, data: created });
    } catch (error) {
        console.error('POST /api/categories error:', error);
        res.status(500).json({ success: false, error: 'Failed to create category' });
    }
});

// ─── PUT /api/categories/:id ─── Update a category ───────────────────────────
router.put('/:id', (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const { name, color } = req.body;

        const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Category not found' });
        }

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (color !== undefined) updates.color = color;
        updates.updated_at = new Date().toISOString();

        const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = Object.values(updates);

        db.prepare(`UPDATE categories SET ${setClauses} WHERE id = ?`).run(...values, id);

        const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
        res.json({ success: true, data: updated });
    } catch (error) {
        console.error('PUT /api/categories/:id error:', error);
        res.status(500).json({ success: false, error: 'Failed to update category' });
    }
});

// ─── DELETE /api/categories/:id ─── Delete a category ─────────────────────────
router.delete('/:id', (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;

        const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Category not found' });
        }

        // Check if category has entries
        const { count } = db.prepare('SELECT COUNT(*) as count FROM entries WHERE category_id = ?').get(id);
        if (count > 0) {
            return res.status(409).json({
                success: false,
                error: `Cannot delete category with ${count} existing entries. Reassign or delete entries first.`,
            });
        }

        db.prepare('DELETE FROM categories WHERE id = ?').run(id);
        res.json({ success: true, message: 'Category deleted successfully' });
    } catch (error) {
        console.error('DELETE /api/categories/:id error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete category' });
    }
});

module.exports = router;
