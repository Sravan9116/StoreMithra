const db = require('../config/database');
const stockoutRiskService = require('./stockoutRiskService');
const poolingService = require('./poolingService');
const trustService = require('./trustService');

/**
 * Decision Engine (The Brain of StoreMithra)
 * Evaluates at-risk items and calculates exact economic trade-offs:
 * - Transfer Option
 * - Reorder from Supplier Option
 * - In-Store Substitution Option
 * - Do Nothing
 * Produces clear plain-English explanation with all money math transparently shown.
 */
class DecisionEngine {
  /**
   * Generate recommendations for a store
   * @param {string} storeId
   */
  async generateRecommendations(storeId) {
    const risks = await stockoutRiskService.evaluateStoreRisks(storeId);
    const atRiskItems = risks.filter(r => r.isAtRisk);

    const recommendations = [];

    // Clear old active recommendations for this store
    await db.prepare('DELETE FROM recommendations WHERE store_id = ? AND dismissed = FALSE').run(storeId);

    const insertRec = db.prepare(`
      INSERT INTO recommendations (store_id, product_id, type, target_store_id, explanation, expected_cost, expected_benefit, net_benefit, created_at, dismissed)
      VALUES (@store_id, @product_id, @type, @target_store_id, @explanation, @expected_cost, @expected_benefit, @net_benefit, datetime('now'), FALSE)
    `);

    for (const risk of atRiskItems) {
      const product = await db.prepare('SELECT * FROM products WHERE id = ?').get(risk.productId);
      if (!product) continue;

      const productPrice = parseFloat(product.price);
      const productCost = parseFloat(product.cost_price);
      const marginPerUnit = productPrice - productCost;

      // Recommended transfer quantity: needed to cover supplier lead time + 1 day buffer
      const targetDaysToCover = (product.supplier_lead_time_days || 4) + 1;
      const neededUnits = Math.max(2, Math.ceil(targetDaysToCover * risk.dailyDemand - risk.availableStock));

      // 1. Evaluate Transfer Option
      const donors = await poolingService.findDonorsForProduct(storeId, risk.productId, neededUnits);
      let bestTransfer = null;

      if (donors.length > 0) {
        const topDonor = donors[0]; // best scored donor
        const unitsToTransfer = Math.min(neededUnits, topDonor.transferableUnits);

        // Avoided lost sales (gross profit saved)
        const avoidedLostSales = +(unitsToTransfer * marginPerUnit).toFixed(2);

        // Transfer delivery / runner cost: ₹25 base + ₹15/km
        const distanceKm = topDonor.distanceKm;
        const transferCost = +(25 + (distanceKm * 15)).toFixed(2);

        // Sender shortage penalty if sender keeps < 3 days
        const senderShortageRiskCost = topDonor.donorDaysOfSupplyAfter < 3 ? 30.0 : 0.0;

        // Wholesale + handling fee for sender (₹4/unit handling)
        const handlingFeePerUnit = Math.max(3, Math.round(marginPerUnit * 0.25));
        const senderEarning = +(unitsToTransfer * handlingFeePerUnit).toFixed(2);
        const transferPricePerUnit = +(productCost + handlingFeePerUnit).toFixed(2);

        const netBenefit = +(avoidedLostSales - transferCost - senderShortageRiskCost).toFixed(2);

        // Explanation text
        const confText = topDonor.confidence < 0.7 ? ` (Note: ${topDonor.storeName}'s stock unconfirmed recently, check before dispatch)` : '';
        const explanation = `Transfer ${unitsToTransfer} units of ${product.name} from ${topDonor.storeName} (${topDonor.distanceMeters}m away). You have an ${(risk.riskProbability * 100).toFixed(0)}% chance of stockout within ${product.supplier_lead_time_days} days. ${topDonor.storeName} retains ${topDonor.donorDaysOfSupplyAfter} days of supply. Avoided lost sales: Rs.${avoidedLostSales}, transfer runner cost: Rs.${transferCost}. Sender earns: Rs.${senderEarning}.${confText}`;

        bestTransfer = {
          type: 'transfer',
          targetStoreId: topDonor.storeId,
          targetStoreName: topDonor.storeName,
          distanceMeters: topDonor.distanceMeters,
          distanceKm,
          units: unitsToTransfer,
          avoidedLostSales,
          transferCost,
          transferPricePerUnit,
          senderEarning,
          donorDaysAfter: topDonor.donorDaysOfSupplyAfter,
          netBenefit,
          explanation,
          staleWarning: topDonor.staleWarning
        };
      }

      // 2. Evaluate Reorder Option (from Supplier)
      const supplierLeadTime = product.supplier_lead_time_days || 4;
      const lostSalesDuringWait = +(Math.min(neededUnits, Math.ceil(supplierLeadTime * risk.dailyDemand)) * marginPerUnit).toFixed(2);
      const supplierShippingCost = 35.0; // supplier delivery surcharge for split orders
      const reorderExpectedGross = +(neededUnits * marginPerUnit).toFixed(2);
      const reorderNetBenefit = +(reorderExpectedGross - lostSalesDuringWait - supplierShippingCost).toFixed(2);

      const reorderExplanation = `Reorder ${neededUnits * 2} units from distributor. Supplier lead time is ${supplierLeadTime} days. Expected lost sales during delivery wait: Rs.${lostSalesDuringWait}. Supplier freight: Rs.${supplierShippingCost}. Net profit after restock: Rs.${reorderNetBenefit}.`;

      const reorderOption = {
        type: 'reorder',
        units: neededUnits * 2,
        leadTimeDays: supplierLeadTime,
        lostSalesDuringWait,
        expectedCost: supplierShippingCost,
        expectedBenefit: reorderExpectedGross,
        netBenefit: reorderNetBenefit,
        explanation: reorderExplanation
      };

      // 3. Evaluate Substitution Option (if available in store or network)
      const localSubstitute = await db.prepare(`
        SELECT s.substitute_product_id, s.similarity_score, p.name, p.price, p.cost_price, i.quantity
        FROM substitutions s
        JOIN products p ON s.substitute_product_id = p.id
        JOIN inventory i ON s.substitute_product_id = i.product_id AND i.store_id = ?
        WHERE s.product_id = ? AND i.quantity > 5
        ORDER BY s.similarity_score DESC
        LIMIT 1
      `).get(storeId, risk.productId);

      let substituteOption = null;
      if (localSubstitute) {
        const subMargin = parseFloat(localSubstitute.price) - parseFloat(localSubstitute.cost_price);
        const simScore = parseFloat(localSubstitute.similarity_score);
        const recoveredUnits = Math.min(neededUnits, Math.floor(localSubstitute.quantity * 0.5));
        const subBenefit = +(recoveredUnits * subMargin * simScore).toFixed(2);
        const subExplanation = `Suggest customer substitute: ${localSubstitute.name} (${localSubstitute.quantity} units in stock, ${(simScore * 100).toFixed(0)}% match). Recovers ~Rs.${subBenefit} in gross profit without new orders.`;

        substituteOption = {
          type: 'substitute',
          substituteId: localSubstitute.substitute_product_id,
          substituteName: localSubstitute.name,
          similarityScore: simScore,
          inStockQty: localSubstitute.quantity,
          netBenefit: subBenefit,
          explanation: subExplanation
        };
      }

      // 4. Do Nothing Cost
      const doNothingLostSales = +(neededUnits * marginPerUnit).toFixed(2);

      // 5. Compare & Pick Winner
      let winningOption = null;

      if (bestTransfer && bestTransfer.netBenefit > 0) {
        winningOption = {
          type: 'transfer',
          targetStoreId: bestTransfer.targetStoreId,
          explanation: bestTransfer.explanation,
          expectedCost: bestTransfer.transferCost,
          expectedBenefit: bestTransfer.avoidedLostSales,
          netBenefit: bestTransfer.netBenefit,
          details: bestTransfer
        };
      } else if (substituteOption && substituteOption.netBenefit > 50) {
        winningOption = {
          type: 'substitute',
          targetStoreId: null,
          explanation: substituteOption.explanation,
          expectedCost: 0,
          expectedBenefit: substituteOption.netBenefit,
          netBenefit: substituteOption.netBenefit,
          details: substituteOption
        };
      } else if (reorderOption.netBenefit > 0) {
        winningOption = {
          type: 'reorder',
          targetStoreId: null,
          explanation: reorderOption.explanation,
          expectedCost: reorderOption.expectedCost,
          expectedBenefit: reorderOption.expectedBenefit,
          netBenefit: reorderOption.netBenefit,
          details: reorderOption
        };
      } else {
        winningOption = {
          type: 'none',
          targetStoreId: null,
          explanation: `Demand is too low to justify transfer runner fees or priority shipping. Expected lost sales: Rs.${doNothingLostSales}. Best action: await standard weekly delivery.`,
          expectedCost: 0,
          expectedBenefit: 0,
          netBenefit: -doNothingLostSales,
          details: { doNothingLostSales }
        };
      }

      // Persist recommendation
      await insertRec.run({
        store_id: storeId,
        product_id: risk.productId,
        type: winningOption.type,
        target_store_id: winningOption.targetStoreId,
        explanation: winningOption.explanation,
        expected_cost: winningOption.expectedCost,
        expected_benefit: winningOption.expectedBenefit,
        net_benefit: winningOption.netBenefit
      });

      recommendations.push({
        productId: risk.productId,
        productName: product.name,
        brand: product.brand,
        packSize: product.pack_size,
        riskUrgency: risk.urgency,
        riskProbability: risk.riskProbability,
        daysOfSupply: risk.daysOfSupply,
        winner: winningOption,
        comparison: {
          transfer: bestTransfer,
          reorder: reorderOption,
          substitute: substituteOption,
          doNothingLoss: doNothingLostSales
        }
      });
    }

    return recommendations;
  }
}

module.exports = new DecisionEngine();
