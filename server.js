const express = require("express");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "change-this-secret";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL غير موجود. لازم تضيف Postgres وتربط الرابط في Environment Variables.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'Viewer'
    );
    CREATE TABLE IF NOT EXISTS materials(
      id SERIAL PRIMARY KEY, name TEXT NOT NULL,
      chemical_name TEXT, cas TEXT, department TEXT, supplier TEXT,
      hazard_score INTEGER DEFAULT 0, sds_status TEXT DEFAULT 'Missing',
      revision_date TEXT, storage_qty TEXT,
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sds_files(
      id SERIAL PRIMARY KEY, material_id INTEGER NOT NULL,
      original_name TEXT, stored_name TEXT, uploaded_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS audit_log(
      id SERIAL PRIMARY KEY, user_id INTEGER, action TEXT,
      entity TEXT, entity_id INTEGER, details TEXT, created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  const { rows } = await pool.query("SELECT COUNT(*)::int c FROM users");
  if (!rows[0].c) {
    await pool.query(
      "INSERT INTO users(username,password,role) VALUES($1,$2,$3)",
      ["admin", "admin123", "Admin"]
    );
  }
}

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(h.slice(7), SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid session" });
  }
}
async function log(user, action, entity, id, details = "") {
  await pool.query(
    "INSERT INTO audit_log(user_id,action,entity,entity_id,details) VALUES($1,$2,$3,$4,$5)",
    [user?.id || null, action, entity, id, details]
  );
}
function wrap(fn) {
  return (req, res) => fn(req, res).catch((e) => {
    console.error(e);
    res.status(500).json({ error: "خطأ في السيرفر" });
  });
}

app.post("/api/login", wrap(async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE username=$1 AND password=$2",
    [username, password]
  );
  const u = rows[0];
  if (!u) return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
  const token = jwt.sign({ id: u.id, username: u.username, role: u.role }, SECRET, { expiresIn: "12h" });
  res.json({ token, user: { id: u.id, username: u.username, role: u.role } });
}));

app.get("/api/dashboard", auth, wrap(async (req, res) => {
  const total = (await pool.query("SELECT COUNT(*)::int c FROM materials")).rows[0].c;
  const withSds = (await pool.query("SELECT COUNT(*)::int c FROM materials WHERE sds_status!='Missing'")).rows[0].c;
  const missing = total - withSds;
  const review = (await pool.query("SELECT COUNT(*)::int c FROM materials WHERE sds_status='Review'")).rows[0].c;
  const high = (await pool.query("SELECT COUNT(*)::int c FROM materials WHERE hazard_score>=7")).rows[0].c;
  const departments = (await pool.query(
    `SELECT COALESCE(NULLIF(department,''),'غير محدد') department,COUNT(*)::int count
     FROM materials GROUP BY department ORDER BY count DESC`
  )).rows;
  res.json({ total, withSds, missing, review, high, departments });
}));

app.get("/api/materials", auth, wrap(async (req, res) => {
  const q = (req.query.q || "").trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = (await pool.query(
      `SELECT * FROM materials WHERE name ILIKE $1 OR chemical_name ILIKE $1 OR cas ILIKE $1
       OR department ILIKE $1 OR supplier ILIKE $1 ORDER BY id DESC`,
      [like]
    )).rows;
  } else {
    rows = (await pool.query("SELECT * FROM materials ORDER BY id DESC")).rows;
  }
  res.json(rows);
}));

app.post("/api/materials", auth, wrap(async (req, res) => {
  const m = req.body;
  if (!m.name) return res.status(400).json({ error: "اسم المادة مطلوب" });
  const dup = (await pool.query("SELECT id FROM materials WHERE lower(name)=lower($1)", [m.name])).rows[0];
  if (dup) return res.status(409).json({ error: "المادة موجودة بالفعل", id: dup.id });
  const { rows } = await pool.query(
    `INSERT INTO materials(name,chemical_name,cas,department,supplier,hazard_score,sds_status,revision_date,storage_qty)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [m.name, m.chemical_name || "", m.cas || "", m.department || "", m.supplier || "",
      Number(m.hazard_score) || 0, m.sds_status || "Missing", m.revision_date || "", m.storage_qty || ""]
  );
  await log(req.user, "CREATE", "material", rows[0].id, JSON.stringify(m));
  res.json({ id: rows[0].id });
}));

app.put("/api/materials/:id", auth, wrap(async (req, res) => {
  const id = Number(req.params.id), m = req.body;
  await pool.query(
    `UPDATE materials SET name=$1,chemical_name=$2,cas=$3,department=$4,supplier=$5,
     hazard_score=$6,sds_status=$7,revision_date=$8,storage_qty=$9,updated_at=NOW() WHERE id=$10`,
    [m.name, m.chemical_name || "", m.cas || "", m.department || "", m.supplier || "",
      Number(m.hazard_score) || 0, m.sds_status || "Missing", m.revision_date || "", m.storage_qty || "", id]
  );
  await log(req.user, "UPDATE", "material", id, JSON.stringify(m));
  res.json({ ok: true });
}));

app.delete("/api/materials/:id", auth, wrap(async (req, res) => {
  if (req.user.role !== "Admin") return res.status(403).json({ error: "Admin only" });
  const id = Number(req.params.id);
  await pool.query("DELETE FROM sds_files WHERE material_id=$1", [id]);
  await pool.query("DELETE FROM materials WHERE id=$1", [id]);
  await log(req.user, "DELETE", "material", id);
  res.json({ ok: true });
}));

const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });
app.post("/api/materials/:id/sds", auth, upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "لم يتم اختيار ملف" });
  const id = Number(req.params.id);
  const ext = path.extname(req.file.originalname).toLowerCase();
  const stored = req.file.filename + ext;
  fs.renameSync(req.file.path, path.join(uploadDir, stored));
  await pool.query(
    "INSERT INTO sds_files(material_id,original_name,stored_name) VALUES($1,$2,$3)",
    [id, req.file.originalname, stored]
  );
  await pool.query("UPDATE materials SET sds_status='Available',updated_at=NOW() WHERE id=$1", [id]);
  await log(req.user, "UPLOAD", "sds_file", id, req.file.originalname);
  res.json({ ok: true });
}));

app.get("/api/audit", auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*,u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
     ORDER BY a.id DESC LIMIT 300`
  );
  res.json(rows);
}));

app.post("/api/import", auth, wrap(async (req, res) => {
  const rowsIn = Array.isArray(req.body.rows) ? req.body.rows : [];
  let added = 0, skipped = 0;
  for (const m of rowsIn) {
    if (!m.name) { skipped++; continue; }
    const dup = (await pool.query("SELECT id FROM materials WHERE lower(name)=lower($1)", [m.name])).rows[0];
    if (dup) { skipped++; continue; }
    await pool.query(
      `INSERT INTO materials(name,chemical_name,cas,department,supplier,hazard_score,sds_status,revision_date,storage_qty)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [m.name, m.chemical_name || "", m.cas || "", m.department || "", m.supplier || "",
        Number(m.hazard_score) || 0, m.sds_status || "Missing", m.revision_date || "", m.storage_qty || ""]
    );
    added++;
  }
  await log(req.user, "IMPORT", "materials", null, `added=${added},skipped=${skipped}`);
  res.json({ added, skipped });
}));

initDb()
  .then(() => app.listen(PORT, () => console.log(`SDS Web App running on port ${PORT}`)))
  .catch((e) => {
    console.error("فشل الاتصال بقاعدة البيانات:", e.message);
    process.exit(1);
  });
