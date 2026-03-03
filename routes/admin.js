import express from "express";
import { db } from "../server.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

router.get("/revenue", requireAdmin, async (req, res) => {
  await db.read();
  const total = db.data.bookings.reduce((sum, b) => sum + b.price, 0);
  res.json({ total });
});

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

router.post("/add-time", requireAdmin, async (req, res) => {
  await db.read();
  db.data.times.push({
    id: Date.now(),
    time: req.body.time
  });
  await db.write();
  res.redirect("/admin.html");
});

export default router;