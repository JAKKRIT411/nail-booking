import express from "express";
import { db } from "../server.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

/* ===== เพิ่มบริการ ===== */
router.post("/add-service", requireAdmin, async (req, res) => {
  await db.read();

  db.data.services.push({
    id: Date.now(),
    name: req.body.name,
    price: Number(req.body.price)
  });

  await db.write();
  res.redirect("/admin.html");
});

/* ===== สร้างคิว ===== */
router.post("/add-slot", requireAdmin, async (req, res) => {
  await db.read();

  db.data.slots.push({
    id: Date.now(),
    date: req.body.date,
    time: req.body.time,
    status: "available"
  });

  await db.write();
  res.redirect("/admin.html");
});

/* ===== ดึง slots ===== */
router.get("/slots", requireAdmin, async (req, res) => {
  await db.read();
  res.json(db.data.slots);
});

export default router;