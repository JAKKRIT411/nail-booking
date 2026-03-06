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
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.log(err));

/* ================= MODELS ================= */

const userSchema = new mongoose.Schema({
  username:{type:String,unique:true},
  email:{type:String,unique:true},
  phone:String,
  password:String,
  role:{type:String,default:"user"},
  loginAttempts:{type:Number,default:0},
  lockUntil:Number
});

const User = mongoose.model("User",userSchema);

const serviceSchema = new mongoose.Schema({
  name:String,
  price:Number
});

const Service = mongoose.model("Service",serviceSchema);

const slotSchema = new mongoose.Schema({
  date:String,
  time:String,
  status:{type:String,default:"available"}
});

const Slot = mongoose.model("Slot",slotSchema);

const bookingSchema = new mongoose.Schema({
  userId:mongoose.Schema.Types.ObjectId,
  username:String,
  slotId:mongoose.Schema.Types.ObjectId,
  serviceId:mongoose.Schema.Types.ObjectId,
  slip:String,
  status:{type:String,default:"pending"},
  reason:String,
  completed:{type:Boolean,default:false},
  completedAt:Date
});

const Booking = mongoose.model("Booking",bookingSchema);

/* ================= BASIC ================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(express.static(path.join(__dirname,"public")));

app.use(session({
 name:"nail-session",
 secret:"super-secret-production-key",
 resave:false,
 saveUninitialized:false,
 store:MongoStore.create({
   mongoUrl:process.env.MONGO_URI
 }),
 cookie:{
   httpOnly:true,
   maxAge:24*60*60*1000
 }
}));

/* ================= MULTER ================= */

const storage = multer.memoryStorage();
const upload = multer({storage});

/* ================= MIDDLEWARE ================= */

function requireLogin(req,res,next){
 if(!req.session.user) return res.redirect("/login.html");
 next();
}

function requireAdmin(req,res,next){
 if(!req.session.user || req.session.user.role!=="admin")
   return res.redirect("/login.html");
 next();
}

/* ================= ADMIN SEED ================= */

(async()=>{

 const admin = await User.findOne({role:"admin"});

 if(!admin){

   const hash = await bcrypt.hash("Admin123",10);

   await User.create({
     username:"admin",
     email:"admin@gmail.com",
     phone:"0812345678",
     password:hash,
     role:"admin"
   });

   console.log("Admin created: admin / Admin123");

 }

})();

/* ================= AUTH ================= */

app.post("/register",async(req,res)=>{

 const {username,email,phone,password}=req.body;

 const hash = await bcrypt.hash(password,10);

 await User.create({
   username,
   email,
   phone,
   password:hash
 });

 res.redirect("/login.html");

});

app.post("/login",async(req,res)=>{

 const {username,password}=req.body;

 const user = await User.findOne({username});

 if(!user) return res.send("ไม่พบผู้ใช้");

 const match = await bcrypt.compare(password,user.password);

 if(!match) return res.send("รหัสผ่านผิด");

 req.session.user={
   id:user._id,
   username:user.username,
   role:user.role
 };

 if(user.role==="admin")
   return res.redirect("/admin.html");

 res.redirect("/index.html");

});

app.get("/logout",(req,res)=>{
 req.session.destroy(()=>{
   res.redirect("/login.html");
 });
});

/* ================= USER API ================= */

app.get("/api/services",async(req,res)=>{

 const services = await Service.find();

 res.json(services);

});

app.get("/api/slots",async(req,res)=>{

 const slots = await Slot.find({status:"available"});

 res.json(slots);

});

app.post("/book",requireLogin,upload.single("slip"),async(req,res)=>{

 const {slotId,serviceId}=req.body;

 const slot = await Slot.findById(slotId);

 if(!slot) return res.send("ไม่พบคิว");

 if(slot.status==="booked")
   return res.send("คิวถูกจองแล้ว");

 let slip=null;

 if(req.file){

   slip=`data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

 }

 const booking = await Booking.create({

   userId:req.session.user.id,
   username:req.session.user.username,
   slotId,
   serviceId,
   slip

 });

 slot.status="booked";
 await slot.save();

 res.redirect("/success.html");

});

app.get("/api/my-bookings",requireLogin,async(req,res)=>{

 const bookings = await Booking.find({
   userId:req.session.user.id,
   completed:false
 }).populate("slotId").populate("serviceId");

 const result = bookings.map(b=>({

   id:b._id,
   date:b.slotId?.date,
   time:b.slotId?.time,
   serviceName:b.serviceId?.name,
   price:b.serviceId?.price,
   status:b.status,
   reason:b.reason,
   slip:b.slip

 }));

 res.json(result);

});

/* ================= ADMIN ================= */

app.get("/admin/bookings",requireAdmin,async(req,res)=>{

 const bookings = await Booking.find()
 .populate("slotId")
 .populate("serviceId");

 res.json(bookings);

});

/* ---------- ADD SLOT ---------- */

app.post("/admin/add-slot",requireAdmin,async(req,res)=>{

 const {date,time}=req.body;

 const exists = await Slot.findOne({date,time});

 if(exists)
   return res.json({error:"slot ซ้ำ"});

 await Slot.create({
   date,
   time
 });

 res.json({success:true});

});

/* ---------- DELETE SLOT ---------- */

app.post("/admin/delete-slot",requireAdmin,async(req,res)=>{

 await Slot.findByIdAndDelete(req.body.id);

 res.json({success:true});

});

/* ---------- ADD SERVICE ---------- */

app.post("/admin/add-service",requireAdmin,async(req,res)=>{

 const {name,price}=req.body;

 await Service.create({
   name,
   price:Number(price)
 });

 res.json({success:true});

});

/* ---------- UPDATE SERVICE ---------- */

app.post("/admin/update-service",requireAdmin,async(req,res)=>{

 const {id,name,price}=req.body;

 await Service.findByIdAndUpdate(id,{
   name,
   price:Number(price)
 });

 res.json({success:true});

});

/* ---------- DELETE SERVICE ---------- */

app.post("/admin/delete-service",requireAdmin,async(req,res)=>{

 await Service.findByIdAndDelete(req.body.id);

 res.json({success:true});

});

/* ================= START ================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT,()=>{
 console.log("Server running on port "+PORT);
});