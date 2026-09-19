const db = require('../config/database');
const forecastingService = require('./forecastingService');
const trustService = require('./trustService');

/**
 * Stockout Risk Service
 * Flow 4.2: Evaluates risk probability, days of supply, and plain-English rationales
 */
class StockoutRiskService {
  /**
   * Evaluate stockout risk for all products in a given store
   * @param {string} storeId
   */
  async evaluateStoreRisks(storeId) {
    const items = await db.prepare(`
      SELECT i.*, p.name, p.category, p.brand, p.pack_size, p.price, p.cost_price,
             p.is_perishable, p.shelf_life_days, p.supplier_lead_time_days
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE i.store_id = ?
    `).all(storeId);

    const risks = [];
    const upsertRisk = db.prepare(`
      INSERT INTO stockout_risk (store_id, product_id, horizon_days, risk_probability, days_of_supply, plain_reason, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    // Clean current store risks
    await db.prepare('DELETE FROM stockout_risk WHERE store_id = ?').run(storeId);

    for (const item of items) {
      const forecast = await forecastingService.getForecast(storeId, item.product_id);
      const dailyDemand = Math.max(0.2, forecast.predictedDemand);
      const leadTime = item.supplier_lead_time_days || 4;

      // Available unreserved stock
      const availableStock = Math.max(0, item.quantity - item.reserved_quantity);
      const daysOfSupply = +(availableStock / dailyDemand).toFixed(1);

      // Safety stock baseline (e.g. 2 days of demand)
      const safetyStock = Math.ceil(dailyDemand * 2);

      // Projected inventory over horizons
      const projected1d = +(availableStock - dailyDemand).toFixed(1);
      const projected3d = +(availableStock - (dailyDemand * 3)).toFixed(1);
      const projected7d = +(availableStock - (dailyDemand * 7)).toFixed(1);

      // Calculate risk probabilities
      let riskProb = 0.05;
      let urgency = 'safe';

      if (availableStock <= 0) {
        riskProb = 0.99;
        urgency = 'critical';
      } else if (daysOfSupply < 1.0) {
        riskProb = 0.92;
        urgency = 'critical';
      } else if (daysOfSupply <= leadTime) {
        // High risk if stock runs out before supplier can deliver!
        riskProb = +(0.5 + (0.45 * (1 - daysOfSupply / leadTime))).toFixed(2);
        urgency = daysOfSupply <= 2 ? 'high' : 'medium';
      } else if (projected7d < safetyStock) {
        riskProb = 0.35;
        urgency = 'low';
      }

      // Plain language explanation for non-tech owners
      let reason = '';
      if (availableStock <= 0) {
        reason = `Out of stock! Daily demand is ~${dailyDemand} units. Customers leaving empty-handed.`;
      } else if (daysOfSupply < 1.5) {
        reason = `Only ${availableStock} units left, selling ~${dailyDemand}/day. Runs out in ~${Math.round(daysOfSupply * 24)} hours. Supplier takes ${leadTime} days -> immediate stockout!`;
      } else if (daysOfSupply <= leadTime) {
        reason = `${availableStock} units left (${daysOfSupply} days of supply), selling ~${dailyDemand}/day. Supplier takes ${leadTime} days -> likely stockout before delivery.`;
      } else {
        reason = `Stock healthy (${daysOfSupply} days of supply). Supplier lead time is ${leadTime} days.`;
      }

      // Save 3-day horizon risk to DB
      await upsertRisk.run(storeId, item.product_id, 3, riskProb, daysOfSupply, reason);

      const badge = trustService.getConfidenceBadge(item.confidence, item.last_updated);

      risks.push({
        storeId,
        productId: item.product_id,
        productName: item.name,
        category: item.category,
        brand: item.brand,
        packSize: item.pack_size,
        price: parseFloat(item.price),
        costPrice: parseFloat(item.cost_price),
        currentStock: item.quantity,
        availableStock,
        dailyDemand,
        leadTimeDays: leadTime,
        daysOfSupply,
        safetyStock,
        projected1d,
        projected3d,
        projected7d,
        riskProbability: riskProb,
        urgency,
        plainReason: reason,
        isAtRisk: riskProb >= 0.40,
        confidence: parseFloat(item.confidence),
        confidenceBadge: badge,
        lastUpdated: item.last_updated,
        possibleStale: Boolean(item.possible_stale)
      });
    }

    // Sort descending by risk probability
    return risks.sort((a, b) => b.riskProbability - a.riskProbability);
  }
}

module.exports = new StockoutRiskService();
