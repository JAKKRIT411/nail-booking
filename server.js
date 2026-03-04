import express from "express";
import session from "express-session";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import bcrypt from "bcrypt";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import mongoose from "mongoose";

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("Mongo Error:", err));
/* ================= BASIC ================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static("uploads"));

app.use(
  session({
    name: "nail-session",
    secret: "super-secret-production-key",
    resave: false,
    saveUninitialized: false,
 cookie: {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 24 * 60 * 60 * 1000
}
  })
);

/* ================= DATABASE ================= */

const adapter = new JSONFile(
  path.join(__dirname, "database", "db.json")
);

const defaultData = {
  users: [],
  services: [],
  slots: [],
  bookings: []
};

const db = new Low(adapter, defaultData);
await db.read();

if (!db.data) db.data = defaultData;
if (!db.data.users) db.data.users = [];
if (!db.data.services) db.data.services = [];
if (!db.data.slots) db.data.slots = [];
if (!db.data.bookings) db.data.bookings = [];

await db.write();

/* ================= ADMIN SEED ================= */

if (!db.data.users.find(u => u.role === "admin")) {
  const hashed = await bcrypt.hash("Admin123", 10);

  db.data.users.push({
    id: Date.now(),
    username: "admin",
    email: "admin@gmail.com",
    phone: "0812345678",
    password: hashed,
    role: "admin",
    loginAttempts: 0,
    lockUntil: null
  });

  await db.write();
  console.log("🔥 Admin Created: admin / Admin123");
}

/* ================= VALIDATION ================= */

function isStrongPassword(password) {
  return /^(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
}

function isValidPhone(phone) {
  return /^0\d{9}$/.test(phone);
}

/* ================= MULTER ================= */

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({ storage });

/* ================= MIDDLEWARE ================= */

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login.html");
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin")
    return res.redirect("/login.html");
  next();
}

/* ================= AUTH ================= */

app.post("/register", async (req, res) => {
  const { username, email, phone, password } = req.body;

  if (!username || !email || !phone || !password)
    return res.send("กรอกข้อมูลให้ครบ");

  if (db.data.users.find(u => u.username === username))
    return res.send("Username ซ้ำ");

  if (db.data.users.find(u => u.email === email))
    return res.send("Email ซ้ำ");

  if (!isValidPhone(phone))
    return res.send("เบอร์โทรไม่ถูกต้อง");

  if (!isStrongPassword(password))
    return res.send("รหัสผ่านต้อง 8 ตัว มีพิมพ์ใหญ่ + ตัวเลข");

  const hashed = await bcrypt.hash(password, 10);

  db.data.users.push({
    id: Date.now(),
    username,
    email,
    phone,
    password: hashed,
    role: "user",
    loginAttempts: 0,
    lockUntil: null
  });

  await db.write();
  res.redirect("/login.html");
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const user = db.data.users.find(
    u => u.username.toLowerCase() === username.toLowerCase()
  );

  if (!user) return res.send("ไม่พบผู้ใช้");

  if (user.lockUntil && Date.now() < user.lockUntil)
    return res.send("บัญชีถูกล็อก 15 นาที");

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    user.loginAttempts += 1;
    if (user.loginAttempts >= 5)
      user.lockUntil = Date.now() + 15 * 60 * 1000;

    await db.write();
    return res.send("รหัสผ่านผิด");
  }

  user.loginAttempts = 0;
  user.lockUntil = null;
  await db.write();

  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role
  };

  if (user.role === "admin")
    return res.redirect("/admin.html");

  res.redirect("/index.html");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login.html");
  });
});

/* ================= USER ================= */

app.get("/api/services", (req, res) => {
  res.json(db.data.services);
});

app.get("/api/slots", (req, res) => {
  res.json(db.data.slots.filter(s => s.status === "available"));
});

/* 🔥 FIXED BOOK LOGIC */
app.post("/book", requireLogin, upload.single("slip"), async (req, res) => {

  const { slotId, serviceId } = req.body;
  const slip = req.file ? "/uploads/" + req.file.filename : null;

  const slotIdNumber = Number(slotId);

  const slot = db.data.slots.find(s => s.id === slotIdNumber);
  if (!slot)
    return res.send("ไม่พบคิว");

  // ❗ กันจองซ้ำ
  if (slot.status === "booked")
    return res.send("คิวนี้ถูกจองแล้ว");

 db.data.bookings.push({
  id: Date.now(),
  user: req.session.user.username,
  slotId: slotIdNumber,
  serviceId: Number(serviceId),
  slip,
  status: "pending",
  reason: null,

  // 🔥 เพิ่มใหม่ (ไม่กระทบของเดิม)
  completed: false,
  completedAt: null
});

  // 🔥 สำคัญ: ทำให้คิวหายทันที
  slot.status = "booked";

  await db.write();

  res.redirect("/success.html");
});

/* 🔥 NEW: MY BOOKINGS API */
app.get("/api/my-bookings", requireLogin, (req, res) => {

  const myBookings = db.data.bookings
    .filter(b =>
  b.user === req.session.user.username &&
  b.completed !== true
)
    .map(b => {

      const slot = db.data.slots.find(s => s.id === b.slotId);
      const service = db.data.services.find(s => s.id === b.serviceId);

      return {
        id: b.id,
        date: slot?.date,
        time: slot?.time,
        serviceName: service?.name,   // 🔥 แก้ตรงนี้
        price: service?.price,
        slip: b.slip,
        status: b.status,
        reason: b.reason || null,
        completed: b.completed || false
      };
    });

  res.json(myBookings);
});

/* ================= ADMIN ================= */
app.get("/admin/all-slots", requireAdmin, (req, res) => {
  res.json(db.data.slots);
});
app.get("/admin/bookings", requireAdmin, (req, res) => {

  const result = db.data.bookings.map(b => {

    const slot = db.data.slots.find(s => s.id === b.slotId);
    const service = db.data.services.find(s => s.id === b.serviceId);

    // 🔥 เพิ่มอันนี้
    const user = db.data.users.find(u => u.username === b.user);

    return {
      id: b.id,
      user: b.user,
      phone: user?.phone || "-",
      email: user?.email || "-",
      date: slot?.date,
      time: slot?.time,
      service: service?.name,
      price: service?.price,
      slip: b.slip,
      status: b.status,
      reason: b.reason || null,
      completed: b.completed || false
    };
  });

  res.json(result);
});


app.post("/admin/add-slot", requireAdmin, async (req, res) => {

  const { date, time } = req.body;

  if (!date || !time)
    return res.json({ error: "ข้อมูลไม่ครบ" });

  const exists = db.data.slots.find(
    s => s.date === date && s.time === time
  );

  if (exists)
    return res.json({ error: "มี slot นี้แล้ว" });

  db.data.slots.push({
    id: Date.now(),
    date,
    time,
    status: "available"
  });

  await db.write();
  res.json({ success: true });
});
app.post("/admin/delete-slot", requireAdmin, async (req, res) => {

  const { id } = req.body;

  const slot = db.data.slots.find(s => s.id == id);
  if (!slot)
    return res.json({ error: "ไม่พบ slot" });

  if (slot.status === "booked")
    return res.json({ error: "ลบไม่ได้ มีการจองแล้ว" });

  db.data.slots = db.data.slots.filter(s => s.id != id);

  await db.write();
  res.json({ success: true });
});
app.post("/admin/add-service", requireAdmin, async (req, res) => {

  const { name, price } = req.body;

  if (!name || !price)
    return res.json({ error: "ข้อมูลไม่ครบ" });

  db.data.services.push({
    id: Date.now(),
    name,
    price: Number(price)
  });

  await db.write();
  res.json({ success: true });
});
app.post("/admin/update-service", requireAdmin, async (req, res) => {

  const { id, name, price } = req.body;

  const service = db.data.services.find(s => s.id == id);
  if (!service)
    return res.json({ error: "ไม่พบบริการ" });

  service.name = name;
  service.price = Number(price);

  await db.write();
  res.json({ success: true });
});
app.post("/admin/delete-service", requireAdmin, async (req, res) => {

  const { id } = req.body;

  db.data.services = db.data.services.filter(s => s.id != id);

  await db.write();
  res.json({ success: true });
});

app.post("/admin/update-booking", requireAdmin, async (req, res) => {

  const { id, status, reason } = req.body;
  const booking = db.data.bookings.find(b => b.id == id);

  if (!booking)
    return res.json({ error: "ไม่พบการจอง" });

  booking.status = status;

  if (status === "rejected") {
    booking.reason = reason || "ไม่ผ่านการตรวจสอบ";

    const slot = db.data.slots.find(s => s.id === booking.slotId);
    if (slot) slot.status = "available";
  }

  if (status === "approved") {

    const alreadyApproved = db.data.bookings.find(
      b => b.slotId === booking.slotId &&
           b.status === "approved" &&
           b.id !== booking.id
    );

    if (alreadyApproved)
      return res.json({ error: "คิวนี้ถูกอนุมัติไปแล้ว" });

    booking.reason = null;

    const slot = db.data.slots.find(s => s.id === booking.slotId);
    if (slot) slot.status = "booked";
  }

  await db.write();
  res.json({ success: true });
});
app.get("/api/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  res.json({ user: req.session.user });
});
app.get("/admin/revenue", requireAdmin, (req, res) => {

  const revenue = {};

  db.data.bookings
    .filter(b => b.status === "approved")
    .forEach(b => {

      const slot = db.data.slots.find(s => s.id === b.slotId);
      const service = db.data.services.find(s => s.id === b.serviceId);

      if (!slot || !service) return;

      if (!revenue[slot.date])
        revenue[slot.date] = 0;

      revenue[slot.date] += service.price;
    });

  res.json(revenue);
});
app.post("/admin/delete-booking", requireAdmin, async (req, res) => {

  const { id } = req.body;

  const booking = db.data.bookings.find(b => b.id == id);
  if (!booking)
    return res.json({ error: "ไม่พบการจอง" });

  // คืน slot ถ้าเคย approved
  if (booking.status === "approved") {
    const slot = db.data.slots.find(s => s.id === booking.slotId);
    if (slot) slot.status = "available";
  }

  db.data.bookings = db.data.bookings.filter(b => b.id != id);

  await db.write();
  res.json({ success: true });
});
/* 🔥 NEW: COMPLETE BOOKING */
app.post("/admin/complete-booking", requireAdmin, async (req, res) => {

  const { id } = req.body;

  const booking = db.data.bookings.find(b => b.id == id);
  if (!booking)
    return res.json({ error: "ไม่พบการจอง" });

  if (booking.status !== "approved")
    return res.json({ error: "ต้องอนุมัติก่อนถึงจะปิดงานได้" });

  booking.completed = true;
  booking.completedAt = new Date().toISOString();

  await db.write();
  res.json({ success: true });
});
/* ================= HEALTH CHECK ================= */

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    server: "nail-booking",
    time: new Date()
  });
});
/* ================= SAFE ERROR ================= */

process.on("uncaughtException", (err) => {
  console.log("UNCAUGHT ERROR:", err);
});

process.on("unhandledRejection", (err) => {
  console.log("UNHANDLED PROMISE:", err);
});
/* ================= START ================= */

/* ================= START ================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});