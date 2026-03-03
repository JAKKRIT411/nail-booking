import express from "express";
import { db } from "../server.js";
import { upload } from "../middleware/upload.js";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();

/* ===== ดึง slot ที่ว่าง ===== */
router.get("/available-slots", async (req, res) => {
  await db.read();

  const available = db.data.slots.filter(s => s.status === "available");
  res.json(available);
});

/* ===== จอง slot ===== */
router.post("/book", requireLogin, upload.single("slip"), async (req, res) => {
  await db.read();

  const slotId = Number(req.body.slotId);
  const serviceId = Number(req.body.serviceId);

  const slot = db.data.slots.find(
    s => s.id === slotId
  );

  if (!slot || slot.status !== "available") {
    return res.send("คิวนี้ไม่ว่างแล้ว");
  }

  const serviceData = db.data.services.find(
    s => s.id === serviceId
  );

  if (!serviceData) {
    return res.send("ไม่พบบริการ");
  }

  db.data.bookings.push({
    id: Date.now(),
    user: req.session.user.username,
    serviceId: serviceData.id,
    serviceName: serviceData.name,
    price: serviceData.price,
    date: slot.date,
    time: slot.time,
    slip: req.file ? "/uploads/" + req.file.filename : null,
    status: "pending"
  });

  // 🔥 ทำให้ slot ถูกจองทันที
  slot.status = "booked";

  await db.write();
  res.redirect("/success.html");
});
export default router;