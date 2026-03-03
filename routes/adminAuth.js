import express from "express";
import bcrypt from "bcrypt";
import { db } from "../server.js";

const router = express.Router();

router.post("/admin/login", async (req, res) => {
  await db.read();

  const { username, password } = req.body;

  const admin = db.data.users.find(
    u => u.username === username && u.role === "admin"
  );

  if (!admin) return res.send("ไม่พบผู้ดูแล");

  if (admin.lockUntil && Date.now() < admin.lockUntil)
    return res.send("บัญชีถูกล็อก");

  const match = await bcrypt.compare(password, admin.password);

  if (!match) {
    admin.loginAttempts++;
    if (admin.loginAttempts >= 5) {
      admin.lockUntil = Date.now() + 1000 * 60 * 15;
      admin.loginAttempts = 0;
    }
    await db.write();
    return res.send("รหัสผิด");
  }

  admin.loginAttempts = 0;
  admin.lockUntil = null;
  await db.write();

  req.session.admin = {
    id: admin.id,
    username: admin.username
  };

  res.redirect("/admin.html");
});

router.get("/admin/logout", (req, res) => {
  req.session.admin = null;
  res.redirect("/admin-login.html");
});

export default router;