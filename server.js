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

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

/* ================= SECURITY ================= */
app.use(helmet({ contentSecurityPolicy: false }))

/* ================= BASIC ================= */
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use(express.static(path.join(__dirname, "public")))
app.use("/uploads", express.static(path.join(__dirname, "uploads")))

/* ================= DATABASE ================= */
await mongoose.connect(process.env.MONGO_URI)
console.log("MongoDB Connected")

/* ================= SESSION ================= */
app.use(session({
  name: "nail-session",
  secret: process.env.SESSION_SECRET || "secret123",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI
  }),
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24
  }
}))

/* ================= UPLOAD ================= */
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads")
}

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname)
  }
})

const upload = multer({ storage })

/* ================= MODELS ================= */

const User = mongoose.model("User", new mongoose.Schema({
  username: { type: String, unique: true },
  email: { type: String, unique: true },
  phone: String,
  password: String,
  role: { type: String, default: "user" }
}))

const Service = mongoose.model("Service", new mongoose.Schema({
  name: String,
  price: Number
}))

const Slot = mongoose.model("Slot", new mongoose.Schema({
  date: String,
  time: String,
  status: { type: String, default: "available" }
}))

const Booking = mongoose.model("Booking", new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  username: String,
  service: { type: mongoose.Schema.Types.ObjectId, ref: "Service" },
  slot: { type: mongoose.Schema.Types.ObjectId, ref: "Slot" },
  slip: String,
  status: { type: String, default: "pending" },
  reason: String,
  completed: { type: Boolean, default: false }
}))

/* ================= MIDDLEWARE ================= */

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login.html")
  next()
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin")
    return res.redirect("/login.html")
  next()
}

/* ================= ADMIN SEED ================= */

async function createAdmin() {
  const admin = await User.findOne({ role: "admin" })
  if (!admin) {
    const hash = await bcrypt.hash("Admin123", 10)
    await User.create({
      username: "admin",
      email: "admin@gmail.com",
      phone: "0000000000",
      password: hash,
      role: "admin"
    })
    console.log("Admin created")
  }
}
await createAdmin()

/* ================= AUTH ================= */

app.post("/register", async (req, res) => {
  const hash = await bcrypt.hash(req.body.password, 10)
  await User.create({ ...req.body, password: hash })
  res.redirect("/login.html")
})

app.post("/login", async (req, res) => {
  const user = await User.findOne({ username: req.body.username })
  if (!user) return res.send("user not found")

  const ok = await bcrypt.compare(req.body.password, user.password)
  if (!ok) return res.send("wrong password")

  req.session.user = {
    id: user._id,
    username: user.username,
    role: user.role
  }

  req.session.save(() => {
    if (user.role === "admin") return res.redirect("/admin")
    res.redirect("/")
  })
})

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("nail-session")
    res.redirect("/login.html")
  })
})

/* ================= API ================= */

app.get("/api/me", (req, res) => {
  if (!req.session.user)
    return res.status(401).json({ user: null })

  res.json({ user: req.session.user })
})

app.get("/api/services", async (req, res) => {
  res.json(await Service.find())
})

app.get("/api/slots", async (req, res) => {
  res.json(await Slot.find())
})

/* 🔥 USER BOOKINGS (ซ่อน rejected) */
app.get("/api/my-bookings", requireLogin, async (req, res) => {

  const bookings = await Booking.find({
    user: req.session.user.id,
    status: { $ne: "rejected" }
  })
    .populate("service")
    .populate("slot")

  res.json(bookings.map(b => ({
    id: b._id,
    service: b.service?.name,
    price: b.service?.price,
    date: b.slot?.date,
    time: b.slot?.time,
    status: b.status,
    reason: b.reason,
    slip: b.slip
  })))
})

/* 🔥 USER DELETE → คืน slot */
app.post("/api/delete-my-booking", requireLogin, async (req, res) => {

  const booking = await Booking.findOne({
    _id: req.body.id,
    user: req.session.user.id
  })

  if (!booking) return res.json({ error: "not found" })

  await Slot.findByIdAndUpdate(booking.slot, { status: "available" })
  await Booking.deleteOne({ _id: booking._id })

  res.json({ success: true })
})

/* ================= BOOK ================= */

app.post("/book", requireLogin, upload.single("slip"), async (req, res) => {

  const { serviceId, slotId } = req.body

  const slot = await Slot.findOneAndUpdate(
    { _id: slotId, status: "available" },
    { status: "booked" },
    { new: true }
  )

  if (!slot) return res.send("slot already booked")

  await Booking.create({
    user: req.session.user.id,
    username: req.session.user.username,
    service: serviceId,
    slot: slotId,
    slip: req.file ? "/uploads/" + req.file.filename : null
  })

  res.redirect("/success.html")
})

/* ================= ADMIN ================= */

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin.html"))
})

app.get("/admin/all-slots", requireAdmin, async (req, res) => {
  res.json(await Slot.find())
})

app.post("/admin/add-slot", requireAdmin, async (req, res) => {
  const exist = await Slot.findOne(req.body)
  if (exist) return res.json({ error: "slot exists" })

  await Slot.create(req.body)
  res.json({ success: true })
})

/* 🔥 DELETE SLOT */

app.post("/admin/delete-slot", requireAdmin, async (req, res) => {

  console.log("DELETE SLOT:", req.body.id)

  await Booking.deleteMany({ slot: req.body.id })
  await Slot.findByIdAndDelete(req.body.id)

  res.json({ success: true })
})

app.get("/admin/bookings", requireAdmin, async (req, res) => {
  const data = await Booking.find()
    .populate("service")
    .populate("slot")

  res.json(data)
})

/* 🔥 UPDATE BOOKING (คืน slot เมื่อ reject) */
/* 🔥 UPDATE BOOKING (คืน slot เมื่อ reject) */
app.post("/admin/update-booking", requireAdmin, async (req, res) => {

  const { id, status, reason } = req.body

  const booking = await Booking.findById(id)

  if (!booking) return res.status(404).json({ error: "not found" })

  console.log("UPDATE:", id, status)

  if (status === "rejected") {
    console.log("คืน slot:", booking.slot)
    await Slot.findByIdAndUpdate(booking.slot, { status: "available" })
  }

  if (status === "approved") {
    await Slot.findByIdAndUpdate(booking.slot, { status: "booked" })
  }

  await Booking.findByIdAndUpdate(id, {
    status,
    reason: reason || null
  })

  res.json({ success: true })
})

/* 🔥 DELETE SERVICE */
app.post("/admin/delete-service", requireAdmin, async (req, res) => {

  const used = await Booking.findOne({
    service: req.body.id,
    status: { $ne: "rejected" }
  })

  if (used)
    return res.json({ error: "service ยังถูกใช้อยู่" })

  await Service.findByIdAndDelete(req.body.id)
  res.json({ success: true })
})

app.post("/admin/add-service", requireAdmin, async (req, res) => {
  await Service.create({
    name: req.body.name,
    price: Number(req.body.price)
  })
  res.json({ success: true })
})

/* ================= START ================= */

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log("Server running on port " + PORT)
})