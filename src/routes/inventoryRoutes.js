const express = require('express');
const router = express.Router();
const db = require('../config/database');
const trustService = require('../services/trustService');

// GET /api/inventory/:store_id - Get all inventory items for a store with live confidence badges
router.get('/inventory/:store_id', async (req, res) => {
  try {
    const storeId = req.params.store_id;
    await trustService.refreshStoreConfidence(storeId);

    const items = await db.prepare(`
      SELECT i.*, p.name, p.barcode, p.category, p.brand, p.pack_size, p.price, p.cost_price,
             p.is_perishable, p.shelf_life_days, p.supplier_lead_time_days
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE i.store_id = ?
      ORDER BY p.category ASC, p.name ASC
    `).all(storeId);

    const enriched = items.map(item => ({
      ...item,
      price: parseFloat(item.price),
      cost_price: parseFloat(item.cost_price),
      confidence: parseFloat(item.confidence),
      confidenceBadge: trustService.getConfidenceBadge(item.confidence, item.last_updated),
      isPerishable: Boolean(item.is_perishable),
      possibleStale: Boolean(item.possible_stale)
    }));

    res.json({ success: true, count: enriched.length, inventory: enriched });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/sales - Flow A: Normal daily selling (one-tap -1, barcode scan, POS log)
router.post('/sales', async (req, res) => {
  try {
    const { storeId, productId, barcode, quantity = 1 } = req.body;
    const saleQty = parseInt(quantity, 10) || 1;

    let targetProductId = productId;
    if (!targetProductId && barcode) {
      const prod = await db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode);
      if (prod) targetProductId = prod.id;
    }

    if (!storeId || !targetProductId) {
      return res.status(400).json({ success: false, error: 'storeId and productId (or barcode) are required' });
    }

    const inv = await db.prepare('SELECT * FROM inventory WHERE store_id = ? AND product_id = ?').get(storeId, targetProductId);
    if (!inv) {
      return res.status(404).json({ success: false, error: 'Product not stocked in this store' });
    }

    const newQty = Math.max(0, inv.quantity - saleQty);
    const nowIso = new Date().toISOString();

    await db.transaction(async () => {
      await db.prepare(`
        UPDATE inventory
        SET quantity = ?, confidence = 1.0, last_updated = ?, possible_stale = FALSE
        WHERE store_id = ? AND product_id = ?
      `).run(newQty, nowIso, storeId, targetProductId);

      await db.prepare(`
        INSERT INTO sales_log (store_id, product_id, quantity, sold_at, was_stockout_period)
        VALUES (?, ?, ?, ?, FALSE)
      `).run(storeId, targetProductId, saleQty, nowIso);
    });

    res.json({
      success: true,
      message: `Sale recorded: -${saleQty} unit(s). Remaining stock: ${newQty}`,
      productId: targetProductId,
      remainingQuantity: newQty,
      confidence: 1.0,
      lastUpdated: nowIso
    });
  } catch (error) {
    console.error('Sale error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/inventory/update - Flow B: Stock coming in or manual stock adjustment
router.post('/inventory/update', async (req, res) => {
  try {
    const { storeId, productId, barcode, quantityChange, exactQuantity, expiryDate, batchId } = req.body;

    let targetProductId = productId;
    if (!targetProductId && barcode) {
      const prod = await db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode);
      if (prod) targetProductId = prod.id;
    }

    if (!storeId || !targetProductId) {
      return res.status(400).json({ success: false, error: 'storeId and productId (or barcode) are required' });
    }

    const inv = await db.prepare('SELECT * FROM inventory WHERE store_id = ? AND product_id = ?').get(storeId, targetProductId);
    const nowIso = new Date().toISOString();

    let finalQty = 0;
    if (exactQuantity !== undefined && exactQuantity !== null) {
      finalQty = Math.max(0, parseInt(exactQuantity, 10));
    } else if (inv) {
      finalQty = Math.max(0, inv.quantity + (parseInt(quantityChange, 10) || 0));
    } else {
      finalQty = Math.max(0, parseInt(quantityChange, 10) || 0);
    }

    if (inv) {
      await db.prepare(`
        UPDATE inventory
        SET quantity = ?, confidence = 1.0, last_updated = ?, possible_stale = FALSE,
            expiry_date = COALESCE(?, expiry_date)
        WHERE store_id = ? AND product_id = ?
      `).run(finalQty, nowIso, expiryDate || null, storeId, targetProductId);
    } else {
      await db.prepare(`
        INSERT INTO inventory (store_id, product_id, batch_id, quantity, expiry_date, confidence, last_updated, possible_stale)
        VALUES (?, ?, ?, ?, ?, 1.0, ?, FALSE)
      `).run(storeId, targetProductId, batchId || 'BATCH-NEW', finalQty, expiryDate || null, nowIso);
    }

    res.json({
      success: true,
      message: 'Stock updated successfully. Confidence refreshed to 100%.',
      productId: targetProductId,
      quantity: finalQty,
      confidence: 1.0,
      lastUpdated: nowIso
    });
  } catch (error) {
    console.error('Inventory update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/confidence/confirm - Flow C: One-tap confirm ("Yes, still have this")
router.post('/confidence/confirm', async (req, res) => {
  try {
    const { storeId, productId, quantity } = req.body;
    if (!storeId || !productId) {
      return res.status(400).json({ success: false, error: 'storeId and productId are required' });
    }

    const result = await trustService.confirmInventory(storeId, productId, quantity !== undefined ? parseInt(quantity, 10) : null);
    res.json({
      success: true,
      message: 'Stock confirmed! Confidence badge reset to Green (100%).',
      ...result
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
