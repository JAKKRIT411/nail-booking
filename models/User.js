import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  role: { type: String, default: "user" },
  phone: String,
  email: String,
  loginAttempts: { type: Number, default: 0 },
  lockUntil: Number
});

export default mongoose.model("User", userSchema);
