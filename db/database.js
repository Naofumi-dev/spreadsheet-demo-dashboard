const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Vercel serverless: filesystem is read-only except /tmp
const isVercel = process.env.VERCEL === '1';
const DB_PATH = isVercel
  ? path.join('/tmp', 'spreadsheet.db')
  : path.join(__dirname, 'spreadsheet.db');

let db = null;
let dbReady = null; // Promise that resolves when DB is ready

// Wrapper to give sql.js a better-sqlite3-like interface
class DbWrapper {
  constructor(sqlDb) {
    this._db = sqlDb;
  }

  prepare(sql) {
    const self = this;
    return {
      _sql: sql,
      get(...params) {
        const stmt = self._db.prepare(sql);
        stmt.bind(params.length > 0 ? params : undefined);
        let result = null;
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          result = {};
          cols.forEach((c, i) => { result[c] = vals[i]; });
        }
        stmt.free();
        return result;
      },
      all(...params) {
        const results = [];
        const stmt = self._db.prepare(sql);
        stmt.bind(params.length > 0 ? params : undefined);
        while (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          const row = {};
          cols.forEach((c, i) => { row[c] = vals[i]; });
          results.push(row);
        }
        stmt.free();
        return results;
      },
      run(...params) {
        self._db.run(sql, params.length > 0 ? params : undefined);
      },
    };
  }

  exec(sql) {
    this._db.exec(sql);
  }

  pragma(str) {
    // sql.js handles pragmas via exec
    try { this._db.exec(`PRAGMA ${str}`); } catch (e) { /* ignore */ }
  }

  transaction(fn) {
    return () => {
      this._db.exec('BEGIN TRANSACTION');
      try {
        fn();
        this._db.exec('COMMIT');
      } catch (e) {
        this._db.exec('ROLLBACK');
        throw e;
      }
    };
  }

  // Save to disk
  save() {
    try {
      const data = this._db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
    } catch (e) {
      console.error('Failed to save DB:', e.message);
    }
  }
}

async function initDb() {
  // Load WASM binary from local copy (Vercel bundles project files but may miss node_modules assets)
  const wasmPath = path.join(__dirname, 'sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  const SQL = await initSqlJs({ wasmBinary });

  // Try loading existing DB file
  let sqlDb;
  if (fs.existsSync(DB_PATH)) {
    try {
      const fileBuffer = fs.readFileSync(DB_PATH);
      sqlDb = new SQL.Database(fileBuffer);
      db = new DbWrapper(sqlDb);
      // Check if tables exist
      const check = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entries'").get();
      if (check) {
        console.log('✅ Loaded existing database from', DB_PATH);
        return db;
      }
    } catch (e) {
      console.log('⚠️ Could not load existing DB, creating fresh:', e.message);
    }
  }

  // Create fresh database
  sqlDb = new SQL.Database();
  db = new DbWrapper(sqlDb);
  initializeSchema();
  db.save();
  console.log('✅ Fresh database created and saved to', DB_PATH);
  return db;
}

function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#3b82f6',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      category_id TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Approved', 'Pending', 'Rejected')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
    CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
    CREATE INDEX IF NOT EXISTS idx_entries_category ON entries(category_id);
    CREATE INDEX IF NOT EXISTS idx_entries_amount ON entries(amount);
  `);

  // Seed data if tables are empty
  const count = db.prepare('SELECT COUNT(*) as count FROM entries').get();
  if (!count || count.count === 0) {
    seedData();
  }
}

function seedData() {
  const categories = [
    { id: uuidv4(), name: 'Expenses', color: '#3b82f6' },
    { id: uuidv4(), name: 'Travel', color: '#a855f7' },
    { id: uuidv4(), name: 'Software', color: '#6366f1' },
    { id: uuidv4(), name: 'Marketing', color: '#f97316' },
    { id: uuidv4(), name: 'Payroll', color: '#10b981' },
    { id: uuidv4(), name: 'Utilities', color: '#ef4444' },
    { id: uuidv4(), name: 'Equipment', color: '#eab308' },
    { id: uuidv4(), name: 'Services', color: '#06b6d4' },
  ];

  const descriptions = {
    Expenses: ['Office Supplies', 'Coffee for Client', 'Printer Ink', 'Desk Accessories', 'Cleaning Services', 'Catered Lunch', 'Parking Fees', 'Stationery'],
    Travel: ['Flight to NYC', 'Hotel in LA', 'Uber Rides', 'Train Tickets', 'Airport Lounge', 'Car Rental', 'Fuel Costs', 'Travel Insurance'],
    Software: ['Adobe CC Sub', 'Slack Premium', 'GitHub Enterprise', 'AWS Hosting', 'Figma License', 'Jira Cloud', 'Zoom Pro', 'Notion Team'],
    Marketing: ['FB Ads Campaign', 'Google Ads', 'Influencer Collab', 'Email Tool Sub', 'Content Creation', 'SEO Audit', 'Print Flyers', 'Event Sponsorship'],
    Payroll: ['Jan Salaries', 'Contractor Pay', 'Bonus Payout', 'Freelancer Fee', 'Overtime Pay', 'Benefits', 'Commission', 'Training Stipend'],
    Utilities: ['Electric Bill', 'Water Bill', 'Internet Service', 'Phone Bill', 'Gas Bill', 'Waste Removal', 'Security System', 'HVAC Maintenance'],
    Equipment: ['Monitor Purchase', 'Laptop Upgrade', 'Keyboard Set', 'Server Rack', 'Webcam Bundle', 'Headset Pro', 'Docking Station', 'Network Switch'],
    Services: ['Legal Consulting', 'Accounting Firm', 'HR Advisory', 'IT Support', 'Design Agency', 'Security Audit', 'Cloud Migration', 'Data Analytics'],
  };

  const statuses = ['Approved', 'Pending', 'Rejected'];
  const statusWeights = [0.6, 0.25, 0.15];

  function weightedStatus() {
    const r = Math.random();
    if (r < statusWeights[0]) return statuses[0];
    if (r < statusWeights[0] + statusWeights[1]) return statuses[1];
    return statuses[2];
  }

  const txn = db.transaction(() => {
    // Insert categories
    for (const cat of categories) {
      db.prepare('INSERT INTO categories (id, name, color) VALUES (?, ?, ?)').run(cat.id, cat.name, cat.color);
    }

    // Generate 500 entries across 2025-2026
    const startDate = new Date('2025-01-01');
    const endDate = new Date('2026-02-26');
    const dayRange = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));

    for (let i = 0; i < 500; i++) {
      const cat = categories[Math.floor(Math.random() * categories.length)];
      const descs = descriptions[cat.name];
      const desc = descs[Math.floor(Math.random() * descs.length)];

      const randomDays = Math.floor(Math.random() * dayRange);
      const entryDate = new Date(startDate);
      entryDate.setDate(entryDate.getDate() + randomDays);
      const dateStr = entryDate.toISOString().split('T')[0];

      let amount;
      switch (cat.name) {
        case 'Payroll': amount = 2000 + Math.random() * 8000; break;
        case 'Marketing': amount = 200 + Math.random() * 5000; break;
        case 'Travel': amount = 100 + Math.random() * 2000; break;
        case 'Equipment': amount = 50 + Math.random() * 3000; break;
        case 'Software': amount = 10 + Math.random() * 500; break;
        case 'Services': amount = 500 + Math.random() * 5000; break;
        case 'Utilities': amount = 50 + Math.random() * 500; break;
        default: amount = 5 + Math.random() * 500; break;
      }
      amount = Math.round(amount * 100) / 100;

      const status = weightedStatus();

      db.prepare(
        'INSERT INTO entries (id, date, category_id, description, amount, status) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), dateStr, cat.id, desc, amount, status);
    }
  });

  txn();
  console.log('✅ Database seeded with 500 entries across 8 categories.');
}

// Async getter — ensures DB is initialized before use
function getDb() {
  if (db) return db;
  throw new Error('Database not initialized. Call initDb() first.');
}

// Initialize once
if (!dbReady) {
  dbReady = initDb().catch(err => {
    console.error('❌ Database initialization failed:', err);
    throw err;
  });
}

module.exports = { getDb, dbReady };
