const express = require('express');
const router = express.Router();
const db = require('../config/database');
const forecastingService = require('../services/forecastingService');
const stockoutRiskService = require('../services/stockoutRiskService');
const poolingService = require('../services/poolingService');
const decisionEngine = require('../services/decisionEngine');
const trustService = require('../services/trustService');
const perishablesService = require('../services/perishablesService');

// POST /api/auth/login - Store Merchant Login with Phone + PIN
router.post('/auth/login', async (req, res) => {
  try {
    const { phone, pin } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number is required' });
    }

    // Clean phone input by removing spaces, dashes, and country code prefix
    const digitsOnly = phone.replace(/\D/g, '').slice(-10);
    const cleanPin = (pin || '1234').toString().trim();

    // Query PostgreSQL stores by matching normalized digits
    const store = await db.prepare(`
      SELECT * FROM stores 
      WHERE regexp_replace(phone, '[^0-9]', '', 'g') LIKE ?
    `).get(`%${digitsOnly}%`);

    if (!store) {
      return res.status(401).json({ success: false, error: 'Store profile not found for this phone number.' });
    }

    if (store.pin && store.pin !== cleanPin) {
      return res.status(401).json({ success: false, error: 'Incorrect 4-digit PIN. Default is 1234.' });
    }

    // Generate session token
    const token = `SM-SESSION-${store.id}-${Date.now()}`;
    await db.prepare(`
      INSERT INTO store_sessions (token, store_id, expires_at)
      VALUES (?, ?, (NOW() + INTERVAL '30 days'))
    `).run(token, store.id);

    // Don't leak pin
    const safeStore = { ...store };
    delete safeStore.pin;

    res.json({
      success: true,
      message: `Welcome back, ${store.owner_name}! Logged into ${store.name}.`,
      token,
      store: safeStore
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/auth/register - Register new Kirana Merchant and store
router.post('/auth/register', async (req, res) => {
  try {
    const {
      name,
      owner_name,
      phone,
      pin,
      upi_id,
      address,
      lat,
      lng,
      data_sharing_mode,
      seed_starter_inventory = true
    } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, error: 'Mobile number is required' });
    }
    if (!name) {
      return res.status(400).json({ success: false, error: 'Store name is required' });
    }

    const digitsOnly = phone.replace(/\D/g, '').slice(-10);
    if (digitsOnly.length < 10) {
      return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit mobile number' });
    }

    // Check if phone already registered
    const existing = await db.prepare(`
      SELECT id, name, owner_name FROM stores
      WHERE regexp_replace(phone, '[^0-9]', '', 'g') LIKE ?
    `).get(`%${digitsOnly}%`);

    if (existing) {
      return res.status(400).json({
        success: false,
        error: `A store (${existing.name}) is already registered with mobile number ending in ${digitsOnly}. Please log in.`
      });
    }

    // Generate new store ID (e.g., STORE_6, STORE_7)
    const existingStores = await db.all('SELECT id FROM stores');
    let maxId = 0;
    for (const s of existingStores) {
      const match = s.id.match(/^STORE_(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxId) maxId = num;
      }
    }
    const newStoreId = `STORE_${maxId + 1}`;

    const cleanPin = (pin || '1234').toString().trim();
    const cleanOwner = (owner_name || 'Kirana Merchant').trim();
    const cleanName = name.trim();
    const formattedPhone = `+91 ${digitsOnly.slice(0, 5)} ${digitsOnly.slice(5)}`;
    const cleanAddress = (address || 'Indiranagar, Bangalore, Karnataka').trim();
    const cleanUpi = (upi_id || `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '')}@okaxis`).trim();
    const cleanLat = lat !== undefined && lat !== null && !isNaN(parseFloat(lat)) ? parseFloat(lat) : 12.9716;
    const cleanLng = lng !== undefined && lng !== null && !isNaN(parseFloat(lng)) ? parseFloat(lng) : 77.5946;
    const cleanSharing = ['full', 'limited', 'privacy_preserving'].includes(data_sharing_mode)
      ? data_sharing_mode
      : 'full';

    // Insert into stores
    await db.prepare(`
      INSERT INTO stores (
        id, name, owner_name, phone, pin, upi_id, lat, lng, address, reputation_score, data_sharing_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.90, ?)
    `).run(
      newStoreId,
      cleanName,
      cleanOwner,
      formattedPhone,
      cleanPin,
      cleanUpi,
      cleanLat,
      cleanLng,
      cleanAddress,
      cleanSharing
    );

    // Optionally seed starter inventory from the product catalogue
    if (seed_starter_inventory) {
      const products = await db.all('SELECT id, is_perishable, shelf_life_days FROM products');
      for (const p of products) {
        const qty = p.is_perishable ? Math.floor(Math.random() * 15) + 10 : Math.floor(Math.random() * 25) + 20;
        let expiry = null;
        if (p.is_perishable && p.shelf_life_days) {
          const expDate = new Date();
          expDate.setDate(expDate.getDate() + Math.min(p.shelf_life_days, 5));
          expiry = expDate.toISOString().split('T')[0];
        }
        await db.prepare(`
          INSERT INTO inventory (store_id, product_id, batch_id, quantity, reserved_quantity, expiry_date, confidence, last_updated)
          VALUES (?, ?, 'BATCH-001', ?, 0, ?, 0.98, NOW())
          ON CONFLICT (store_id, product_id, batch_id) DO NOTHING
        `).run(newStoreId, p.id, qty, expiry);
      }
    }

    // Generate active session token
    const token = `SM-SESSION-${newStoreId}-${Date.now()}`;
    await db.prepare(`
      INSERT INTO store_sessions (token, store_id, expires_at)
      VALUES (?, ?, (NOW() + INTERVAL '30 days'))
    `).run(token, newStoreId);

    const store = await db.prepare('SELECT * FROM stores WHERE id = ?').get(newStoreId);
    const safeStore = { ...store };
    delete safeStore.pin;

    res.status(201).json({
      success: true,
      message: `Store ${cleanName} registered successfully! Starter inventory provisioned.`,
      token,
      store: safeStore
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/auth/logout - Revoke active session
router.post('/auth/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '') || req.body?.token;
    if (token) {
      await db.prepare('DELETE FROM store_sessions WHERE token = ?').run(token);
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/auth/demo-switch - 1-Click Fast Switch between demo stores
router.post('/auth/demo-switch', async (req, res) => {
  try {
    const { storeId } = req.body;
    const store = await db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId || 'STORE_1');
    if (!store) {
      return res.status(404).json({ success: false, error: 'Store not found' });
    }

    const token = `SM-SESSION-${store.id}-${Date.now()}`;
    await db.prepare(`
      INSERT INTO store_sessions (token, store_id, expires_at)
      VALUES (?, ?, (NOW() + INTERVAL '30 days'))
    `).run(token, store.id);

    const safeStore = { ...store };
    delete safeStore.pin;

    res.json({
      success: true,
      message: `Switched store context to ${store.name}`,
      token,
      store: safeStore
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/auth/me - Validate current session or get default active store
router.get('/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '') || req.query.token;
    const storeIdHeader = req.headers['x-store-id'] || req.query.store_id;

    let store = null;

    if (token) {
      const session = await db.prepare(`
        SELECT s.*, st.*
        FROM store_sessions s
        JOIN stores st ON s.store_id = st.id
        WHERE s.token = ? AND (s.expires_at IS NULL OR s.expires_at > NOW())
      `).get(token);
      if (session) {
        store = session;
      }
    }

    if (!store && storeIdHeader) {
      store = await db.prepare('SELECT * FROM stores WHERE id = ?').get(storeIdHeader);
    }

    if (!store) {
      // Default to STORE_1
      store = await db.prepare('SELECT * FROM stores ORDER BY id ASC LIMIT 1').get();
    }

    if (!store) {
      return res.status(404).json({ success: false, error: 'No active store found' });
    }

    const safeStore = { ...store };
    delete safeStore.pin;

    res.json({ success: true, store: safeStore });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/stores/:id/profile - Get full merchant profile & metrics
router.get('/stores/:id/profile', async (req, res) => {
  try {
    const storeId = req.params.id;
    const store = await db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId);
    if (!store) {
      return res.status(404).json({ success: false, error: 'Store not found' });
    }

    const inventoryStats = await db.prepare(`
      SELECT COUNT(DISTINCT product_id) as total_skus,
             COALESCE(SUM(quantity), 0) as total_units,
             COALESCE(AVG(confidence), 1.0) as avg_confidence
      FROM inventory
      WHERE store_id = ?
    `).get(storeId);

    const transferStats = await db.prepare(`
      SELECT COUNT(*) as total_transfers,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_transfers,
             COALESCE(SUM(CASE WHEN status = 'completed' THEN expected_benefit ELSE 0 END), 0) as total_saved
      FROM transfer_orders
      WHERE from_store_id = ? OR to_store_id = ?
    `).get(storeId, storeId);

    const safeStore = { ...store };
    delete safeStore.pin;

    res.json({
      success: true,
      store: safeStore,
      stats: {
        totalSkus: parseInt(inventoryStats?.total_skus || 0, 10),
        totalUnits: parseInt(inventoryStats?.total_units || 0, 10),
        avgConfidence: +(parseFloat(inventoryStats?.avg_confidence || 1.0) * 100).toFixed(1),
        totalTransfers: parseInt(transferStats?.total_transfers || 0, 10),
        completedTransfers: parseInt(transferStats?.completed_transfers || 0, 10),
        totalSaved: parseFloat(transferStats?.total_saved || 0)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/stores/:id/profile - Update merchant profile settings in PostgreSQL
router.put('/stores/:id/profile', async (req, res) => {
  try {
    const storeId = req.params.id;
    const { owner_name, phone, pin, upi_id, data_sharing_mode, address } = req.body;

    const existing = await db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Store not found' });
    }

    const updatedOwner = owner_name || existing.owner_name;
    const updatedPhone = phone || existing.phone;
    const updatedPin = pin ? pin.toString().trim() : existing.pin;
    const updatedUpi = upi_id || existing.upi_id;
    const updatedSharing = data_sharing_mode || existing.data_sharing_mode;
    const updatedAddress = address || existing.address;

    await db.prepare(`
      UPDATE stores
      SET owner_name = ?, phone = ?, pin = ?, upi_id = ?, data_sharing_mode = ?, address = ?
      WHERE id = ?
    `).run(updatedOwner, updatedPhone, updatedPin, updatedUpi, updatedSharing, updatedAddress, storeId);

    const fresh = await db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId);
    const safeStore = { ...fresh };
    delete safeStore.pin;

    res.json({
      success: true,
      message: 'Store profile successfully updated in PostgreSQL database!',
      store: safeStore
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/stores - List all stores in network
router.get('/stores', async (req, res) => {
  try {
    const stores = await db.prepare(`
      SELECT s.id, s.name, s.owner_name, s.phone, s.upi_id, s.lat, s.lng, s.address,
             s.reputation_score, s.data_sharing_mode, s.created_at,
             COUNT(i.product_id) as total_products,
             COALESCE(SUM(i.quantity), 0) as total_inventory_units
      FROM stores s
      LEFT JOIN inventory i ON s.id = i.store_id
      GROUP BY s.id
      ORDER BY s.id ASC
    `).all();

    res.json({ success: true, stores });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/stores/:id/dashboard - Complete dashboard for a store
router.get('/stores/:id/dashboard', async (req, res) => {
  try {
    const storeId = req.params.id;
    const store = await db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId);
    if (!store) {
      return res.status(404).json({ success: false, error: 'Store not found' });
    }

    // Refresh trust / decay
    await trustService.refreshStoreConfidence(storeId);

    // Get recommendations (the decision engine output)
    const recommendations = await decisionEngine.generateRecommendations(storeId);

    // Get risks
    const risks = await stockoutRiskService.evaluateStoreRisks(storeId);
    const atRiskCount = risks.filter(r => r.isAtRisk).length;

    // Get nudges
    const nudges = await trustService.getDailyNudges(storeId);

    // Get waste risk items (perishables expiring soon)
    const wasteRisks = await perishablesService.getWasteRiskItems(storeId);

    // Get active transfers count
    const activeTransfers = await db.prepare(`
      SELECT COUNT(*) as count
      FROM transfer_orders
      WHERE (from_store_id = ? OR to_store_id = ?)
        AND status IN ('pending', 'accepted', 'in_transit')
    `).get(storeId, storeId);

    // Today's total avoided lost sales from recommendations
    const totalPotentialSavings = recommendations.reduce((acc, r) => acc + Math.max(0, r.winner.expectedBenefit), 0);

    const safeStore = { ...store };
    delete safeStore.pin;

    res.json({
      success: true,
      store: safeStore,
      metrics: {
        atRiskCount,
        wasteRiskCount: wasteRisks.length,
        activeTransfersCount: parseInt(activeTransfers?.count || 0, 10),
        totalPotentialSavings: +totalPotentialSavings.toFixed(2),
        totalProductsTracked: risks.length
      },
      nudges,
      wasteRisks,
      recommendations,
      risks: risks.slice(0, 10) // top 10 risks
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/stores/nearby - Nearby store discovery with Leaflet coordinates
router.get('/stores/nearby', async (req, res) => {
  try {
    const { lat, lng, radius = 3000, currentStoreId } = req.query;
    const centerLat = parseFloat(lat);
    const centerLng = parseFloat(lng);

    if (isNaN(centerLat) || isNaN(centerLng)) {
      return res.status(400).json({ success: false, error: 'Valid lat and lng required' });
    }

    const stores = await db.prepare('SELECT id, name, owner_name, phone, upi_id, lat, lng, address, reputation_score, data_sharing_mode FROM stores').all();
    const nearby = [];

    for (const store of stores) {
      if (currentStoreId && store.id === currentStoreId) continue;

      const dist = poolingService.calculateDistanceMeters(centerLat, centerLng, store.lat, store.lng);
      if (dist <= parseFloat(radius)) {
        nearby.push({
          ...store,
          distanceMeters: dist,
          distanceKm: +(dist / 1000).toFixed(2)
        });
      }
    }

    res.json({
      success: true,
      radiusMeters: parseFloat(radius),
      count: nearby.length,
      stores: nearby.sort((a, b) => a.distanceMeters - b.distanceMeters)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/forecast/:store_id/:product_id
router.get('/forecast/:store_id/:product_id', async (req, res) => {
  try {
    const { store_id, product_id } = req.params;
    const forecast = await forecastingService.getForecast(store_id, product_id);
    const product = await db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
    const sales = await db.prepare(`
      SELECT quantity, sold_at, was_stockout_period
      FROM sales_log
      WHERE store_id = ? AND product_id = ?
      ORDER BY sold_at DESC
      LIMIT 14
    `).all(store_id, product_id);

    res.json({
      success: true,
      storeId: store_id,
      productId: product_id,
      product,
      forecast,
      recentSales: sales
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/stockout-risk/:store_id
router.get('/stockout-risk/:store_id', async (req, res) => {
  try {
    const risks = await stockoutRiskService.evaluateStoreRisks(req.params.store_id);
    res.json({ success: true, count: risks.length, risks });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/recommendations/:store_id
router.get('/recommendations/:store_id', async (req, res) => {
  try {
    const recommendations = await decisionEngine.generateRecommendations(req.params.store_id);
    res.json({ success: true, count: recommendations.length, recommendations });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/substitutes/:product_id
router.get('/substitutes/:product_id', async (req, res) => {
  try {
    const subs = await db.prepare(`
      SELECT s.*, p.name, p.brand, p.price, p.pack_size
      FROM substitutions s
      JOIN products p ON s.substitute_product_id = p.id
      WHERE s.product_id = ?
      ORDER BY s.similarity_score DESC
    `).all(req.params.product_id);

    res.json({ success: true, productId: req.params.product_id, substitutes: subs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
