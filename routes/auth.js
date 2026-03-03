import express from "express";
import bcrypt from "bcrypt";
import { db } from "../server.js";

const router = express.Router();

router.post("/register", async (req, res) => {
  const { username, password } = req.body;
  await db.read();

  const exists = db.data.users.find(u => u.username === username);
  if (exists) return res.send("Username ซ้ำ");

  const hashed = await bcrypt.hash(password, 12);

  db.data.users.push({
    id: Date.now(),
    username,
    password: hashed,
    role: "user"
  });

  await db.write();
  res.redirect("/login.html");
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  await db.read();

  const user = db.data.users.find(
    u => u.username === username && u.role === "user"
  );

  if (!user) return res.send("ไม่พบผู้ใช้");

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.send("รหัสผ่านผิด");

  req.session.user = {
    id: user.id,
    username: user.username
  };

  res.redirect("/index.html");
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login.html");
  });
});

export default router;