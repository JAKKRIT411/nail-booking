import express from "express"
import mongoose from "mongoose"
import session from "express-session"
import MongoStore from "connect-mongo"
import bcrypt from "bcrypt"
import multer from "multer"
import path from "path"
import { fileURLToPath } from "url"
import dotenv from "dotenv"

dotenv.config()

/* ================= BASIC ================= */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, "public")))

/* ================= DATABASE ================= */

mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.log(err))

/* ================= SESSION ================= */

app.use(session({
 name:"nail-session",
 secret:process.env.SESSION_SECRET || "super-secret",
 resave:false,
 saveUninitialized:false,
 store:MongoStore.create({
  mongoUrl:process.env.MONGO_URI
 }),
 cookie:{
  httpOnly:true,
  maxAge:24*60*60*1000
 }
}))

/* ================= MULTER ================= */

const storage = multer.memoryStorage()

const upload = multer({
 storage,
 limits:{ fileSize: 5 * 1024 * 1024 }
})

/* ================= MODELS ================= */

const userSchema = new mongoose.Schema({

 username:{type:String,unique:true},
 email:{type:String,unique:true},
 phone:String,
 password:String,

 role:{
  type:String,
  default:"user"
 },

 loginAttempts:{
  type:Number,
  default:0
 },

 lockUntil:Number

},{timestamps:true})

const User = mongoose.model("User",userSchema)

/* ---------------- SERVICE ---------------- */

const serviceSchema = new mongoose.Schema({

 name:String,
 price:Number,
 duration:Number

})

const Service = mongoose.model("Service",serviceSchema)

/* ---------------- SLOT ---------------- */

const slotSchema = new mongoose.Schema({

 date:String,
 time:String,

 status:{
  type:String,
  default:"available"
 }

})

const Slot = mongoose.model("Slot",slotSchema)

/* ---------------- BOOKING ---------------- */

const bookingSchema = new mongoose.Schema({

 user:{
  type:mongoose.Schema.Types.ObjectId,
  ref:"User"
 },

 username:String,

 service:{
  type:mongoose.Schema.Types.ObjectId,
  ref:"Service"
 },

 slot:{
  type:mongoose.Schema.Types.ObjectId,
  ref:"Slot"
 },

 slip:String,

 status:{
  type:String,
  default:"pending"
 },

 reason:String,

 completed:{
  type:Boolean,
  default:false
 },

 completedAt:Date

},{timestamps:true})

const Booking = mongoose.model("Booking",bookingSchema)

/* ================= MIDDLEWARE ================= */

function requireLogin(req,res,next){

 if(!req.session.user)
  return res.redirect("/login.html")

 next()

}

function requireAdmin(req,res,next){

 if(!req.session.user || req.session.user.role !== "admin")
  return res.redirect("/login.html")

 next()

}

/* ================= ADMIN SEED ================= */

async function createAdmin(){

 const admin = await User.findOne({role:"admin"})

 if(!admin){

  const hash = await bcrypt.hash("Admin123",10)

  await User.create({
   username:"admin",
   email:"admin@gmail.com",
   phone:"0000000000",
   password:hash,
   role:"admin"
  })

  console.log("Admin created -> admin / Admin123")

 }

}

createAdmin()

/* ================= AUTH ================= */

app.post("/register",async(req,res)=>{

 const {username,email,phone,password} = req.body

 const hash = await bcrypt.hash(password,10)

 await User.create({
  username,
  email,
  phone,
  password:hash
 })

 res.redirect("/login.html")

})

app.post("/login",async(req,res)=>{

 const {username,password} = req.body

 const user = await User.findOne({username})

 if(!user)
  return res.send("user not found")

 const match = await bcrypt.compare(password,user.password)

 if(!match)
  return res.send("wrong password")

 req.session.user={
  id:user._id,
  username:user.username,
  role:user.role
 }

 if(user.role==="admin")
  return res.redirect("/admin")

 res.redirect("/index.html")

})

app.get("/logout",(req,res)=>{

 req.session.destroy(()=>{
  res.redirect("/login.html")
 })

})

/* ================= API ================= */

/* ---------- SERVICES ---------- */

app.get("/api/services",async(req,res)=>{

 const services = await Service.find()

 res.json(services)

})

/* ---------- SLOTS ---------- */

app.get("/api/slots",async(req,res)=>{

 const slots = await Slot.find({status:"available"})

 res.json(slots)

})

/* ---------- MY BOOKINGS ---------- */

app.get("/api/my-bookings",requireLogin,async(req,res)=>{

 const bookings = await Booking.find({
  user:req.session.user.id,
  completed:false
 })
 .populate("service")
 .populate("slot")

 const result = bookings.map(b=>({

  id:b._id,
  service:b.service?.name,
  price:b.service?.price,
  date:b.slot?.date,
  time:b.slot?.time,
  status:b.status,
  reason:b.reason,
  slip:b.slip

 }))

 res.json(result)

})

/* ================= BOOK ================= */

app.post("/book",requireLogin,upload.single("slip"),async(req,res)=>{

 const {serviceId,slotId} = req.body

 const slot = await Slot.findOne({
 _id:slotId,
 status:"available"
   })

 if(!slot)
  return res.send("slot not found")

 if(slot.status==="booked")
  return res.send("slot already booked")

 let slip = null

 if(req.file){

  slip = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`

 }

 await Booking.create({

  user:req.session.user.id,
  username:req.session.user.username,
  service:serviceId,
  slot:slotId,
  slip

 })

 slot.status = "booked"

 await slot.save()

 res.redirect("/success.html")

})

/* ================= ADMIN ================= */

/* ---------- ADD SERVICE ---------- */

app.post("/admin/add-service",requireAdmin,async(req,res)=>{

 const {name,price,duration} = req.body

 await Service.create({
  name,
  price:Number(price),
  duration:Number(duration)
 })

 res.json({success:true})

})

/* ---------- DELETE SERVICE ---------- */

app.post("/admin/delete-service",requireAdmin,async(req,res)=>{

 await Service.findByIdAndDelete(req.body.id)

 res.json({success:true})

})

/* ---------- UPDATE SERVICE ---------- */

app.post("/admin/update-service",requireAdmin,async(req,res)=>{

 const {id,name,price,duration} = req.body

 await Service.findByIdAndUpdate(id,{
  name,
  price:Number(price),
  duration:Number(duration)
 })

 res.json({success:true})

})

/* ---------- ADD SLOT ---------- */

app.post("/admin/add-slot",requireAdmin,async(req,res)=>{

 const {date,time} = req.body

 const exist = await Slot.findOne({date,time})

 if(exist)
  return res.json({error:"slot already exists"})

 await Slot.create({
  date,
  time
 })

 res.json({success:true})

})

/* ---------- DELETE SLOT ---------- */

app.post("/admin/delete-slot",requireAdmin,async(req,res)=>{

 await Slot.findByIdAndDelete(req.body.id)

 res.json({success:true})

})

/* ---------- ADMIN BOOKINGS ---------- */

app.get("/admin/bookings",requireAdmin,async(req,res)=>{

 const bookings = await Booking.find()
 .populate("service")
 .populate("slot")

 res.json(bookings)

})

/* ---------- APPROVE BOOKING ---------- */

app.post("/admin/approve",requireAdmin,async(req,res)=>{

 const {id} = req.body

 await Booking.findByIdAndUpdate(id,{
  status:"approved"
 })

 res.json({success:true})

})

/* ---------- REJECT BOOKING ---------- */

app.post("/admin/reject",requireAdmin,async(req,res)=>{

 const {id,reason} = req.body

 await Booking.findByIdAndUpdate(id,{
  status:"rejected",
  reason
 })

 res.json({success:true})

})
app.get("/admin",requireAdmin,(req,res)=>{
 res.sendFile(path.join(__dirname,"public/admin.html"))
})

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{
 console.log("Server running on port "+PORT)
})