const db = require('../config/database');

async function seedDatabase() {
  console.log('🌱 Starting StoreMithra database seeding in PostgreSQL...');

  // Clear existing data safely
  await db.exec(`
    DELETE FROM recommendations;
    DELETE FROM transfer_orders;
    DELETE FROM stockout_risk;
    DELETE FROM forecasts;
    DELETE FROM sales_log;
    DELETE FROM substitutions;
    DELETE FROM inventory;
    DELETE FROM products;
    DELETE FROM store_sessions;
    DELETE FROM stores;
  `);

  // 1. Insert 5 Demo Neighborhood Stores (Indiranagar / Koramangala Cluster, Bangalore)
  const insertStore = db.prepare(`
    INSERT INTO stores (id, name, owner_name, phone, pin, upi_id, lat, lng, address, reputation_score, data_sharing_mode)
    VALUES (@id, @name, @owner_name, @phone, @pin, @upi_id, @lat, @lng, @address, @reputation_score, @data_sharing_mode)
  `);

  const stores = [
    {
      id: 'STORE_1',
      name: 'Sri Lakshmi Provision & Kirana',
      owner_name: 'Ramesh Gupta',
      phone: '+91 98450 11221',
      pin: '1234',
      upi_id: 'srilakshmi@oksbi',
      lat: 12.9719,
      lng: 77.6412,
      address: '#142, 100 Feet Road, Indiranagar',
      reputation_score: 0.95,
      data_sharing_mode: 'full'
    },
    {
      id: 'STORE_2',
      name: 'Annapurna Super Bazaar',
      owner_name: 'Suresh Kumar',
      phone: '+91 98451 22332',
      pin: '1234',
      upi_id: 'annapurna@okicici',
      lat: 12.9698,
      lng: 77.6445,
      address: '#89, 12th Main Road, HAL 2nd Stage',
      reputation_score: 0.89,
      data_sharing_mode: 'full'
    },
    {
      id: 'STORE_3',
      name: 'Green Basket Daily Mart',
      owner_name: 'Kavitha Reddy',
      phone: '+91 98452 33443',
      pin: '1234',
      upi_id: 'greenbasket@okhdfc',
      lat: 12.9785,
      lng: 77.6385,
      address: '#55, CMH Road, Indiranagar',
      reputation_score: 0.84,
      data_sharing_mode: 'limited'
    },
    {
      id: 'STORE_4',
      name: 'Bhartiya Kirana & Dairy',
      owner_name: 'Mahesh Sharma',
      phone: '+91 98453 44554',
      pin: '1234',
      upi_id: 'bhartiyakirana@oksbi',
      lat: 12.9660,
      lng: 77.6360,
      address: '#210, Double Road, Domlur / Indiranagar',
      reputation_score: 0.91,
      data_sharing_mode: 'limited'
    },
    {
      id: 'STORE_5',
      name: 'City Corner Mini Mart',
      owner_name: 'Abdul Farooq',
      phone: '+91 98454 55665',
      pin: '1234',
      upi_id: 'citycorner@okaxis',
      lat: 12.9610,
      lng: 77.6480,
      address: '#12, Old Airport Road, Kodihalli',
      reputation_score: 0.78,
      data_sharing_mode: 'privacy_preserving'
    }
  ];

  for (const s of stores) {
    await insertStore.run(s);
  }

  // 2. Insert Products (25 items across 5 categories)
  const insertProduct = db.prepare(`
    INSERT INTO products (id, barcode, name, category, brand, pack_size, price, cost_price, is_perishable, shelf_life_days, supplier_lead_time_days)
    VALUES (@id, @barcode, @name, @category, @brand, @pack_size, @price, @cost_price, @is_perishable, @shelf_life_days, @supplier_lead_time_days)
  `);

  const products = [
    // Dairy & Perishables
    { id: 'P101', barcode: '890123400101', name: 'Nandini Toned Milk', category: 'Dairy', brand: 'Nandini', pack_size: '500 ml', price: 24, cost_price: 20.5, is_perishable: true, shelf_life_days: 2, supplier_lead_time_days: 1 },
    { id: 'P102', barcode: '890123400102', name: 'Amul Taaza Milk', category: 'Dairy', brand: 'Amul', pack_size: '1 L', price: 72, cost_price: 63.0, is_perishable: true, shelf_life_days: 3, supplier_lead_time_days: 1 },
    { id: 'P103', barcode: '890123400103', name: 'Milky Mist Farm Fresh Curd', category: 'Dairy', brand: 'Milky Mist', pack_size: '400 g', price: 35, cost_price: 29.5, is_perishable: true, shelf_life_days: 5, supplier_lead_time_days: 1 },
    { id: 'P104', barcode: '890123400104', name: 'Modern Family White Bread', category: 'Bakery', brand: 'Modern', pack_size: '400 g', price: 45, cost_price: 37.0, is_perishable: true, shelf_life_days: 4, supplier_lead_time_days: 1 },
    { id: 'P105', barcode: '890123400105', name: 'Britannia 100% Whole Wheat Bread', category: 'Bakery', brand: 'Britannia', pack_size: '400 g', price: 55, cost_price: 45.0, is_perishable: true, shelf_life_days: 4, supplier_lead_time_days: 1 },

    // Grains & Flours
    { id: 'P201', barcode: '890123400201', name: 'India Gate Feast Rozzana Basmati', category: 'Staples', brand: 'India Gate', pack_size: '1 kg', price: 150, cost_price: 122.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 4 },
    { id: 'P202', barcode: '890123400202', name: 'Fortune Sona Masoori Raw Rice', category: 'Staples', brand: 'Fortune', pack_size: '5 kg', price: 320, cost_price: 265.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 4 },
    { id: 'P203', barcode: '890123400203', name: 'Aashirvaad Shudh Chakki Atta', category: 'Staples', brand: 'Aashirvaad', pack_size: '5 kg', price: 265, cost_price: 224.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 3 },
    { id: 'P204', barcode: '890123400204', name: 'Pillsbury Chakki Fresh Atta', category: 'Staples', brand: 'Pillsbury', pack_size: '5 kg', price: 275, cost_price: 231.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 3 },
    { id: 'P205', barcode: '890123400205', name: 'Tata Sampann Unpolished Toor Dal', category: 'Staples', brand: 'Tata Sampann', pack_size: '1 kg', price: 180, cost_price: 148.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 4 },

    // Cooking Essentials & Oils
    { id: 'P301', barcode: '890123400301', name: 'Fortune Sunlite Refined Sunflower Oil', category: 'Cooking Oils', brand: 'Fortune', pack_size: '1 L Pouch', price: 145, cost_price: 122.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 3 },
    { id: 'P302', barcode: '890123400302', name: 'Gemini Pure Sunflower Oil', category: 'Cooking Oils', brand: 'Gemini', pack_size: '1 L Pouch', price: 140, cost_price: 118.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 3 },
    { id: 'P303', barcode: '890123400303', name: 'Tata Salt Vacuum Evaporated Iodised', category: 'Cooking Oils', brand: 'Tata Salt', pack_size: '1 kg', price: 28, cost_price: 22.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 5 },
    { id: 'P304', barcode: '890123400304', name: 'Everest Tikhalal Chilli Powder', category: 'Spices', brand: 'Everest', pack_size: '200 g', price: 85, cost_price: 68.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 4 },
    { id: 'P305', barcode: '890123400305', name: 'MDH Agmark Turmeric Powder', category: 'Spices', brand: 'MDH', pack_size: '200 g', price: 65, cost_price: 50.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 4 },

    // Cleaning & Detergents
    { id: 'P401', barcode: '890123400401', name: 'Surf Excel Easy Wash Detergent', category: 'Cleaning', brand: 'Surf Excel', pack_size: '1 kg', price: 140, cost_price: 114.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 4 },
    { id: 'P402', barcode: '890123400402', name: 'Ariel Matic Front Load Detergent', category: 'Cleaning', brand: 'Ariel', pack_size: '1 kg', price: 235, cost_price: 188.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 4 },
    { id: 'P403', barcode: '890123400403', name: 'Tide Plus Double Power Detergent', category: 'Cleaning', brand: 'Tide', pack_size: '1 kg', price: 125, cost_price: 101.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 4 },
    { id: 'P404', barcode: '890123400404', name: 'Vim Dishwash Bar with Neem', category: 'Cleaning', brand: 'Vim', pack_size: '300 g', price: 35, cost_price: 28.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 3 },
    { id: 'P405', barcode: '890123400405', name: 'Harpic Power Plus Toilet Cleaner', category: 'Cleaning', brand: 'Harpic', pack_size: '500 ml', price: 98, cost_price: 78.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 4 },

    // Snacks, Beverages & Quick Consumables
    { id: 'P501', barcode: '890123400501', name: 'Parle-G Original Gluco Biscuits', category: 'Snacks', brand: 'Parle', pack_size: '1 kg Family Pack', price: 110, cost_price: 90.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 3 },
    { id: 'P502', barcode: '890123400502', name: 'Britannia Good Day Cashew Delight', category: 'Snacks', brand: 'Britannia', pack_size: '200 g', price: 50, cost_price: 40.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 3 },
    { id: 'P503', barcode: '890123400503', name: 'Maggi 2-Minute Masala Noodles', category: 'Snacks', brand: 'Nestle', pack_size: '4-Pack 280g', price: 56, cost_price: 45.5, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 2 },
    { id: 'P504', barcode: '890123400504', name: 'Tata Tea Gold Leaf & Dust Blend', category: 'Beverages', brand: 'Tata Tea', pack_size: '500 g', price: 310, cost_price: 254.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 4 },
    { id: 'P505', barcode: '890123400505', name: 'Brooke Bond Red Label Natural Care', category: 'Beverages', brand: 'Red Label', pack_size: '500 g', price: 295, cost_price: 242.0, is_perishable: false, shelf_life_days: null, supplier_lead_time_days: 4 }
  ];

  for (const p of products) {
    await insertProduct.run(p);
  }

  // 3. Substitutions
  const insertSub = db.prepare(`
    INSERT INTO substitutions (product_id, substitute_product_id, similarity_score, source)
    VALUES (?, ?, ?, ?)
  `);

  const subs = [
    ['P101', 'P102', 0.88, 'manual'], // Nandini <-> Amul
    ['P102', 'P101', 0.88, 'manual'],
    ['P104', 'P105', 0.82, 'manual'], // White bread <-> Brown bread
    ['P105', 'P104', 0.82, 'manual'],
    ['P203', 'P204', 0.95, 'manual'], // Aashirvaad <-> Pillsbury
    ['P204', 'P203', 0.95, 'manual'],
    ['P301', 'P302', 0.94, 'manual'], // Fortune Oil <-> Gemini Oil
    ['P302', 'P301', 0.94, 'manual'],
    ['P401', 'P403', 0.90, 'manual'], // Surf Excel <-> Tide Plus
    ['P403', 'P401', 0.90, 'manual'],
    ['P504', 'P505', 0.92, 'manual'], // Tata Tea Gold <-> Red Label
    ['P505', 'P504', 0.92, 'manual']
  ];

  for (const s of subs) {
    await insertSub.run(s[0], s[1], s[2], s[3]);
  }

  // 4. Inventory Generation with realistic variations, confidence decay, and deliberate risk/surplus scenarios
  const insertInv = db.prepare(`
    INSERT INTO inventory (store_id, product_id, batch_id, quantity, reserved_quantity, expiry_date, confidence, last_updated, possible_stale)
    VALUES (@store_id, @product_id, @batch_id, @quantity, @reserved_quantity, @expiry_date, @confidence, @last_updated, @possible_stale)
  `);

  const now = new Date();
  function getIsoDateOffset(daysOffset, hoursOffset = 0) {
    const d = new Date(now.getTime() + (daysOffset * 24 + hoursOffset) * 3600 * 1000);
    return d.toISOString();
  }

  function getExpiryDate(daysFromNow) {
    const d = new Date(now.getTime() + daysFromNow * 24 * 3600 * 1000);
    return d.toISOString().split('T')[0];
  }

  for (const store of stores) {
    for (const prod of products) {
      let qty = 15;
      let daysOld = 0.5; // fresh by default
      let isStale = false;
      let expiryDate = prod.is_perishable ? getExpiryDate(prod.shelf_life_days || 3) : null;

      if (store.id === 'STORE_1') {
        if (prod.id === 'P203') { qty = 2; daysOld = 0.2; } // Low stock (Atta)
        else if (prod.id === 'P401') { qty = 3; daysOld = 0.3; } // Low stock (Surf Excel)
        else if (prod.id === 'P504') { qty = 2; daysOld = 0.4; } // Low stock (Tata Tea)
        else if (prod.id === 'P101') { qty = 4; daysOld = 0.1; expiryDate = getExpiryDate(1); } // Perishable Milk
        else { qty = 14 + Math.floor(Math.random() * 12); daysOld = Math.random() * 1.5; }
      } else if (store.id === 'STORE_2') {
        if (prod.id === 'P203') { qty = 34; daysOld = 0.5; } // Huge Atta surplus!
        else if (prod.id === 'P101') { qty = 28; daysOld = 0.2; expiryDate = getExpiryDate(1); } // Imminent expiry waste risk!
        else if (prod.id === 'P401') { qty = 16; daysOld = 1.0; }
        else { qty = 18 + Math.floor(Math.random() * 15); daysOld = Math.random() * 2; }
      } else if (store.id === 'STORE_3') {
        if (prod.id === 'P401') { qty = 24; daysOld = 0.8; } // Detergent surplus
        else if (prod.id === 'P504') { qty = 20; daysOld = 0.5; } // Tea surplus
        else if (prod.id === 'P301') { qty = 5; daysOld = 4.5; } // Aging confidence
        else { qty = 10 + Math.floor(Math.random() * 12); daysOld = 1 + Math.random() * 3; }
      } else if (store.id === 'STORE_4') {
        if (prod.id === 'P202') {
          qty = 12;
          daysOld = 6.2; // 6 days unconfirmed!
          isStale = true;
        } else if (prod.id === 'P204') {
          qty = 26; daysOld = 1.2; // Pillsbury Atta surplus (substitute for P203)
        } else {
          qty = 12 + Math.floor(Math.random() * 10);
          daysOld = Math.random() * 3;
        }
      } else {
        // STORE_5 (Privacy preserving)
        if (prod.id === 'P203') { qty = 22; daysOld = 0.6; }
        else { qty = 10 + Math.floor(Math.random() * 14); daysOld = Math.random() * 2.5; }
      }

      // Confidence decay formula: drops toward 0.3 after 5-7 days of inactivity
      const confidence = Math.max(0.25, Math.min(1.0, +(1.0 - (daysOld * 0.11)).toFixed(2)));
      const lastUpdated = getIsoDateOffset(-daysOld);

      await insertInv.run({
        store_id: store.id,
        product_id: prod.id,
        batch_id: 'B-' + prod.id + '-01',
        quantity: qty,
        reserved_quantity: 0,
        expiry_date: expiryDate,
        confidence: confidence,
        last_updated: lastUpdated,
        possible_stale: isStale
      });
    }
  }

  // 5. Generate 14 days of realistic sales logs for forecasting calculations
  const insertSale = db.prepare(`
    INSERT INTO sales_log (store_id, product_id, quantity, sold_at, was_stockout_period)
    VALUES (@store_id, @product_id, @quantity, @sold_at, @was_stockout_period)
  `);

  console.log('📦 Simulating 14 days of historical sales logs in PostgreSQL...');
  const baseDailyDemand = {
    P101: 18, P102: 8, P103: 6, P104: 10, P105: 6,
    P201: 4, P202: 3, P203: 5, P204: 3, P205: 4,
    P301: 6, P302: 4, P303: 7, P304: 3, P305: 3,
    P401: 4, P402: 2, P403: 3, P404: 5, P405: 2,
    P501: 6, P502: 5, P503: 12, P504: 3, P505: 3
  };

  for (let day = 14; day >= 1; day--) {
    for (const store of stores) {
      for (const prod of products) {
        const base = baseDailyDemand[prod.id] || 4;
        const isWeekend = (day % 7 === 1 || day % 7 === 2);
        const weekendFactor = isWeekend ? 1.3 : 0.95;
        const storeFactor = store.id === 'STORE_2' ? 1.2 : (store.id === 'STORE_5' ? 0.8 : 1.0);

        const isIntermittent = ['P402', 'P405', 'P304', 'P305'].includes(prod.id);
        let qtySold = 0;

        if (isIntermittent) {
          if (Math.random() < 0.45) {
            qtySold = Math.floor(1 + Math.random() * 3);
          } else {
            qtySold = 0;
          }
        } else {
          const noise = (Math.random() - 0.5) * 2.5;
          qtySold = Math.max(0, Math.round(base * weekendFactor * storeFactor + noise));
        }

        let wasStockout = false;
        if (store.id === 'STORE_1' && prod.id === 'P203' && day <= 2) {
          if (qtySold === 0) wasStockout = true;
        }

        if (qtySold > 0 || wasStockout) {
          const soldAt = getIsoDateOffset(-day, Math.floor(Math.random() * 12) + 8);
          await insertSale.run({
            store_id: store.id,
            product_id: prod.id,
            quantity: qtySold,
            sold_at: soldAt,
            was_stockout_period: wasStockout
          });
        }
      }
    }
  }

  // 6. Insert one active demo transfer order
  const insertTransfer = db.prepare(`
    INSERT INTO transfer_orders (id, from_store_id, to_store_id, product_id, quantity, transfer_price, transfer_cost, status, expected_benefit, created_at, resolved_at)
    VALUES (@id, @from_store_id, @to_store_id, @product_id, @quantity, @transfer_price, @transfer_cost, @status, @expected_benefit, @created_at, @resolved_at)
  `);

  await insertTransfer.run({
    id: 'TRF-2026-001',
    from_store_id: 'STORE_3',
    to_store_id: 'STORE_1',
    product_id: 'P504', // Tata Tea Gold 500g
    quantity: 6,
    transfer_price: 270.0,
    transfer_cost: 40.0,
    status: 'in_transit',
    expected_benefit: 240.0,
    created_at: getIsoDateOffset(-0.2),
    resolved_at: null
  });

  console.log('✅ PostgreSQL database seeded successfully with 5 stores, 25 products, inventory, substitutions, and 14 days of sales logs!');
}

// Run if called directly
if (require.main === module) {
  seedDatabase().then(() => {
    console.log('Seed completed.');
    process.exit(0);
  }).catch(err => {
    console.error('Seed error:', err);
    process.exit(1);
  });
}

module.exports = seedDatabase;
