const db = require('../config/database');

/**
 * Forecasting Service
 * - Moving Average (7-day / 14-day)
 * - Croston's Method for intermittent demand (low volume SKUs)
 * - Censored demand handling (accounting for stockout days)
 * - Hierarchical fallback to category averages
 */
class ForecastingService {
  /**
   * Calculate forecast for a store-product pair
   * @param {string} storeId
   * @param {string} productId
   * @returns {Promise<object>} { predictedDemand, lowerBound, upperBound, modelUsed }
   */
  async getForecast(storeId, productId) {
    // 1. Fetch sales logs for the past 14 days
    const sales = await db.prepare(`
      SELECT quantity, sold_at, was_stockout_period
      FROM sales_log
      WHERE store_id = ? AND product_id = ?
      ORDER BY sold_at DESC
      LIMIT 14
    `).all(storeId, productId);

    const product = await db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) {
      return { predictedDemand: 2.0, lowerBound: 1.0, upperBound: 3.0, modelUsed: 'default_fallback' };
    }

    // 2. If insufficient data (< 3 records), fallback to Category Average across the network
    if (!sales || sales.length < 3) {
      return await this._getCategoryFallback(product.category, storeId);
    }

    // 3. Check for intermittency (many zero-sales days)
    const zeroDaysCount = sales.filter(s => s.quantity === 0 && !s.was_stockout_period).length;
    const isIntermittent = (zeroDaysCount / sales.length) > 0.45;

    if (isIntermittent) {
      return this._calculateCroston(sales, product);
    }

    // 4. Moving average with Censored Demand Correction
    return this._calculateMovingAverageWithCensoredDemand(sales, product, storeId);
  }

  /**
   * Moving Average with Censored Demand correction
   */
  _calculateMovingAverageWithCensoredDemand(sales, product, storeId) {
    // If a day was a stockout period and quantity is 0, estimate what demand would have been
    const adjustedQuantities = sales.map(s => {
      if (s.was_stockout_period && s.quantity === 0) {
        return Math.max(2, Math.round(product.price > 200 ? 2 : 4));
      }
      return s.quantity;
    });

    const sum = adjustedQuantities.reduce((acc, q) => acc + q, 0);
    const mean = sum / adjustedQuantities.length;

    // Standard deviation for bounds
    const variance = adjustedQuantities.reduce((acc, q) => acc + Math.pow(q - mean, 2), 0) / adjustedQuantities.length;
    const stdDev = Math.sqrt(variance);

    const predicted = Math.max(0.5, +mean.toFixed(1));
    const lower = Math.max(0.2, +(mean - 1.28 * stdDev).toFixed(1));
    const upper = +(mean + 1.28 * stdDev).toFixed(1);

    return {
      predictedDemand: predicted,
      lowerBound: lower,
      upperBound: upper,
      modelUsed: 'censored_rolling_average_14d'
    };
  }

  /**
   * Croston's Method for intermittent demand:
   * Models non-zero demand size (z) and demand interval (p)
   */
  _calculateCroston(sales, product) {
    const nonZeroDemands = [];
    let intervals = [];
    let currentInterval = 1;

    for (let i = sales.length - 1; i >= 0; i--) {
      const q = sales[i].quantity;
      if (q > 0) {
        nonZeroDemands.push(q);
        intervals.push(currentInterval);
        currentInterval = 1;
      } else {
        currentInterval++;
      }
    }

    if (nonZeroDemands.length === 0) {
      return { predictedDemand: 0.5, lowerBound: 0.1, upperBound: 1.2, modelUsed: 'croston_zero_baseline' };
    }

    const avgSize = nonZeroDemands.reduce((a, b) => a + b, 0) / nonZeroDemands.length;
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    // Croston demand rate = avgSize / avgInterval
    const rate = +(avgSize / Math.max(1, avgInterval)).toFixed(1);
    const lower = Math.max(0.1, +(rate * 0.6).toFixed(1));
    const upper = +(rate * 1.6).toFixed(1);

    return {
      predictedDemand: Math.max(0.3, rate),
      lowerBound: lower,
      upperBound: upper,
      modelUsed: 'croston_intermittent'
    };
  }

  /**
   * Hierarchical fallback: Category average across network
   */
  async _getCategoryFallback(category, storeId) {
    const row = await db.prepare(`
      SELECT AVG(sl.quantity) as avg_cat_sales
      FROM sales_log sl
      JOIN products p ON sl.product_id = p.id
      WHERE p.category = ? AND sl.sold_at >= datetime('now', '-7 days')
    `).get(category);

    const avg = row && row.avg_cat_sales ? +parseFloat(row.avg_cat_sales).toFixed(1) : 3.0;
    return {
      predictedDemand: avg,
      lowerBound: Math.max(0.5, +(avg * 0.7).toFixed(1)),
      upperBound: +(avg * 1.4).toFixed(1),
      modelUsed: 'hierarchical_category_fallback'
    };
  }

  /**
   * Refresh all forecasts and persist to database
   */
  async refreshAllForecasts() {
    const pairs = await db.prepare('SELECT DISTINCT store_id, product_id FROM inventory').all();
    const insertForecast = db.prepare(`
      INSERT INTO forecasts (store_id, product_id, forecast_date, predicted_demand, lower_bound, upper_bound, model_used, generated_at)
      VALUES (?, ?, date('now'), ?, ?, ?, ?, datetime('now'))
    `);

    // Clean old forecasts for today
    await db.prepare("DELETE FROM forecasts WHERE forecast_date = CURRENT_DATE").run();

    const results = [];
    for (const p of pairs) {
      const f = await this.getForecast(p.store_id, p.product_id);
      await insertForecast.run(p.store_id, p.product_id, f.predictedDemand, f.lowerBound, f.upperBound, f.modelUsed);
      results.push({ storeId: p.store_id, productId: p.product_id, ...f });
    }
    return results;
  }
}

module.exports = new ForecastingService();
