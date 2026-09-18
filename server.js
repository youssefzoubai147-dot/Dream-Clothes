require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost") ? { rejectUnauthorized: false } : false });

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.warn("DATABASE_URL is missing. Create .env from .env.example first.");
    return;
  }
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
}

function adminOnly(req, res, next) {
  try {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: "غير مصرح" });
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "انتهت جلسة الإدارة" });
  }
}

function cleanPhone(p) {
  return String(p || "").replace(/[^\d+]/g, "");
}

app.get("/api/store", (req,res) => {
  res.json({ name: process.env.STORE_NAME || "متجري", currency: process.env.CURRENCY || "MAD" });
});

app.get("/api/products", async (req,res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM products WHERE active=true ORDER BY created_at DESC");
    res.json(rows);
  } catch (e) { res.status(500).json({ error: "تعذر تحميل المنتجات" }); }
});

app.get("/api/admin/products", adminOnly, async (req,res) => {
  const { rows } = await pool.query("SELECT * FROM products ORDER BY created_at DESC");
  res.json(rows);
});

app.post("/api/admin/products", adminOnly, async (req,res) => {
  const { name, description="", price, image_url="", category="ملابس", sizes=[], colors=[], stock=0 } = req.body;
  if (!name || Number(price) < 0) return res.status(400).json({error:"الاسم والسعر مطلوبان"});
  const { rows } = await pool.query(
    `INSERT INTO products(name,description,price,image_url,category,sizes,colors,stock)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [name, description, Number(price), image_url, category, sizes, colors, Number(stock)]
  );
  res.json(rows[0]);
});

app.put("/api/admin/products/:id", adminOnly, async (req,res) => {
  const { name, description="", price, image_url="", category="ملابس", sizes=[], colors=[], stock=0, active=true } = req.body;
  const { rows } = await pool.query(
    `UPDATE products SET name=$1,description=$2,price=$3,image_url=$4,category=$5,sizes=$6,colors=$7,stock=$8,active=$9
     WHERE id=$10 RETURNING *`,
    [name,description,Number(price),image_url,category,sizes,colors,Number(stock),!!active,req.params.id]
  );
  if (!rows[0]) return res.status(404).json({error:"المنتج غير موجود"});
  res.json(rows[0]);
});

app.delete("/api/admin/products/:id", adminOnly, async (req,res) => {
  await pool.query("DELETE FROM products WHERE id=$1", [req.params.id]);
  res.json({ok:true});
});

app.post("/api/orders", async (req,res) => {
  const { customer_name, phone, city, address, note="", items=[] } = req.body;
  if (!customer_name || !phone || !city || !address || !Array.isArray(items) || !items.length)
    return res.status(400).json({error:"يرجى إكمال معلومات الطلب"});
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = items.map(x => Number(x.product_id));
    const { rows: products } = await client.query("SELECT * FROM products WHERE id=ANY($1::int[]) AND active=true FOR UPDATE", [ids]);
    let total = 0;
    const normalized = [];
    for (const item of items) {
      const p = products.find(x => x.id === Number(item.product_id));
      const qty = Math.max(1, Number(item.quantity || 1));
      if (!p) throw new Error("منتج غير متاح");
      if (p.stock < qty) throw new Error(`الكمية غير متوفرة للمنتج: ${p.name}`);
      const size = String(item.size || "");
      const color = String(item.color || "");
      if (p.sizes.length && !p.sizes.includes(size)) throw new Error(`المقاس غير متاح: ${p.name}`);
      if (p.colors.length && !p.colors.includes(color)) throw new Error(`اللون غير متاح: ${p.name}`);
      total += Number(p.price) * qty;
      normalized.push({ product_id:p.id, name:p.name, price:Number(p.price), quantity:qty, size, color });
      await client.query("UPDATE products SET stock=stock-$1 WHERE id=$2", [qty,p.id]);
    }
    const orderNumber = "ORD-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(Math.random()*900+100);
    const { rows } = await client.query(
      `INSERT INTO orders(order_number,customer_name,phone,city,address,note,items,total)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING order_number,total,status,created_at`,
      [orderNumber,customer_name,cleanPhone(phone),city,address,note,JSON.stringify(normalized),total]
    );
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch(e) {
    await client.query("ROLLBACK");
    res.status(400).json({error:e.message || "تعذر إنشاء الطلب"});
  } finally { client.release(); }
});

app.get("/api/orders/track", async (req,res) => {
  const { order_number, phone } = req.query;
  if (!order_number || !phone) return res.status(400).json({error:"رقم الطلب والهاتف مطلوبان"});
  const { rows } = await pool.query(
    "SELECT order_number,customer_name,city,address,items,total,status,admin_message,created_at,updated_at FROM orders WHERE order_number=$1 AND phone=$2",
    [order_number, cleanPhone(phone)]
  );
  if (!rows[0]) return res.status(404).json({error:"لم يتم العثور على الطلب"});
  res.json(rows[0]);
});

app.post("/api/admin/login", async (req,res) => {
  const { email, password } = req.body;
  const validEmail = process.env.ADMIN_EMAIL || "admin@example.com";
  const validPassword = process.env.ADMIN_PASSWORD || "ChangeThisPassword123!";
  if (email !== validEmail || password !== validPassword) return res.status(401).json({error:"بيانات الدخول غير صحيحة"});
  const token = jwt.sign({email, role:"admin"}, JWT_SECRET, {expiresIn:"7d"});
  res.cookie("admin_token", token, {httpOnly:true, sameSite:"lax", secure:process.env.NODE_ENV==="production", maxAge:7*24*3600*1000});
  res.json({ok:true});
});

app.post("/api/admin/logout", (req,res) => { res.clearCookie("admin_token"); res.json({ok:true}); });

app.get("/api/admin/me", adminOnly, (req,res) => res.json({email:req.admin.email}));

app.get("/api/admin/orders", adminOnly, async (req,res) => {
  const { rows } = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
  res.json(rows);
});

app.patch("/api/admin/orders/:id", adminOnly, async (req,res) => {
  const allowed = ["جديد","تم التأكيد","قيد التجهيز","تم الشحن","تم التسليم","ملغى"];
  const { status, admin_message="" } = req.body;
  if (!allowed.includes(status)) return res.status(400).json({error:"حالة غير صالحة"});
  const { rows } = await pool.query(
    "UPDATE orders SET status=$1,admin_message=$2,updated_at=NOW() WHERE id=$3 RETURNING *",
    [status,admin_message,req.params.id]
  );
  res.json(rows[0]);
});

app.get("/admin", (req,res) => res.sendFile(path.join(__dirname,"public/admin.html")));
app.get("/track", (req,res) => res.sendFile(path.join(__dirname,"public/track.html")));
app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public/index.html")));

initDb().then(() => {
  app.listen(PORT, "0.0.0.0", () => console.log(`Store running on port ${PORT}`));
}).catch(err => { console.error(err); process.exit(1); });
