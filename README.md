# 💅 LUMI NAILS — Booking System v2

ระบบจองร้านทำเล็บ พร้อมใช้งานจริง

## ฟีเจอร์
- **ระบบจองคิว** — เลือกบริการ เลือกวัน เลือกเวลา พร้อม Queue Number
- **ระบบกระเป๋าเงิน (Wallet)** — เติมเงินผ่านสลิป จ่ายด้วย wallet ได้เลย
- **ระบบตรวจสลิป** — แอดมินเห็นสลิปชัด approve/reject ได้ทันที
- **Admin Dashboard** — Stats, Revenue Chart, จัดการคิว bulk, ดูผู้ใช้
- **Rate Limiting** — ป้องกัน brute force และ spam
- **MongoDB Transaction** — จองคิวปลอดภัย ไม่ชนกัน
- **Auto-reconnect DB** — server ไม่ตายถ้า MongoDB หลุด

## วิธี Deploy บน Render + MongoDB Atlas

### 1. MongoDB Atlas
1. cloud.mongodb.com → Create Cluster (Free M0)
2. Database Access → Add User (จำ user/pass)
3. Network Access → 0.0.0.0/0
4. Connect → Drivers → Copy connection string

### 2. Render
1. render.com → New Web Service → เชื่อม GitHub
2. Build: `npm install` | Start: `npm start`
3. Environment Variables:

```
MONGO_URI    = mongodb+srv://user:pass@cluster.mongodb.net/nail-booking
SESSION_SECRET = ใส่ random string ยาวๆ อย่างน้อย 32 ตัว
NODE_ENV     = production
PORT         = 3000
```

## Default Admin
- Username: `admin`
- Password: `Admin123`
- **เปลี่ยน password หลัง deploy ด้วย!**

## โครงสร้างไฟล์
```
server.js          — Backend (Express + Mongoose)
public/
  index.html       — หน้าผู้ใช้ (จอง, กระเป๋าเงิน, บัญชี)
  admin.html       — Admin Dashboard
  login.html       — เข้าสู่ระบบ
  register.html    — สมัครสมาชิก
uploads/           — สลิปที่อัปโหลด
```
