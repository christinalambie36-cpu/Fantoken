require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();

// Import Routes
const swapRoutes = require("./routes/swap");
const uploadRoutes = require("./routes/upload");
const adminRoutes = require("./routes/admin");
const userRoutes = require("./routes/user");

app.use(cors());
app.use(express.json());

// ==========================================
//  👇 CUSTOM REQUEST LOGGER MIDDLEWARE 👇
// ==========================================
app.use((req, res, next) => {
  // Capture the start time
  const start = Date.now();

  // Listen for the response to finish (sent to client)
  res.on("finish", () => {
    const duration = Date.now() - start;
    
    // Log format: [Time] Method URL Status - Duration
    console.log(
      `[${new Date().toLocaleTimeString()}] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`
    );
  });

  // Move to the next middleware/route
  next();
});
// ==========================================

// Register Routes
app.use("/api", swapRoutes);
app.use("/api", uploadRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/user", userRoutes);

// Static files
app.use("/uploads", express.static("uploads"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));