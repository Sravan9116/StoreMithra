const db = require('../config/database');

/**
 * Perishables & Freshness Service
 * Flow 4.6: Expiry tracking, freshness decay, transit radius restrictions, and waste-pooling opportunities
 */
class PerishablesService {
  /**
   * Freshness factor (0.0 to 1.0)
   * Decreases non-linearly as expiry date approaches
   */
  getFreshnessFactor(expiryDate) {
    if (!expiryDate) return 1.0;
    const now = new Date();
    const expiry = new Date(expiryDate);
    const diffMs = expiry.getTime() - now.getTime();
    const remainingDays = diffMs / (1000 * 3600 * 24);

    if (remainingDays <= 0) return 0.05; // Expired or expiring today
    if (remainingDays <= 1) return 0.50; // Critical freshness
    if (remainingDays <= 2) return 0.75;
    return 1.0;
  }

  /**
   * Maximum allowed transfer distance for perishable products based on remaining shelf life
   * Avoids sending near-expiry dairy across long distances
   */
  getMaxTransferDistanceMeters(expiryDate) {
    if (!expiryDate) return 5000; // Non-perishable default 5km
    const now = new Date();
    const expiry = new Date(expiryDate);
    const remainingDays = (expiry.getTime() - now.getTime()) / (1000 * 3600 * 24);

    if (remainingDays <= 1) return 1200; // Max 1.2km for 1-day items (immediate hyper-local handoff)
    if (remainingDays <= 2) return 2500; // Max 2.5km
    return 4000;
  }

  /**
   * Find waste risk products in a store
   * High quantity + short shelf life + low sales velocity = waste risk!
   */
  async getWasteRiskItems(storeId) {
    const items = await db.prepare(`
      SELECT i.*, p.name, p.price, p.cost_price, p.shelf_life_days
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE i.store_id = ? AND p.is_perishable = TRUE AND i.expiry_date IS NOT NULL
    `).all(storeId);

    const wasteRisks = [];
    for (const item of items) {
      const now = new Date();
      const expiry = new Date(item.expiry_date);
      const remainingDays = Math.max(0, (expiry.getTime() - now.getTime()) / (1000 * 3600 * 24));

      // Calculate recent daily sales
      const sales = await db.prepare(`
        SELECT COALESCE(SUM(quantity), 0) as total_sold
        FROM sales_log
        WHERE store_id = ? AND product_id = ? AND sold_at >= datetime('now', '-3 days')
      `).get(storeId, item.product_id);

      const totalSold = parseInt(sales?.total_sold || 0, 10);
      const dailyVelocity = Math.max(0.2, (totalSold || 1) / 3);
      const projectedSellable = Math.floor(dailyVelocity * remainingDays);
      const excessUnsellable = Math.max(0, item.quantity - projectedSellable);

      if (excessUnsellable > 0 && remainingDays <= 2.5) {
        wasteRisks.push({
          productId: item.product_id,
          productName: item.name,
          currentQuantity: item.quantity,
          remainingDays: +remainingDays.toFixed(1),
          excessUnsellable,
          potentialLoss: +(excessUnsellable * parseFloat(item.cost_price)).toFixed(2),
          urgency: remainingDays <= 1 ? 'critical' : 'moderate',
          explanation: `${excessUnsellable} units will expire in ${remainingDays.toFixed(1)} days based on current sales speed (${dailyVelocity.toFixed(1)}/day). Priority for pool transfer!`
        });
      }
    }
    return wasteRisks;
  }
}

module.exports = new PerishablesService();
