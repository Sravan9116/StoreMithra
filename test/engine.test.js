const assert = require('assert');
const db = require('../src/config/database');
const seedDatabase = require('../src/seed/seedData');
const forecastingService = require('../src/services/forecastingService');
const stockoutRiskService = require('../src/services/stockoutRiskService');
const poolingService = require('../src/services/poolingService');
const decisionEngine = require('../src/services/decisionEngine');
const trustService = require('../src/services/trustService');
const perishablesService = require('../src/services/perishablesService');

async function runTests() {
  console.log('🧪 Starting StoreMithra PostgreSQL Core Engine Tests...\n');

  // 1. Seed database
  await seedDatabase();

  // Test 1: Verify Stores & Inventory Seeding in PostgreSQL
  const stores = await db.prepare('SELECT * FROM stores').all();
  assert.strictEqual(stores.length, 5, 'Should have exactly 5 demo stores');
  console.log('✅ Test 1 Passed: 5 demo stores seeded in PostgreSQL with owner_name, phone, pin, upi_id.');

  const products = await db.prepare('SELECT * FROM products').all();
  assert.strictEqual(products.length, 25, 'Should have 25 demo products');
  console.log('✅ Test 2 Passed: 25 demo products seeded across 5 categories in PostgreSQL.');

  // Test 3: Confidence Decay Calculation
  const freshConfidence = trustService.calculateConfidence(new Date().toISOString());
  assert.strictEqual(freshConfidence, 1.0, 'Freshly updated stock must have 1.0 confidence');

  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  const decayedConfidence = trustService.calculateConfidence(fiveDaysAgo);
  assert(decayedConfidence <= 0.5, `Decayed confidence after 5 days should be <= 0.5 (was ${decayedConfidence})`);
  console.log(`✅ Test 3 Passed: Confidence decay verified (Fresh: ${freshConfidence}, 5-day: ${decayedConfidence}).`);

  // Test 4: Forecasting Service with PostgreSQL sales_log
  const forecast = await forecastingService.getForecast('STORE_1', 'P203');
  assert(forecast.predictedDemand > 0, 'Predicted demand must be greater than 0');
  assert(forecast.lowerBound <= forecast.predictedDemand, 'Lower bound must be <= predicted demand');
  assert(forecast.upperBound >= forecast.predictedDemand, 'Upper bound must be >= predicted demand');
  console.log(`✅ Test 4 Passed: Forecasting engine output from PostgreSQL: ${forecast.predictedDemand} units [${forecast.lowerBound} - ${forecast.upperBound}], model: ${forecast.modelUsed}`);

  // Test 5: Haversine Distance
  // STORE_1 (12.9719, 77.6412) to STORE_2 (12.9698, 77.6445) is ~430m
  const distance = poolingService.calculateDistanceMeters(12.9719, 77.6412, 12.9698, 77.6445);
  assert(distance > 300 && distance < 600, `Distance should be ~430m (was ${distance}m)`);
  console.log(`✅ Test 5 Passed: Haversine distance calculated accurately: ${distance} meters.`);

  // Test 6: Perishables Distance Restriction
  const maxDist1Day = perishablesService.getMaxTransferDistanceMeters(new Date(Date.now() + 24 * 3600 * 1000).toISOString());
  assert.strictEqual(maxDist1Day, 1200, '1-day remaining shelf life must cap transfer distance to 1200m');
  console.log(`✅ Test 6 Passed: Perishable transit distance cap enforced (${maxDist1Day}m).`);

  // Test 7: Stockout Risk Engine
  const risks = await stockoutRiskService.evaluateStoreRisks('STORE_1');
  const attaRisk = risks.find(r => r.productId === 'P203');
  assert(attaRisk, 'Aashirvaad Atta must be in risk assessment');
  assert(attaRisk.riskProbability > 0.5, 'Atta with 2 units left must have high stockout probability');
  console.log(`✅ Test 7 Passed: Stockout risk correctly identified: ${attaRisk.productName} has ${(attaRisk.riskProbability * 100).toFixed(0)}% risk (${attaRisk.plainReason})`);

  // Test 8: Decision Engine & Money Math
  const recs = await decisionEngine.generateRecommendations('STORE_1');
  assert(recs.length > 0, 'Decision engine must generate recommendations for at-risk items');
  const topRec = recs.find(r => r.productId === 'P203');
  assert(topRec, 'Must have recommendation for P203');
  assert(topRec.winner.type === 'transfer', 'P203 should recommend transfer from Store 2 (which has 34 units surplus)');
  console.log(`✅ Test 8 Passed: Decision engine chose '${topRec.winner.type}'. Money math: avoid loss ₹${topRec.winner.expectedBenefit}, transfer fee ₹${topRec.winner.expectedCost}, net benefit ₹${topRec.winner.netBenefit}`);

  // Test 9: One-Tap Confirmation Nudge
  const confirmResult = await trustService.confirmInventory('STORE_1', 'P203', 10);
  assert.strictEqual(confirmResult.confidence, 1.0, 'Confirming stock must reset confidence to 1.0');
  const updatedItem = await db.prepare('SELECT quantity, confidence FROM inventory WHERE store_id = ? AND product_id = ?').get('STORE_1', 'P203');
  assert.strictEqual(updatedItem.quantity, 10, 'Quantity should be updated to 10 in PostgreSQL');
  assert.strictEqual(parseFloat(updatedItem.confidence), 1.0, 'Confidence should be 1.0');
  console.log('✅ Test 9 Passed: One-tap confirmation resets confidence and updates stock in PostgreSQL.');

  console.log('\n🎉 ALL 9 CORE POSTGRESQL ENGINE TESTS PASSED PERFECTLY!\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
