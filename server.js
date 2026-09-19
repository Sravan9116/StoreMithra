const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./src/config/database');
const seedDatabase = require('./src/seed/seedData');

// Route imports
const storeRoutes = require('./src/routes/storeRoutes');
const inventoryRoutes = require('./src/routes/inventoryRoutes');
const transferRoutes = require('./src/routes/transferRoutes');
const analyticsRoutes = require('./src/routes/analyticsRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets with no-cache in dev
const staticOpts = { etag: false, maxAge: 0, setHeaders: (res) => res.set('Cache-Control', 'no-store, no-cache, must-revalidate') };
app.use('/public', express.static(path.join(__dirname, 'public'), staticOpts));
app.use(express.static(path.join(__dirname, 'public'), staticOpts));
app.use(express.static(__dirname, { ...staticOpts, index: false }));

// API Routes
app.use('/api', storeRoutes);
app.use('/api', inventoryRoutes);
app.use('/api', transferRoutes);
app.use('/api', analyticsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'StoreMithra Platform',
    database: 'PostgreSQL 15',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Page Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'overview.html'));
});

app.get('/overview', (req, res) => {
  res.sendFile(path.join(__dirname, 'overview.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

// Fallback to overview or dashboard based on path
app.use((req, res) => {
  if (req.path.startsWith('/dashboard') || req.path.startsWith('/app')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    res.sendFile(path.join(__dirname, 'overview.html'));
  }
});

async function startServer() {
  try {
    await db.init();
    const countRow = await db.prepare('SELECT COUNT(*) as count FROM stores').get();
    const storeCount = parseInt(countRow?.count || 0, 10);
    if (storeCount === 0) {
      console.log('Database empty on startup. Running initial seed in PostgreSQL...');
      await seedDatabase();
    }
  } catch (err) {
    console.warn('Database initialization note:', err.message);
  }

  app.listen(PORT, () => {
    console.log('====================================================');
    console.log(`🚀 StoreMithra Platform running on http://localhost:${PORT}`);
    console.log(`📍 Serving UI & APIs with PostgreSQL:`);
    console.log(`   - Frontend: http://localhost:${PORT}`);
    console.log(`   - API Health: http://localhost:${PORT}/api/health`);
    console.log(`   - Stores List: http://localhost:${PORT}/api/stores`);
    console.log('====================================================');
  });
}

startServer();

module.exports = app;
