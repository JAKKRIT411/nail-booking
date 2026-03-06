import express from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import bcrypt from "bcrypt";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import mongoose from "mongoose";

/* ================= MONGODB ================= */

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("Mongo Error:", err));

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  email: { type: String, unique: true },
  phone: String,
  password: String,
  role: { type: String, default: "user" },
  loginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Number, default: null }
});

const User = mongoose.model("User", userSchema);

/* ================= BASIC ================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.set("trust proxy", 1);
app.use(
  session({
    name: "nail-session",
    secret: "super-secret-production-key",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions"
    }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",       // Render เป็น https อยู่แล้ว
      sameSite: "none",      // 🔥 เปลี่ยนเป็น none
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

/* ================= SERVICES ================= */

const serviceSchema = new mongoose.Schema({
  name: String,
  price: Number,
  duration: Number
});

const Service = mongoose.model("Service", serviceSchema);


/* ================= SLOTS ================= */

const slotSchema = new mongoose.Schema({
  date: String,
  time: String,
  available: { type: Boolean, default: true }
});

const Slot = mongoose.model("Slot", slotSchema);


/* ================= BOOKINGS ================= */

const bookingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Service"
  },
  slotId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Slot"
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Booking = mongoose.model("Booking", bookingSchema);

/* ================= ADMIN SEED ================= */

(async () => {
  const adminExists = await User.findOne({ role: "admin" });

  if (!adminExists) {
    const hashed = await bcrypt.hash("Admin123", 10);

    await User.create({
      username: "admin",
      email: "admin@gmail.com",
      phone: "0812345678",
      password: hashed,
      role: "admin"
    });

    console.log("🔥 Admin Created: admin / Admin123");
  }
})();

/* ================= VALIDATION ================= */

function isStrongPassword(password) {
  return /^(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
}

function isValidPhone(phone) {
  return /^0\d{9}$/.test(phone);
}

/* ================= MULTER ================= */

/* ================= MULTER ================= */

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // จำกัด 5MB
});


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

  if (!isValidPhone(phone))
    return res.send("เบอร์โทรไม่ถูกต้อง");

  if (!isStrongPassword(password))
    return res.send("รหัสผ่านต้อง 8 ตัว มีพิมพ์ใหญ่ + ตัวเลข");

  const existingUser = await User.findOne({
    $or: [{ username }, { email }]
  });

  if (existingUser)
    return res.send("Username หรือ Email ซ้ำ");

  const hashed = await bcrypt.hash(password, 10);

  await User.create({
    username,
    email,
    phone,
    password: hashed
  });

  res.redirect("/login.html");
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({
    username: new RegExp(`^${username}$`, "i")
  });

  if (!user) return res.send("ไม่พบผู้ใช้");

  if (user.lockUntil && Date.now() < user.lockUntil)
    return res.send("บัญชีถูกล็อก 15 นาที");

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    user.loginAttempts += 1;
    if (user.loginAttempts >= 5)
      user.lockUntil = Date.now() + 15 * 60 * 1000;

    await user.save();
    return res.send("รหัสผ่านผิด");
  }

  user.loginAttempts = 0;
  user.lockUntil = null;
  await user.save();

  req.session.user = {
    id: user._id.toString(),
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

app.post("/book", requireLogin, upload.single("slip"), async (req, res) => {

  const { slotId, serviceId } = req.body;

  const slot = db.data.slots.find(s => s.id === Number(slotId));
  if (!slot) return res.send("ไม่พบคิว");
  if (slot.status === "booked") return res.send("คิวนี้ถูกจองแล้ว");

  // 🔥 เก็บสลิปเป็น base64 ลง DB
  let slip = null;

  if (req.file) {
    slip = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
  }

  db.data.bookings.push({
    id: Date.now(),
    userId: req.session.user.id,
    username: req.session.user.username,
    slotId: Number(slotId),
    serviceId: Number(serviceId),
    slip,
    status: "pending",
    reason: null,
    completed: false,
    completedAt: null
  });

  slot.status = "booked";

  await db.write();

  res.redirect("/success.html");
});

app.get("/api/my-bookings", requireLogin, (req, res) => {

  const myBookings = db.data.bookings
    .filter(b =>
      b.userId === req.session.user.id &&
      b.completed !== true
    )
    .map(b => {

      const slot = db.data.slots.find(s => s.id === b.slotId);
      const service = db.data.services.find(s => s.id === b.serviceId);

      return {
        id: b.id,
        date: slot?.date,
        time: slot?.time,
        serviceName: service?.name,
        price: service?.price,
        slip: b.slip,
        status: b.status,
        reason: b.reason,
        completed: b.completed
      };
    });

  res.json(myBookings);
});
app.get("/api/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  res.json({ user: req.session.user });
});
/* ================= ADMIN ================= */

app.get("/admin/bookings", requireAdmin, async (req, res) => {

  const result = [];

  for (const b of db.data.bookings) {

    const slot = db.data.slots.find(s => s.id === b.slotId);
    const service = db.data.services.find(s => s.id === b.serviceId);
    const user = await User.findById(b.userId);

    result.push({
      id: b.id,
      user: b.username,
      phone: user?.phone || "-",
      email: user?.email || "-",
      date: slot?.date,
      time: slot?.time,
      service: service?.name,
      price: service?.price,
      slip: b.slip,              // 🔥 ต้องมีอันนี้
      status: b.status,
      completed: b.completed
    });
  }

  res.json(result);
});
/* ---------- ADD SLOT ---------- */
app.post("/admin/add-slot", requireAdmin, async (req, res) => {

  const { date, time } = req.body;

  if (!date || !time)
    return res.json({ error: "กรอกข้อมูลให้ครบ" });

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

/* ---------- DELETE SLOT ---------- */
app.post("/admin/delete-slot", requireAdmin, async (req, res) => {

  const { id } = req.body;

  db.data.slots = db.data.slots.filter(
    s => s.id !== Number(id)
  );

  await db.write();
  res.json({ success: true });
});

/* ---------- UPDATE BOOKING ---------- */
app.post("/admin/update-booking", requireAdmin, async (req, res) => {

  const { id, status, reason } = req.body;

  const booking = db.data.bookings.find(b => b.id == id);
  if (!booking)
    return res.json({ error: "ไม่พบการจอง" });

  booking.status = status;

  if (status === "rejected") {

    booking.reason = reason || "ปฏิเสธโดย admin";

    // 🔥 คืน slot
    const slot = db.data.slots.find(s => s.id === booking.slotId);
    if (slot) slot.status = "available";
  }

  if (status === "approved") {
    booking.reason = null;
  }

  await db.write();
  res.json({ success: true });
});

/* ---------- COMPLETE BOOKING ---------- */
app.post("/admin/complete-booking", requireAdmin, async (req, res) => {

  const { id } = req.body;

  const booking = db.data.bookings.find(
    b => b.id === Number(id)
  );

  if (!booking)
    return res.json({ error: "ไม่พบ booking" });

  booking.completed = true;
  booking.completedAt = new Date();

  await db.write();
  res.json({ success: true });
});

/* ---------- ALL SLOTS ---------- */
app.get("/admin/all-slots", requireAdmin, (req, res) => {
  res.json(db.data.slots);
});
app.post("/admin/delete-booking", requireAdmin, async (req, res) => {

  const { id } = req.body;

  const booking = db.data.bookings.find(
    b => b.id === Number(id)
  );

  if (!booking)
    return res.json({ error: "ไม่พบ booking" });

  // 🔥 คืน slot ถ้ายังไม่ completed
  if (!booking.completed) {
    const slot = db.data.slots.find(
      s => s.id === booking.slotId
    );
    if (slot) slot.status = "available";
  }

  db.data.bookings = db.data.bookings.filter(
    b => b.id !== Number(id)
  );

  await db.write();
  res.json({ success: true });
});
/* ---------- ADD SERVICE ---------- */
app.post("/admin/add-service", requireAdmin, async (req, res) => {

  const { name, price } = req.body;

  if (!name || !price)
    return res.json({ error: "กรอกข้อมูลให้ครบ" });

  db.data.services.push({
    id: Date.now(),
    name,
    price: Number(price)
  });

  await db.write();
  res.json({ success: true });
});

/* ---------- UPDATE SERVICE ---------- */
app.post("/admin/update-service", requireAdmin, async (req, res) => {

  const { id, name, price } = req.body;

  const service = db.data.services.find(
    s => s.id === Number(id)
  );

  if (!service)
    return res.json({ error: "ไม่พบ service" });

  service.name = name;
  service.price = Number(price);

  await db.write();
  res.json({ success: true });
});

/* ---------- DELETE SERVICE ---------- */
app.post("/admin/delete-service", requireAdmin, async (req, res) => {

  const { id } = req.body;

  db.data.services = db.data.services.filter(
    s => s.id !== Number(id)
  );

  await db.write();
  res.json({ success: true });
});
app.post("/api/services", requireAdmin, async (req, res) => {

  const service = new Service({
    name: req.body.name,
    price: req.body.price,
    duration: req.body.duration
  });

  await service.save();

  res.json(service);

});


app.get("/api/services", async (req, res) => {

  const services = await Service.find();

  res.json(services);

});
app.post("/api/slots", requireAdmin, async (req, res) => {

  const slot = new Slot({
    date: req.body.date,
    time: req.body.time
  });

  await slot.save();

  res.json(slot);

});


app.get("/api/slots", async (req, res) => {

  const slots = await Slot.find({ available: true });

  res.json(slots);

});
app.post("/api/book", requireLogin, async (req, res) => {

  const booking = new Booking({
    userId: req.session.user._id,
    serviceId: req.body.serviceId,
    slotId: req.body.slotId
  });

  await booking.save();

  await Slot.findByIdAndUpdate(req.body.slotId, {
    available: false
  });

  res.json({ success: true });

});
/* ================= START ================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});