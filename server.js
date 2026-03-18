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

app.use(helmet())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, "public")))
app.use("/uploads", express.static(path.join(__dirname, "uploads")))

/* ================= DATABASE ================= */

try {
  await mongoose.connect(process.env.MONGO_URI)
  console.log("MongoDB Connected")
} catch (err) {
  console.log(err)
  process.exit(1)
}

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
    maxAge: 1000 * 60 * 60 * 24,
    secure: false,
    sameSite: "lax"
  }
}))

/* ================= MULTER ================= */

if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads")
}

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }
})

/* ================= MODELS ================= */

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  phone: String,
  password: String,
  role: { type: String, default: "user" }
}, { timestamps: true })

userSchema.index({ username: 1 })

const User = mongoose.model("User", userSchema)

/* SERVICE */
const serviceSchema = new mongoose.Schema({
  name: String,
  price: Number,
  duration: Number
})

const Service = mongoose.model("Service", serviceSchema)

/* SLOT */
const slotSchema = new mongoose.Schema({
  date: String,
  time: String,
  status: { type: String, default: "available" }
})

slotSchema.index({ date: 1, time: 1 })

const Slot = mongoose.model("Slot", slotSchema)

/* BOOKING */
const bookingSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  username: String,
  service: { type: mongoose.Schema.Types.ObjectId, ref: "Service" },
  slot: { type: mongoose.Schema.Types.ObjectId, ref: "Slot" },
  slip: String,
  status: { type: String, default: "pending" },
  reason: String,
  completed: { type: Boolean, default: false },
  completedAt: Date
}, { timestamps: true })

bookingSchema.index({ user: 1 })

const Booking = mongoose.model("Booking", bookingSchema)

/* ================= MIDDLEWARE ================= */

function requireLogin(req, res, next) {
  if (!req.session.user)
    return res.redirect("/login.html")
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

    console.log("Admin created -> admin / Admin123")
  }
}

await createAdmin()

/* ================= AUTH ================= */

app.post("/register", async (req, res) => {
  try {
    const { username, email, phone, password } = req.body

    if (!username || !email || !password)
      return res.send("missing data")

    const hash = await bcrypt.hash(password, 10)

    await User.create({
      username,
      email,
      phone,
      password: hash
    })

    res.redirect("/login.html")
  } catch (e) {
    res.send("user already exists")
  }
})

app.post("/login", async (req, res) => {
  const { username, password } = req.body

  const user = await User.findOne({ username })
  if (!user) return res.send("user not found")

  const match = await bcrypt.compare(password, user.password)
  if (!match) return res.send("wrong password")

  req.session.user = {
    id: user._id,
    username: user.username,
    role: user.role
  }

  req.session.save(() => {
    if (user.role === "admin") return res.redirect("/admin")
    res.redirect("/index.html")
  })
})

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("nail-session")
    res.redirect("/login.html")
  })
})

/* ================= BOOK (สำคัญ) ================= */

app.post("/book", requireLogin, upload.single("slip"), async (req, res) => {
  try {
    const { serviceId, slotId } = req.body

    const slot = await Slot.findOneAndUpdate(
      { _id: slotId, status: "available" },
      { status: "booked" },
      { new: true }
    )

    if (!slot)
      return res.send("slot already booked")

    let slip = null
    if (req.file) {
      slip = "/uploads/" + req.file.filename
    }

    await Booking.create({
      user: req.session.user.id,
      username: req.session.user.username,
      service: serviceId,
      slot: slotId,
      slip
    })

    res.redirect("/success.html")

  } catch (err) {
    console.log(err)
    res.send("error booking")
  }
})

/* ================= ADMIN ================= */

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin.html"))
})

app.get("/admin/bookings", requireAdmin, async (req, res) => {
  const bookings = await Booking.find()
    .populate("service")
    .populate("slot")

  res.json(bookings)
})

app.post("/admin/approve", requireAdmin, async (req, res) => {
  await Booking.findByIdAndUpdate(req.body.id, {
    status: "approved"
  })
  res.json({ success: true })
})

app.post("/admin/reject", requireAdmin, async (req, res) => {
  await Booking.findByIdAndUpdate(req.body.id, {
    status: "rejected",
    reason: req.body.reason
  })
  res.json({ success: true })
})

app.post("/admin/complete", requireAdmin, async (req, res) => {
  await Booking.findByIdAndUpdate(req.body.id, {
    completed: true,
    completedAt: new Date()
  })
  res.json({ success: true })
})

/* ================= START ================= */

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log("Server running on port " + PORT)
})