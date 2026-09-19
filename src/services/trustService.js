const db = require('../config/database');

/**
 * Trust & Confidence Service
 * Flow C: The owner forgets to update stock (the critical real-world problem)
 * - Decays confidence dynamically based on elapsed hours
 * - Flags possible_stale when category sells but SKU stays silent
 * - Updates store reputation score
 * - Generates low-friction daily nudges
 */
class TrustService {
  /**
   * Calculate confidence score from last_updated ISO timestamp
   * Linear decay: 1.0 at update time, down to ~0.3 after 6 days
   * @param {string} lastUpdatedIso
   * @returns {number} confidence 0.2 to 1.0
   */
  calculateConfidence(lastUpdatedIso) {
    if (!lastUpdatedIso) return 0.3;
    const elapsedHours = Math.max(0, (Date.now() - new Date(lastUpdatedIso).getTime()) / (1000 * 3600));
    const elapsedDays = elapsedHours / 24;

    // Decay rate: -0.11 per day
    const decayed = 1.0 - (elapsedDays * 0.11);
    return Math.max(0.25, Math.min(1.0, +decayed.toFixed(2)));
  }

  /**
   * Get UI status badge: green (confirmed), yellow (stale 3+ days), red (unconfirmed > 6 days)
   */
  getConfidenceBadge(confidence, lastUpdatedIso) {
    const elapsedHours = Math.max(0, (Date.now() - new Date(lastUpdatedIso).getTime()) / (1000 * 3600));
    const elapsedDays = Math.floor(elapsedHours / 24);

    let level = 'high';
    let label = 'Confirmed today';
    let color = '#10b981'; // green

    if (confidence < 0.5 || elapsedDays >= 6) {
      level = 'low';
      label = `Unconfirmed (${elapsedDays}d ago)`;
      color = '#ef4444'; // red
    } else if (confidence < 0.8 || elapsedDays >= 2) {
      level = 'medium';
      label = `Stale (${elapsedDays}d ago)`;
      color = '#f59e0b'; // amber
    } else if (elapsedHours < 24) {
      label = elapsedHours < 1 ? 'Confirmed just now' : `Confirmed ${Math.round(elapsedHours)}h ago`;
    }

    return { level, label, color, confidence: parseFloat(confidence), elapsedDays };
  }

  /**
   * Refresh all inventory confidence scores & detect possible_stale items
   */
  async refreshStoreConfidence(storeId) {
    const items = await db.prepare(`
      SELECT i.*, p.category, p.name
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE i.store_id = ?
    `).all(storeId);

    const updateStmt = db.prepare(`
      UPDATE inventory
      SET confidence = ?, possible_stale = ?
      WHERE store_id = ? AND product_id = ? AND batch_id = ?
    `);

    // Check recent category sales in this store to detect silent items
    const catSales = await db.prepare(`
      SELECT p.category, COUNT(sl.id) as sales_count
      FROM sales_log sl
      JOIN products p ON sl.product_id = p.id
      WHERE sl.store_id = ? AND sl.sold_at >= datetime('now', '-5 days')
      GROUP BY p.category
    `).all(storeId);

    const activeCategories = new Set(catSales.filter(c => parseInt(c.sales_count, 10) > 4).map(c => c.category));

    for (const item of items) {
      const conf = this.calculateConfidence(item.last_updated);

      // Check sales for this specific SKU
      const skuSales = await db.prepare(`
        SELECT COUNT(id) as count
        FROM sales_log
        WHERE store_id = ? AND product_id = ? AND sold_at >= datetime('now', '-5 days')
      `).get(storeId, item.product_id);

      const elapsedDays = (Date.now() - new Date(item.last_updated).getTime()) / (1000 * 3600 * 24);
      const isPossibleStale = (activeCategories.has(item.category) && parseInt(skuSales?.count || 0, 10) === 0 && elapsedDays > 3);

      await updateStmt.run(conf, isPossibleStale, storeId, item.product_id, item.batch_id);
    }
  }

  /**
   * One-tap lightweight daily nudge generator
   * Selects 1 or 2 items with dropping confidence to ask the owner
   */
  async getDailyNudges(storeId) {
    const candidates = await db.prepare(`
      SELECT i.product_id, i.quantity, i.confidence, i.last_updated, i.possible_stale,
             p.name, p.pack_size, p.category
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE i.store_id = ? AND (i.confidence < 0.75 OR i.possible_stale = TRUE)
      ORDER BY i.confidence ASC, i.last_updated ASC
      LIMIT 2
    `).all(storeId);

    return candidates.map(c => ({
      productId: c.product_id,
      productName: c.name,
      packSize: c.pack_size,
      quantity: c.quantity,
      confidence: parseFloat(c.confidence),
      possibleStale: Boolean(c.possible_stale),
      promptText: `Quick check: still have ~${c.quantity} units of ${c.name} (${c.pack_size})?`,
      lastUpdated: c.last_updated
    }));
  }

  /**
   * Reset confidence when owner confirms or adjusts stock
   */
  async confirmInventory(storeId, productId, newQuantity = null) {
    const nowIso = new Date().toISOString();
    if (newQuantity !== null && newQuantity >= 0) {
      await db.prepare(`
        UPDATE inventory
        SET quantity = ?, confidence = 1.0, last_updated = ?, possible_stale = FALSE
        WHERE store_id = ? AND product_id = ?
      `).run(newQuantity, nowIso, storeId, productId);
    } else {
      await db.prepare(`
        UPDATE inventory
        SET confidence = 1.0, last_updated = ?, possible_stale = FALSE
        WHERE store_id = ? AND product_id = ?
      `).run(nowIso, storeId, productId);
    }
    return { success: true, confidence: 1.0, lastUpdated: nowIso };
  }

  /**
   * Update store reputation upon transfer completion
   */
  async updateStoreReputation(storeId, promisedQty, deliveredQty) {
    const accuracy = Math.min(1.0, Math.max(0.0, deliveredQty / Math.max(1, promisedQty)));
    const store = await db.prepare('SELECT reputation_score FROM stores WHERE id = ?').get(storeId);
    if (!store) return;

    // Moving average of reputation
    const currentRep = parseFloat(store.reputation_score) || 0.8;
    const newRep = +(currentRep * 0.85 + accuracy * 0.15).toFixed(2);

    await db.prepare('UPDATE stores SET reputation_score = ? WHERE id = ?').run(newRep, storeId);
    return newRep;
  }
}

module.exports = new TrustService();
