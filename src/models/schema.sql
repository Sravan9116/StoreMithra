-- StoreMithra Relational Database Schema (SQLite)

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  address TEXT NOT NULL,
  phone TEXT,
  reputation_score REAL DEFAULT 0.85,
  data_sharing_mode TEXT DEFAULT 'limited' CHECK(data_sharing_mode IN ('full', 'limited', 'privacy_preserving')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  brand TEXT,
  pack_size TEXT,
  price REAL NOT NULL,               -- Retail selling price (₹)
  cost_price REAL NOT NULL,          -- Wholesale purchase cost (₹)
  is_perishable INTEGER DEFAULT 0,   -- 1 = true, 0 = false
  shelf_life_days INTEGER NULL,
  supplier_lead_time_days INTEGER DEFAULT 4,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory (
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  batch_id TEXT NOT NULL DEFAULT 'BATCH-001',
  quantity INTEGER NOT NULL DEFAULT 0,
  reserved_quantity INTEGER DEFAULT 0,
  expiry_date TEXT NULL,             -- YYYY-MM-DD
  confidence REAL DEFAULT 1.0,       -- 0.0 to 1.0
  last_updated TEXT NOT NULL,        -- ISO timestamp
  possible_stale INTEGER DEFAULT 0,  -- 1 if flagged stale
  PRIMARY KEY (store_id, product_id, batch_id),
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sales_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  sold_at TEXT NOT NULL,             -- ISO timestamp
  was_stockout_period INTEGER DEFAULT 0, -- 1 if day had zero stock (censored demand)
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  forecast_date TEXT NOT NULL,       -- YYYY-MM-DD
  predicted_demand REAL NOT NULL,
  lower_bound REAL NOT NULL,
  upper_bound REAL NOT NULL,
  model_used TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS stockout_risk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  horizon_days INTEGER NOT NULL,     -- 1, 3, 7
  risk_probability REAL NOT NULL,
  days_of_supply REAL NOT NULL,
  plain_reason TEXT,
  computed_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS substitutions (
  product_id TEXT NOT NULL,
  substitute_product_id TEXT NOT NULL,
  similarity_score REAL NOT NULL,    -- 0.0 to 1.0
  source TEXT DEFAULT 'manual' CHECK(source IN ('auto', 'manual')),
  PRIMARY KEY (product_id, substitute_product_id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (substitute_product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS transfer_orders (
  id TEXT PRIMARY KEY,
  from_store_id TEXT NOT NULL,
  to_store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  transfer_price REAL NOT NULL,      -- Price paid by receiver to sender (₹)
  transfer_cost REAL NOT NULL,       -- Transport/logistics fee (₹)
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'in_transit', 'completed', 'declined')),
  expected_benefit REAL NOT NULL,
  delivered_quantity INTEGER NULL,   -- Set upon completion for reputation check
  created_at TEXT NOT NULL,
  resolved_at TEXT NULL,
  FOREIGN KEY (from_store_id) REFERENCES stores(id),
  FOREIGN KEY (to_store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('transfer', 'reorder', 'substitute', 'none')),
  target_store_id TEXT NULL,
  explanation TEXT NOT NULL,
  expected_cost REAL NOT NULL,
  expected_benefit REAL NOT NULL,
  net_benefit REAL NOT NULL,
  created_at TEXT NOT NULL,
  dismissed INTEGER DEFAULT 0,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (target_store_id) REFERENCES stores(id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_store ON inventory(store_id);
CREATE INDEX IF NOT EXISTS idx_sales_store_prod ON sales_log(store_id, product_id, sold_at);
CREATE INDEX IF NOT EXISTS idx_transfers_stores ON transfer_orders(from_store_id, to_store_id, status);
CREATE INDEX IF NOT EXISTS idx_recs_store ON recommendations(store_id, dismissed);
