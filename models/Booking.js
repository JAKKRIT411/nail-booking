import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service" },
  slotId: { type: mongoose.Schema.Types.ObjectId, ref: "Slot" },
  slip: String,
  status: { type: String, default: "pending" },
  reason: String,
  completed: { type: Boolean, default: false }
});

export default mongoose.model("Booking", bookingSchema);