const express = require('express');
const router = express.Router();
const db = require('../config/database');
const trustService = require('../services/trustService');

// GET /api/transfers/:store_id - Get all transfers involving this store
router.get('/transfers/:store_id', async (req, res) => {
  try {
    const storeId = req.params.store_id;

    // Incoming requests (Other store is requesting stock from ME)
    const incomingRequests = await db.prepare(`
      SELECT t.*,
             p.name as product_name, p.pack_size, p.brand, p.price as retail_price,
             s_from.name as from_store_name, s_from.reputation_score as from_reputation,
             s_to.name as to_store_name, s_to.reputation_score as to_reputation
      FROM transfer_orders t
      JOIN products p ON t.product_id = p.id
      JOIN stores s_from ON t.from_store_id = s_from.id
      JOIN stores s_to ON t.to_store_id = s_to.id
      WHERE t.from_store_id = ?
      ORDER BY t.created_at DESC
    `).all(storeId);

    // Outgoing requests (I requested stock from another store)
    const outgoingRequests = await db.prepare(`
      SELECT t.*,
             p.name as product_name, p.pack_size, p.brand, p.price as retail_price,
             s_from.name as from_store_name, s_from.reputation_score as from_reputation,
             s_to.name as to_store_name, s_to.reputation_score as to_reputation
      FROM transfer_orders t
      JOIN products p ON t.product_id = p.id
      JOIN stores s_from ON t.from_store_id = s_from.id
      JOIN stores s_to ON t.to_store_id = s_to.id
      WHERE t.to_store_id = ?
      ORDER BY t.created_at DESC
    `).all(storeId);

    const enrichTransfer = (t) => ({
      ...t,
      quantity: parseInt(t.quantity, 10),
      transfer_price: parseFloat(t.transfer_price),
      transfer_cost: parseFloat(t.transfer_cost),
      expected_benefit: parseFloat(t.expected_benefit),
      delivered_quantity: t.delivered_quantity !== null ? parseInt(t.delivered_quantity, 10) : null
    });

    res.json({
      success: true,
      storeId,
      incomingRequests: incomingRequests.map(enrichTransfer),
      outgoingRequests: outgoingRequests.map(enrichTransfer)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/transfers - Create a new transfer request
router.post('/transfers', async (req, res) => {
  try {
    const { fromStoreId, toStoreId, productId, quantity, transferPrice, transferCost, expectedBenefit } = req.body;

    if (!fromStoreId || !toStoreId || !productId || !quantity) {
      return res.status(400).json({ success: false, error: 'Missing required transfer fields' });
    }

    const transferId = 'TRF-' + Date.now().toString().slice(-6);
    const nowIso = new Date().toISOString();

    await db.prepare(`
      INSERT INTO transfer_orders (id, from_store_id, to_store_id, product_id, quantity, transfer_price, transfer_cost, status, expected_benefit, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      transferId,
      fromStoreId,
      toStoreId,
      productId,
      parseInt(quantity, 10),
      parseFloat(transferPrice) || 0,
      parseFloat(transferCost) || 30.0,
      parseFloat(expectedBenefit) || 0,
      nowIso
    );

    res.json({
      success: true,
      message: 'Transfer order requested successfully.',
      transferId,
      status: 'pending'
    });
  } catch (error) {
    console.error('Create transfer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/transfers/:id - Update status (accept, decline, in_transit, complete)
router.patch('/transfers/:id', async (req, res) => {
  try {
    const transferId = req.params.id;
    const { status, deliveredQuantity } = req.body;

    const allowed = ['accepted', 'declined', 'in_transit', 'completed'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${allowed.join(', ')}` });
    }

    const transfer = await db.prepare('SELECT * FROM transfer_orders WHERE id = ?').get(transferId);
    if (!transfer) {
      return res.status(404).json({ success: false, error: 'Transfer order not found' });
    }

    const nowIso = new Date().toISOString();

    if (status === 'completed') {
      const delivered = deliveredQuantity !== undefined ? parseInt(deliveredQuantity, 10) : transfer.quantity;

      // Atomic execution: adjust inventories and update reputation
      await db.transaction(async () => {
        // 1. Decrement sender inventory
        const senderInv = await db.prepare('SELECT quantity FROM inventory WHERE store_id = ? AND product_id = ?').get(transfer.from_store_id, transfer.product_id);
        const newSenderQty = Math.max(0, (senderInv?.quantity || 0) - delivered);
        await db.prepare(`
          UPDATE inventory
          SET quantity = ?, last_updated = ?
          WHERE store_id = ? AND product_id = ?
        `).run(newSenderQty, nowIso, transfer.from_store_id, transfer.product_id);

        // 2. Increment receiver inventory and refresh confidence to 1.0
        const receiverInv = await db.prepare('SELECT quantity FROM inventory WHERE store_id = ? AND product_id = ?').get(transfer.to_store_id, transfer.product_id);
        const newReceiverQty = (receiverInv?.quantity || 0) + delivered;
        await db.prepare(`
          UPDATE inventory
          SET quantity = ?, confidence = 1.0, last_updated = ?, possible_stale = FALSE
          WHERE store_id = ? AND product_id = ?
        `).run(newReceiverQty, nowIso, transfer.to_store_id, transfer.product_id);

        // 3. Update transfer order status
        await db.prepare(`
          UPDATE transfer_orders
          SET status = 'completed', delivered_quantity = ?, resolved_at = ?
          WHERE id = ?
        `).run(delivered, nowIso, transferId);

        // 4. Update reputation score for sender store
        await trustService.updateStoreReputation(transfer.from_store_id, transfer.quantity, delivered);
      });

      return res.json({
        success: true,
        message: `Transfer ${transferId} completed! Delivered ${delivered} units. Inventories and reputation scores updated in PostgreSQL.`,
        status: 'completed',
        deliveredQuantity: delivered
      });
    }

    // Otherwise simple status transition (accepted, declined, in_transit)
    await db.prepare(`
      UPDATE transfer_orders
      SET status = ?, resolved_at = ?
      WHERE id = ?
    `).run(status, status === 'declined' ? nowIso : null, transferId);

    res.json({
      success: true,
      message: `Transfer ${transferId} marked as ${status}.`,
      transferId,
      status
    });
  } catch (error) {
    console.error('Transfer update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
