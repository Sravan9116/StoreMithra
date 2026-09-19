const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'storemithra',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error:', err);
});

function formatSql(sql, params) {
  let cleaned = sql
    .replace(/datetime\('now',\s*'-?(\d+)\s*days?'\)/gi, (m, d) => `(NOW() - INTERVAL '${d} days')`)
    .replace(/datetime\('now',\s*'\+(\d+)\s*days?'\)/gi, (m, d) => `(NOW() + INTERVAL '${d} days')`)
    .replace(/datetime\('now'\)/gi, 'NOW()')
    .replace(/date\('now'\)/gi, 'CURRENT_DATE');

  if (Array.isArray(params)) {
    let index = 1;
    const text = cleaned.replace(/\?/g, () => `$${index++}`);
    return { text, values: params };
  } else if (params && typeof params === 'object') {
    const values = [];
    let index = 1;
    const text = cleaned.replace(/[@:]([a-zA-Z0-9_]+)/g, (match, key) => {
      values.push(params[key]);
      return `$${index++}`;
    });
    return { text, values };
  }
  return { text: cleaned, values: [] };
}

const db = {
  pool,

  async query(sql, params = []) {
    const { text, values } = formatSql(sql, params);
    return pool.query(text, values);
  },

  async get(sql, ...args) {
    const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : (args.length === 1 && typeof args[0] === 'object' && args[0] !== null ? args[0] : args);
    const { text, values } = formatSql(sql, params);
    const res = await pool.query(text, values);
    return res.rows[0] || null;
  },

  async all(sql, ...args) {
    const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : (args.length === 1 && typeof args[0] === 'object' && args[0] !== null ? args[0] : args);
    const { text, values } = formatSql(sql, params);
    const res = await pool.query(text, values);
    return res.rows;
  },

  async run(sql, ...args) {
    const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : (args.length === 1 && typeof args[0] === 'object' && args[0] !== null ? args[0] : args);
    const { text, values } = formatSql(sql, params);
    const res = await pool.query(text, values);
    return {
      rowCount: res.rowCount,
      rows: res.rows
    };
  },

  async exec(sql) {
    return pool.query(sql);
  },

  prepare(sql) {
    return {
      get: async (...args) => db.get(sql, ...args),
      all: async (...args) => db.all(sql, ...args),
      run: async (...args) => db.run(sql, ...args)
    };
  },

  async transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async init() {
    const pgdataPath = path.join(__dirname, '..', '..', 'data', 'pgdata');
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      if ((err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) && fs.existsSync(pgdataPath)) {
        console.log('🔄 PostgreSQL server is offline. Starting local PostgreSQL cluster...');
        const { spawnSync } = require('child_process');
        try {
          spawnSync('pg_ctl', ['-D', pgdataPath, '-l', path.join(pgdataPath, 'postgres.log'), 'start'], { shell: true });
          await new Promise(r => setTimeout(r, 1500));
        } catch (e) {
          console.warn('Could not auto-start pg_ctl:', e.message);
        }
      }
    }
    const schemaPath = path.join(__dirname, '..', 'models', 'schema.pg.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(sql);
    }
  }
};

module.exports = db;
