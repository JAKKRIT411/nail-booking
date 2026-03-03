import mongoose from "mongoose";

const slotSchema = new mongoose.Schema({
  date: String,
  time: String,
  status: { type: String, default: "available" }
});

export default mongoose.model("Slot", slotSchema);