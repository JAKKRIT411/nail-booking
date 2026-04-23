# 💅 Nail Booking System

ระบบจองทำเล็บ ทำด้วย Node.js + Express + MongoDB

## การติดตั้ง

### 1. ติดตั้ง dependencies
```bash
npm install
```

### 2. สร้างไฟล์ .env
```bash
cp .env.example .env
```
แก้ค่าใน `.env`:
```
MONGO_URI=mongodb://localhost:27017/nail-booking
SESSION_SECRET=your_secret_key_here
PORT=3000
```

### 3. รันเซิร์ฟเวอร์
```bash
npm start
```

เปิด browser ไปที่ `http://localhost:3000`

## Admin Default
- Username: `admin`
- Password: `Admin123`

## Bug ที่แก้ไขแล้ว

| บัค | ที่อยู่ | วิธีแก้ |
|-----|---------|---------|
| `/admin/revenue` route หายไป | `server.js` | เพิ่ม route ที่คำนวณรายได้จาก approved bookings แยกตาม service |
| `slotId` ไม่ถูก set ตอนโหลดหน้า | `public/js/main.js` | เพิ่มการ set ค่าเริ่มต้นให้ `slotId` หลัง loadSlots() |
| `public/js/admin.js` มีโค้ด Express router เก่า | `public/js/admin.js` | เขียนใหม่ให้เป็น frontend JS ที่ถูกต้อง |
| `admin.html` ใช้ inline script แทน external file | `public/admin.html` | เปลี่ยนเป็น `<script src="/js/admin.js">` |
| Register ไม่มี server-side validation | `server.js` | เพิ่มตรวจสอบ password และ duplicate user/email |
| ไม่มี feedback เมื่อ slot/service ว่าง | `public/js/main.js` | เพิ่ม empty state message |
| ลบการจองแล้ว slot ไม่ refresh | `public/js/main.js` | เพิ่ม `loadSlots()` หลัง `del()` |
