import express from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import bcrypt from "bcrypt";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import mongoose from "mongoose";

/* ================= CONNECT MONGODB ================= */

await mongoose.connect(process.env.MONGO_URI);
console.log("MongoDB Connected");

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
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions"
    }),
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

/* ================= MODELS ================= */

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  email: { type: String, unique: true },
  phone: String,
  password: String,
  role: { type: String, default: "user" },
  loginAttempts: { type: Number, default: 0 },
  lockUntil: Date
});
const User = mongoose.model("User", userSchema);

const serviceSchema = new mongoose.Schema({
  name: String,
  price: Number
});
const Service = mongoose.model("Service", serviceSchema);

const slotSchema = new mongoose.Schema({
  date: String,
  time: String,
  status: { type: String, default: "available" }
});
const Slot = mongoose.model("Slot", slotSchema);

const bookingSchema = new mongoose.Schema({
  user: String,
  slotId: mongoose.Schema.Types.ObjectId,
  serviceId: mongoose.Schema.Types.ObjectId,
  slip: String,
  status: { type: String, default: "pending" },
  reason: String,
  completed: { type: Boolean, default: false },
  completedAt: Date
});
const Booking = mongoose.model("Booking", bookingSchema);

/* ================= ADMIN SEED ================= */

if (!(await User.findOne({ role: "admin" }))) {
  const hashed = await bcrypt.hash("Admin123", 10);
  await User.create({
    username: "admin",
    email: "admin@gmail.com",
    phone: "0812345678",
    password: hashed,
    role: "admin"
  });
  console.log("🔥 Admin Created");
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

  if (!isValidPhone(phone))
    return res.send("เบอร์โทรไม่ถูกต้อง");

  if (!isStrongPassword(password))
    return res.send("รหัสผ่านต้อง 8 ตัว มีพิมพ์ใหญ่ + ตัวเลข");

  if (await User.findOne({ username }))
    return res.send("Username ซ้ำ");

  if (await User.findOne({ email }))
    return res.send("Email ซ้ำ");

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
    username: new RegExp("^" + username + "$", "i")
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
    id: user._id,
    username: user.username,
    role: user.role
  };

  if (user.role === "admin")
    return res.redirect("/admin.html");

  res.redirect("/index.html");
});

/* ================= SERVICES ================= */

app.get("/api/services", async (req, res) => {
  res.json(await Service.find());
});

/* ================= SLOTS ================= */

app.get("/api/slots", async (req, res) => {
  res.json(await Slot.find({ status: "available" }));
});

app.post("/admin/add-slot", requireAdmin, async (req, res) => {
  const { date, time } = req.body;

  if (await Slot.findOne({ date, time }))
    return res.json({ error: "มี slot นี้แล้ว" });

  await Slot.create({ date, time });
  res.json({ success: true });
});

/* ================= BOOK ================= */

app.post("/book", requireLogin, upload.single("slip"), async (req, res) => {
  const { slotId, serviceId } = req.body;
  const slip = req.file ? "/uploads/" + req.file.filename : null;

  const slot = await Slot.findById(slotId);
  if (!slot) return res.send("ไม่พบคิว");
  if (slot.status === "booked")
    return res.send("คิวนี้ถูกจองแล้ว");

  await Booking.create({
    user: req.session.user.username,
    slotId,
    serviceId,
    slip
  });

  slot.status = "booked";
  await slot.save();

  res.redirect("/success.html");
});

/* ================= START ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});