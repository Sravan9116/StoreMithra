const db = require('../config/database');
const forecastingService = require('./forecastingService');
const perishablesService = require('./perishablesService');
const trustService = require('./trustService');

/**
 * Pooling & Discovery Service
 * Flow 4.3: Searches nearby stores via Haversine distance, checks surplus,
 * discounts by confidence, and respects data sharing privacy modes.
 */
class PoolingService {
  /**
   * Haversine formula to compute great-circle distance in meters between two lat/lng points
   */
  calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  }

  /**
   * Find candidate donor stores for an at-risk product
   * @param {string} targetStoreId
   * @param {string} productId
   * @param {number} neededQuantity
   * @param {number} maxRadiusMeters
   */
  async findDonorsForProduct(targetStoreId, productId, neededQuantity = 5, maxRadiusMeters = 3500) {
    const targetStore = await db.prepare('SELECT * FROM stores WHERE id = ?').get(targetStoreId);
    const product = await db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!targetStore || !product) return [];

    // Perishables distance constraint
    let effectiveMaxRadius = maxRadiusMeters;
    if (product.is_perishable) {
      const invTarget = await db.prepare('SELECT expiry_date FROM inventory WHERE store_id = ? AND product_id = ?').get(targetStoreId, productId);
      effectiveMaxRadius = perishablesService.getMaxTransferDistanceMeters(invTarget?.expiry_date);
    }

    // Query other stores
    const candidateStores = await db.prepare('SELECT * FROM stores WHERE id != ?').all(targetStoreId);
    const donors = [];

    for (const store of candidateStores) {
      const distanceMeters = this.calculateDistanceMeters(
        targetStore.lat, targetStore.lng,
        store.lat, store.lng
      );

      if (distanceMeters > effectiveMaxRadius) continue;

      // Check candidate store's inventory for this product
      const inv = await db.prepare(`
        SELECT * FROM inventory
        WHERE store_id = ? AND product_id = ?
      `).get(store.id, productId);

      if (!inv || inv.quantity <= 0) continue;

      // Candidate store's own daily demand & safety stock retention
      const forecast = await forecastingService.getForecast(store.id, productId);
      const donorDailyDemand = Math.max(0.2, forecast.predictedDemand);
      const safetyRetentionDays = product.is_perishable ? 1.5 : 3.0;
      const donorMustKeep = Math.ceil(donorDailyDemand * safetyRetentionDays);

      const rawSurplus = Math.max(0, (inv.quantity - inv.reserved_quantity) - donorMustKeep);
      if (rawSurplus <= 0) continue;

      // Discount surplus by donor's inventory confidence score
      const confidence = parseFloat(inv.confidence) || 0.8;
      const discountedSurplus = Math.floor(rawSurplus * confidence);

      // Remaining days of supply for donor if they give away neededQuantity (capped at surplus)
      const transferableUnits = Math.min(neededQuantity, Math.max(1, discountedSurplus));
      const donorRemainingStock = inv.quantity - transferableUnits;
      const donorDaysOfSupplyAfter = +(donorRemainingStock / donorDailyDemand).toFixed(1);

      // Format based on data_sharing_mode
      let displaySurplus = `${transferableUnits} units available`;
      let canFulfill = discountedSurplus >= 1;

      if (store.data_sharing_mode === 'privacy_preserving') {
        displaySurplus = canFulfill ? 'Can fulfill transfer: Yes' : 'Can fulfill transfer: No';
      } else if (store.data_sharing_mode === 'limited') {
        displaySurplus = transferableUnits > 5 ? '5-10 units available' : '1-5 units available';
      }

      // Stale warning note
      const badge = trustService.getConfidenceBadge(inv.confidence, inv.last_updated);
      let staleWarning = null;
      if (parseFloat(inv.confidence) < 0.65 || badge.elapsedDays >= 3) {
        staleWarning = `Store ${store.name} shows ${inv.quantity} units but hasn't confirmed in ${badge.elapsedDays} days — verify before sending runner.`;
      }

      donors.push({
        storeId: store.id,
        storeName: store.name,
        address: store.address,
        phone: store.phone,
        reputationScore: parseFloat(store.reputation_score),
        dataSharingMode: store.data_sharing_mode,
        distanceMeters,
        distanceKm: +(distanceMeters / 1000).toFixed(2),
        rawSurplus,
        discountedSurplus,
        transferableUnits,
        donorDaysOfSupplyAfter,
        confidence: parseFloat(inv.confidence),
        confidenceBadge: badge,
        staleWarning,
        canFulfill,
        displaySurplus
      });
    }

    // Sort by distance ascending and reputation descending
    return donors.sort((a, b) => {
      const scoreA = (a.reputationScore * 0.4) - (a.distanceMeters / 10000);
      const scoreB = (b.reputationScore * 0.4) - (b.distanceMeters / 10000);
      return scoreB - scoreA;
    });
  }

  /**
   * Check if nearby stores have substitutions for an at-risk product
   */
  async findDonorsForSubstitutes(targetStoreId, productId, neededQuantity = 5) {
    const subs = await db.prepare(`
      SELECT s.substitute_product_id, s.similarity_score, p.name, p.price, p.pack_size
      FROM substitutions s
      JOIN products p ON s.substitute_product_id = p.id
      WHERE s.product_id = ?
    `).all(productId);

    const substituteDonors = [];
    for (const sub of subs) {
      const donors = await this.findDonorsForProduct(targetStoreId, sub.substitute_product_id, neededQuantity);
      if (donors.length > 0) {
        substituteDonors.push({
          substituteProductId: sub.substitute_product_id,
          substituteName: sub.name,
          similarityScore: parseFloat(sub.similarity_score),
          donors
        });
      }
    }
    return substituteDonors;
  }
}

module.exports = new PoolingService();
