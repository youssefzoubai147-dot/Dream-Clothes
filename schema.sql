CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  image_url TEXT DEFAULT '',
  category TEXT DEFAULT 'ملابس',
  sizes TEXT[] DEFAULT ARRAY[]::TEXT[],
  colors TEXT[] DEFAULT ARRAY[]::TEXT[],
  stock INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  note TEXT DEFAULT '',
  items JSONB NOT NULL,
  total NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'جديد',
  admin_message TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);

INSERT INTO products (name, description, price, image_url, category, sizes, colors, stock)
SELECT 'قميص كلاسيكي', 'قميص أنيق للاستعمال اليومي والمناسبات.', 199, 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=900&q=80', 'قمصان', ARRAY['S','M','L','XL'], ARRAY['أبيض','أسود','أزرق'], 20
WHERE NOT EXISTS (SELECT 1 FROM products);

INSERT INTO products (name, description, price, image_url, category, sizes, colors, stock)
SELECT 'هودي عصري', 'هودي مريح بقصة عصرية.', 249, 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=80', 'هوديز', ARRAY['M','L','XL'], ARRAY['أسود','رمادي'], 15
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='هودي عصري');

INSERT INTO products (name, description, price, image_url, category, sizes, colors, stock)
SELECT 'بنطال كاجوال', 'بنطال عملي وأنيق للّوك اليومي.', 229, 'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=900&q=80', 'بناطيل', ARRAY['S','M','L','XL'], ARRAY['أسود','بيج'], 18
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='بنطال كاجوال');
