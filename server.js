import express from "express"
import mongoose from "mongoose"
import session from "express-session"
import MongoStore from "connect-mongo"
import bcrypt from "bcrypt"
import multer from "multer"
import path from "path"
import { fileURLToPath } from "url"
import dotenv from "dotenv"
import helmet from "helmet"
import fs from "fs"
import rateLimit from "express-rate-limit"
import sharp from "sharp"

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

/* ============================================================
   SECURITY
============================================================ */
app.use(helmet({ contentSecurityPolicy: false }))
app.set("trust proxy", 1)

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "ลองใหม่อีก 15 นาที" },
  standardHeaders: true,
  legacyHeaders: false
})

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
})

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "อัปโหลดถี่เกินไป" }
})

/* ============================================================
   BASIC MIDDLEWARE
============================================================ */
app.use(express.json({ limit: "2mb" }))
app.use(express.urlencoded({ extended: true, limit: "2mb" }))
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }))
app.use("/uploads", express.static(path.join(__dirname, "uploads")))

/* ============================================================
   DATABASE
============================================================ */
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    })
    console.log("✅ MongoDB Connected")
  } catch (err) {
    console.error("❌ MongoDB Error:", err.message)
    process.exit(1)
  }
}
await connectDB()

mongoose.connection.on("disconnected", () => {
  console.warn("⚠️  MongoDB disconnected — reconnecting...")
  setTimeout(connectDB, 5000)
})

/* ============================================================
   SESSION
============================================================ */
app.use(session({
  name: "nail_sess",
  secret: process.env.SESSION_SECRET || "dev_secret_change_me",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    ttl: 60 * 60 * 24,
    touchAfter: 60 * 60
  }),
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24
  }
}))

/* ============================================================
   UPLOAD — multer with type + size validation
============================================================ */
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads")

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (_, file, cb) => {
    let ext = path.extname(file.originalname || "").toLowerCase()
    // iOS HEIC — บันทึกเป็น .jpg เพื่อให้ browser แสดงได้ปกติ
    // (ไฟล์จะถูก convert หลัง save ด้วย sharp)
    if ([".heic", ".heif"].includes(ext) || file.mimetype === "application/octet-stream") {
      ext = ".heic"
    }
    if (!ext || ext === ".") ext = ".jpg"
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  }
})

const fileFilter = (_, file, cb) => {
  // iOS ส่ง HEIC ด้วย mime หลายแบบ หรือแม้แต่ octet-stream
  const allowedMimes = [
    "image/jpeg", "image/jpg", "image/png", "image/webp",
    "image/heic", "image/heif",
    "image/heic-sequence", "image/heif-sequence",
    "application/octet-stream"
  ]
  const allowedExts = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]
  const ext = path.extname(file.originalname || "").toLowerCase()
  if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true)
  } else {
    cb(new Error("อัปโหลดได้เฉพาะรูปภาพ (JPG, PNG, HEIC)"))
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
})

// Convert HEIC/HEIF → JPEG so browsers can display slips correctly
async function convertIfNeeded(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase()
    if (ext === ".heic" || ext === ".heif") {
      const jpegPath = filePath.replace(/\.hei[cf]$/i, ".jpg")
      await sharp(filePath).jpeg({ quality: 85 }).toFile(jpegPath)
      fs.unlinkSync(filePath)           // ลบ HEIC ต้นฉบับ
      return jpegPath
    }
    return filePath
  } catch (e) {
    console.warn("convertIfNeeded skipped:", e.message)
    return filePath                     // ถ้า convert ไม่ได้ ใช้ไฟล์เดิม
  }
}

/* ============================================================
   MODELS
============================================================ */
const userSchema = new mongoose.Schema({
  username:  { type: String, unique: true, trim: true, minlength: 3 },
  email:     { type: String, unique: true, lowercase: true, trim: true },
  phone:     { type: String, trim: true },
  password:  String,
  role:      { type: String, enum: ["user", "admin"], default: "user" },
  balance:   { type: Number, default: 0, min: 0 },          // wallet balance (baht)
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true })

const serviceSchema = new mongoose.Schema({
  name:        { type: String, trim: true },
  price:       { type: Number, min: 0 },
  duration:    { type: Number, default: 60 },   // minutes
  description: { type: String, default: "" },
  active:      { type: Boolean, default: true }
}, { timestamps: true })

const slotSchema = new mongoose.Schema({
  date:   { type: String, index: true },
  time:   String,
  status: { type: String, enum: ["available", "booked", "blocked"], default: "available" }
}, { timestamps: true })

slotSchema.index({ date: 1, time: 1 }, { unique: true })

const bookingSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  username:    String,
  service:     { type: mongoose.Schema.Types.ObjectId, ref: "Service" },
  slot:        { type: mongoose.Schema.Types.ObjectId, ref: "Slot" },
  slip:        String,
  status:      { type: String, enum: ["pending", "approved", "rejected", "cancelled"], default: "pending", index: true },
  paymentMethod: { type: String, enum: ["slip", "wallet"], default: "slip" },
  reason:      String,
  note:        String,
  queueNumber: { type: Number, default: 0 }
}, { timestamps: true })

// TopUp: เติมเงิน wallet ผ่านสลิป
const topupSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  username:  String,
  amount:    { type: Number, min: 1 },
  slip:      String,
  status:    { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
  reason:    String
}, { timestamps: true })

const User    = mongoose.model("User", userSchema)
const Service = mongoose.model("Service", serviceSchema)
const Slot    = mongoose.model("Slot", slotSchema)
const Booking = mongoose.model("Booking", bookingSchema)
const TopUp   = mongoose.model("TopUp", topupSchema)

/* ============================================================
   MIDDLEWARE
============================================================ */
const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" })
  next()
}

const requireAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    if (req.accepts("html")) return res.redirect("/login.html")
    return res.status(403).json({ error: "ไม่มีสิทธิ์เข้าถึง" })
  }
  next()
}

/* ============================================================
   ADMIN SEED
============================================================ */
const seed = async () => {
  const admin = await User.findOne({ role: "admin" })
  if (!admin) {
    const hash = await bcrypt.hash("Admin123", 12)
    await User.create({ username: "admin", email: "admin@nailshop.com", phone: "0000000000", password: hash, role: "admin" })
    console.log("✅ Admin created — admin / Admin123")
  }
}
await seed()

/* ============================================================
   AUTH ROUTES
============================================================ */
app.post("/register", authLimiter, async (req, res) => {
  try {
    const { username, email, phone, password } = req.body

    if (!username || !email || !password || !phone)
      return res.status(400).json({ error: "กรุณากรอกข้อมูลให้ครบ" })

    if (password.length < 8 || !/[A-Z]/.test(password) || !/\d/.test(password))
      return res.status(400).json({ error: "รหัสผ่านต้องมีอย่างน้อย 8 ตัว มีตัวพิมพ์ใหญ่และตัวเลข" })

    const exists = await User.findOne({ $or: [{ username }, { email }] })
    if (exists) return res.status(409).json({ error: "Username หรือ Email นี้ถูกใช้แล้ว" })

    const hash = await bcrypt.hash(password, 12)
    await User.create({ username, email, phone, password: hash })

    res.json({ success: true })
  } catch (e) {
    console.error("register error:", e)
    res.status(500).json({ error: "เกิดข้อผิดพลาด กรุณาลองใหม่" })
  }
})

app.post("/login", authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body
    const user = await User.findOne({ username })
    if (!user) return res.status(401).json({ error: "ไม่พบบัญชีผู้ใช้" })

    const ok = await bcrypt.compare(password, user.password)
    if (!ok) return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" })

    req.session.user = { id: user._id, username: user.username, role: user.role }
    await new Promise((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()))

    res.json({ success: true, role: user.role })
  } catch (e) {
    console.error("login error:", e)
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("nail_sess")
    res.json({ success: true })
  })
})

/* ============================================================
   USER API
============================================================ */
app.use("/api", apiLimiter)

app.get("/api/me", (req, res) => {
  if (!req.session.user) return res.status(401).json({ user: null })
  res.json({ user: req.session.user })
})

app.get("/api/profile", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.user.id).select("-password")
    if (!user) return res.status(404).json({ error: "ไม่พบผู้ใช้" })
    res.json(user)
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.get("/api/services", async (req, res) => {
  try {
    const services = await Service.find({ active: true }).sort({ price: 1 })
    res.json(services)
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.get("/api/slots", async (req, res) => {
  try {
    const { date } = req.query
    const query = date ? { date, status: "available" } : { status: "available" }
    const slots = await Slot.find(query).sort({ date: 1, time: 1 })
    res.json(slots)
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.get("/api/available-dates", async (req, res) => {
  try {
    const dates = await Slot.distinct("date", { status: "available" })
    res.json(dates.sort())
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.get("/api/my-bookings", requireLogin, async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.session.user.id })
      .populate("service")
      .populate("slot")
      .sort({ createdAt: -1 })
      .limit(50)

    res.json(bookings.map(b => ({
      id: b._id,
      service: b.service?.name,
      price: b.service?.price,
      duration: b.service?.duration,
      date: b.slot?.date,
      time: b.slot?.time,
      status: b.status,
      reason: b.reason,
      note: b.note,
      slip: b.slip,
      paymentMethod: b.paymentMethod,
      queueNumber: b.queueNumber,
      createdAt: b.createdAt
    })))
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

// Cancel booking (only pending)
app.post("/api/cancel-booking", requireLogin, async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.body.id, user: req.session.user.id })
    if (!booking) return res.status(404).json({ error: "ไม่พบการจอง" })
    if (booking.status !== "pending") return res.status(400).json({ error: "ไม่สามารถยกเลิกได้ (สถานะไม่ใช่ pending)" })

    // Refund wallet payment
    if (booking.paymentMethod === "wallet") {
      const svc = await Service.findById(booking.service)
      if (svc) await User.findByIdAndUpdate(booking.user, { $inc: { balance: svc.price } })
    }

    await Slot.findByIdAndUpdate(booking.slot, { status: "available" })
    await Booking.findByIdAndUpdate(booking._id, { status: "cancelled" })

    res.json({ success: true })
  } catch (e) {
    console.error("cancel error:", e)
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

/* ============================================================
   BOOKING — with queue number
============================================================ */
app.post("/api/book", requireLogin, uploadLimiter, upload.single("slip"), async (req, res) => {
  const session = await mongoose.startSession()
  session.startTransaction()
  try {
    const { serviceId, slotId, paymentMethod, note } = req.body
    if (!serviceId || !slotId) {
      await session.abortTransaction()
      return res.status(400).json({ error: "กรุณาเลือกบริการและเวลา" })
    }

    const service = await Service.findById(serviceId).session(session)
    if (!service) {
      await session.abortTransaction()
      return res.status(404).json({ error: "ไม่พบบริการ" })
    }

    // Lock slot
    const slot = await Slot.findOneAndUpdate(
      { _id: slotId, status: "available" },
      { status: "booked" },
      { new: true, session }
    )
    if (!slot) {
      await session.abortTransaction()
      return res.status(409).json({ error: "คิวนี้ถูกจองแล้ว กรุณาเลือกเวลาอื่น" })
    }

    // Wallet payment
    let slip = null
    if (paymentMethod === "wallet") {
      const user = await User.findById(req.session.user.id).session(session)
      if (user.balance < service.price) {
        await session.abortTransaction()
        return res.status(400).json({ error: `ยอดเงินไม่เพียงพอ (มี ${user.balance}฿ ต้องการ ${service.price}฿)` })
      }
      await User.findByIdAndUpdate(req.session.user.id, { $inc: { balance: -service.price } }, { session })
    } else {
      if (!req.file) {
        await session.abortTransaction()
        return res.status(400).json({ error: "กรุณาแนบสลิปการโอนเงิน" })
      }
      const converted = await convertIfNeeded(req.file.path)
      slip = "/uploads/" + path.basename(converted)
    }

    // Queue number = count of today's approved/pending bookings + 1
    const today = slot.date
    const qNum = await Booking.countDocuments({
      status: { $in: ["approved", "pending"] }
    }).session(session) + 1

    const booking = await Booking.create([{
      user: req.session.user.id,
      username: req.session.user.username,
      service: serviceId,
      slot: slotId,
      slip,
      paymentMethod: paymentMethod === "wallet" ? "wallet" : "slip",
      note: note || "",
      queueNumber: qNum,
      status: paymentMethod === "wallet" ? "approved" : "pending"
    }], { session })

    await session.commitTransaction()
    res.json({ success: true, booking: booking[0]._id, queueNumber: qNum })
  } catch (e) {
    await session.abortTransaction()
    console.error("booking error:", e)
    res.status(500).json({ error: "เกิดข้อผิดพลาด กรุณาลองใหม่" })
  } finally {
    session.endSession()
  }
})

/* ============================================================
   TOP-UP — เติมเงิน wallet
============================================================ */
app.post("/api/topup", requireLogin, uploadLimiter, upload.single("slip"), async (req, res) => {
  try {
    const amount = Number(req.body.amount)
    if (!amount || amount < 50 || amount > 50000)
      return res.status(400).json({ error: "ยอดเงินต้องอยู่ระหว่าง 50–50,000 บาท" })

    if (!req.file)
      return res.status(400).json({ error: "กรุณาแนบสลิปการโอนเงิน" })

    await TopUp.create({
      user: req.session.user.id,
      username: req.session.user.username,
      amount,
      const convertedTopup = await convertIfNeeded(req.file.path)
    slip: "/uploads/" + path.basename(convertedTopup),
      status: "pending"
    })

    res.json({ success: true })
  } catch (e) {
    console.error("topup error:", e)
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.get("/api/my-topups", requireLogin, async (req, res) => {
  try {
    const topups = await TopUp.find({ user: req.session.user.id }).sort({ createdAt: -1 }).limit(20)
    res.json(topups)
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

/* ============================================================
   ADMIN API
============================================================ */
// Serve admin page
app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin.html"))
})

app.get("/admin/stats", requireAdmin, async (req, res) => {
  try {
    const [totalUsers, totalBookings, pendingBookings, pendingTopups, approvedBookings] = await Promise.all([
      User.countDocuments({ role: "user" }),
      Booking.countDocuments(),
      Booking.countDocuments({ status: "pending" }),
      TopUp.countDocuments({ status: "pending" }),
      Booking.find({ status: "approved" }).populate("service")
    ])

    const revenue = approvedBookings.reduce((sum, b) => sum + (b.service?.price || 0), 0)

    // Revenue by service
    const revenueByService = {}
    approvedBookings.forEach(b => {
      if (!b.service) return
      const k = b.service.name
      revenueByService[k] = (revenueByService[k] || 0) + b.service.price
    })

    res.json({ totalUsers, totalBookings, pendingBookings, pendingTopups, revenue, revenueByService })
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.get("/admin/all-slots", requireAdmin, async (req, res) => {
  try {
    const slots = await Slot.find().sort({ date: 1, time: 1 })
    res.json(slots)
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.post("/admin/add-slot", requireAdmin, async (req, res) => {
  try {
    const { date, time } = req.body
    if (!date || !time) return res.status(400).json({ error: "กรอกวันและเวลา" })
    const exists = await Slot.findOne({ date, time })
    if (exists) return res.status(409).json({ error: "คิวนี้มีอยู่แล้ว" })
    await Slot.create({ date, time })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.post("/admin/bulk-add-slots", requireAdmin, async (req, res) => {
  try {
    const { date, times } = req.body
    if (!date || !Array.isArray(times) || !times.length)
      return res.status(400).json({ error: "ข้อมูลไม่ครบ" })

    const ops = times.map(time => ({
      updateOne: {
        filter: { date, time },
        update: { $setOnInsert: { date, time, status: "available" } },
        upsert: true
      }
    }))

    const result = await Slot.bulkWrite(ops)
    res.json({ success: true, created: result.upsertedCount })
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.post("/admin/delete-slot", requireAdmin, async (req, res) => {
  try {
    const slot = await Slot.findById(req.body.id)
    if (!slot) return res.status(404).json({ error: "ไม่พบคิว" })
    if (slot.status === "booked") return res.status(400).json({ error: "คิวนี้มีการจองอยู่ ไม่สามารถลบได้" })
    await Slot.findByIdAndDelete(req.body.id)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.get("/admin/bookings", requireAdmin, async (req, res) => {
  try {
    const { status } = req.query
    const filter = status ? { status } : {}
    const bookings = await Booking.find(filter)
      .populate("service")
      .populate("slot")
      .populate("user", "username email phone")
      .sort({ createdAt: -1 })
      .limit(200)

    res.json(bookings.map(b => ({
      id: b._id,
      username: b.username,
      email: b.user?.email,
      phone: b.user?.phone,
      service: b.service,
      slot: b.slot,
      status: b.status,
      reason: b.reason,
      note: b.note,
      slip: b.slip,
      paymentMethod: b.paymentMethod,
      queueNumber: b.queueNumber,
      createdAt: b.createdAt
    })))
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.post("/admin/update-booking", requireAdmin, async (req, res) => {
  try {
    const { id, status, reason } = req.body
    const booking = await Booking.findById(id).populate("service")
    if (!booking) return res.status(404).json({ error: "ไม่พบการจอง" })

    if (status === "rejected") {
      await Slot.findByIdAndUpdate(booking.slot, { status: "available" })
      // Refund if wallet
      if (booking.paymentMethod === "wallet" && booking.service) {
        await User.findByIdAndUpdate(booking.user, { $inc: { balance: booking.service.price } })
      }
    }

    await Booking.findByIdAndUpdate(id, { status, reason: reason || null })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.get("/admin/services", requireAdmin, async (req, res) => {
  try {
    res.json(await Service.find().sort({ price: 1 }))
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.post("/admin/add-service", requireAdmin, async (req, res) => {
  try {
    const { name, price, duration, description } = req.body
    if (!name || !price) return res.status(400).json({ error: "กรอกชื่อและราคา" })
    await Service.create({ name, price: Number(price), duration: Number(duration) || 60, description: description || "" })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.post("/admin/update-service", requireAdmin, async (req, res) => {
  try {
    const { id, name, price, duration, description, active } = req.body
    await Service.findByIdAndUpdate(id, { name, price: Number(price), duration: Number(duration) || 60, description, active })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.post("/admin/delete-service", requireAdmin, async (req, res) => {
  try {
    const used = await Booking.findOne({ service: req.body.id, status: { $in: ["pending", "approved"] } })
    if (used) return res.status(400).json({ error: "ยังมีการจองที่ใช้บริการนี้อยู่" })
    await Service.findByIdAndDelete(req.body.id)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

// Top-up management
app.get("/admin/topups", requireAdmin, async (req, res) => {
  try {
    const { status } = req.query
    const filter = status ? { status } : {}
    const topups = await TopUp.find(filter).sort({ createdAt: -1 }).limit(100)
    res.json(topups)
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.post("/admin/approve-topup", requireAdmin, async (req, res) => {
  const dbSession = await mongoose.startSession()
  dbSession.startTransaction()
  try {
    const { id } = req.body
    const topup = await TopUp.findById(id).session(dbSession)
    if (!topup) { await dbSession.abortTransaction(); return res.status(404).json({ error: "ไม่พบรายการ" }) }
    if (topup.status !== "pending") { await dbSession.abortTransaction(); return res.status(400).json({ error: "รายการนี้ถูกดำเนินการแล้ว" }) }

    await User.findByIdAndUpdate(topup.user, { $inc: { balance: topup.amount } }, { session: dbSession })
    await TopUp.findByIdAndUpdate(id, { status: "approved" }, { session: dbSession })

    await dbSession.commitTransaction()
    res.json({ success: true })
  } catch (e) {
    await dbSession.abortTransaction()
    console.error("approve topup error:", e)
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  } finally {
    dbSession.endSession()
  }
})

app.post("/admin/reject-topup", requireAdmin, async (req, res) => {
  try {
    const { id, reason } = req.body
    const topup = await TopUp.findById(id)
    if (!topup) return res.status(404).json({ error: "ไม่พบรายการ" })
    if (topup.status !== "pending") return res.status(400).json({ error: "รายการนี้ถูกดำเนินการแล้ว" }) 
    await TopUp.findByIdAndUpdate(id, { status: "rejected", reason: reason || "" })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

app.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    const users = await User.find({ role: "user" }).select("-password").sort({ createdAt: -1 })
    res.json(users)
  } catch (e) {
    res.status(500).json({ error: "เกิดข้อผิดพลาด" })
  }
})

/* ============================================================
   HEALTH CHECK
============================================================ */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    uptime: Math.floor(process.uptime())
  })
})

/* ============================================================
   GLOBAL ERROR HANDLER
============================================================ */
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "ไฟล์ใหญ่เกิน 10MB" })
  console.error("Unhandled error:", err)
  res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" })
})

process.on("uncaughtException", (err) => console.error("Uncaught:", err))
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err))

/* ============================================================
   START
============================================================ */
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`))
