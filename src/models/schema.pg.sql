-- StoreMithra PostgreSQL Database Schema

CREATE TABLE IF NOT EXISTS stores (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  owner_name VARCHAR(150) NOT NULL DEFAULT 'Kirana Merchant',
  phone VARCHAR(50) UNIQUE NOT NULL,
  pin VARCHAR(100) NOT NULL DEFAULT '1234',
  upi_id VARCHAR(100) DEFAULT 'merchant@upi',
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  address TEXT NOT NULL,
  reputation_score NUMERIC(4,2) DEFAULT 0.85,
  data_sharing_mode VARCHAR(50) DEFAULT 'limited' CHECK(data_sharing_mode IN ('full', 'limited', 'privacy_preserving')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_sessions (
  token VARCHAR(120) PRIMARY KEY,
  store_id VARCHAR(50) REFERENCES stores(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(50) PRIMARY KEY,
  barcode VARCHAR(100) UNIQUE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  brand VARCHAR(100),
  pack_size VARCHAR(50),
  price NUMERIC(10,2) NOT NULL,               -- Retail selling price (Rs.)
  cost_price NUMERIC(10,2) NOT NULL,          -- Wholesale purchase cost (Rs.)
  is_perishable BOOLEAN DEFAULT FALSE,
  shelf_life_days INTEGER NULL,
  supplier_lead_time_days INTEGER DEFAULT 4,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory (
  store_id VARCHAR(50) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_id VARCHAR(50) NOT NULL DEFAULT 'BATCH-001',
  quantity INTEGER NOT NULL DEFAULT 0,
  reserved_quantity INTEGER DEFAULT 0,
  expiry_date DATE NULL,                      -- YYYY-MM-DD
  confidence NUMERIC(4,2) DEFAULT 1.0,        -- 0.0 to 1.0
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  possible_stale BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (store_id, product_id, batch_id)
);

CREATE TABLE IF NOT EXISTS sales_log (
  id SERIAL PRIMARY KEY,
  store_id VARCHAR(50) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  was_stockout_period BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS forecasts (
  id SERIAL PRIMARY KEY,
  store_id VARCHAR(50) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  forecast_date DATE NOT NULL,
  predicted_demand NUMERIC(8,2) NOT NULL,
  lower_bound NUMERIC(8,2) NOT NULL,
  upper_bound NUMERIC(8,2) NOT NULL,
  model_used VARCHAR(50) NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stockout_risk (
  id SERIAL PRIMARY KEY,
  store_id VARCHAR(50) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  horizon_days INTEGER NOT NULL,              -- 1, 3, 7
  risk_probability NUMERIC(4,2) NOT NULL,
  days_of_supply NUMERIC(6,2) NOT NULL,
  plain_reason TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS substitutions (
  product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  substitute_product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  similarity_score NUMERIC(4,2) NOT NULL,     -- 0.0 to 1.0
  source VARCHAR(50) DEFAULT 'manual' CHECK(source IN ('auto', 'manual')),
  PRIMARY KEY (product_id, substitute_product_id)
);

CREATE TABLE IF NOT EXISTS transfer_orders (
  id VARCHAR(50) PRIMARY KEY,
  from_store_id VARCHAR(50) NOT NULL REFERENCES stores(id),
  to_store_id VARCHAR(50) NOT NULL REFERENCES stores(id),
  product_id VARCHAR(50) NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  transfer_price NUMERIC(10,2) NOT NULL,      -- Price paid by receiver to sender (Rs.)
  transfer_cost NUMERIC(10,2) NOT NULL,       -- Transport/logistics fee (Rs.)
  status VARCHAR(50) DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'in_transit', 'completed', 'declined')),
  expected_benefit NUMERIC(10,2) NOT NULL,
  delivered_quantity INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS recommendations (
  id SERIAL PRIMARY KEY,
  store_id VARCHAR(50) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK(type IN ('transfer', 'reorder', 'substitute', 'none')),
  target_store_id VARCHAR(50) NULL REFERENCES stores(id),
  explanation TEXT NOT NULL,
  expected_cost NUMERIC(10,2) NOT NULL,
  expected_benefit NUMERIC(10,2) NOT NULL,
  net_benefit NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_inventory_store ON inventory(store_id);
CREATE INDEX IF NOT EXISTS idx_sales_store_prod ON sales_log(store_id, product_id, sold_at);
CREATE INDEX IF NOT EXISTS idx_transfers_stores ON transfer_orders(from_store_id, to_store_id, status);
CREATE INDEX IF NOT EXISTS idx_recs_store ON recommendations(store_id, dismissed);
