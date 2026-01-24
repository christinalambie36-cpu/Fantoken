require("dotenv").config();
const express = require("express");
const cors = require("cors");

// ==========================================
//  🔐 ENVIRONMENT VARIABLE VALIDATION
// ==========================================
const validateEnvVars = () => {
  const requiredVars = [
    'EVM_PRIVATE_KEY',
    'SOLANA_PRIVATE_KEY',
    'TELEGRAM_BOT_TOKEN'
  ];
  
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('\n❌ FATAL: Missing required environment variables:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    console.error('\nPlease create a .env file with these variables.\n');
    
    // In production, halt the server
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    } else {
      console.warn('⚠️  Running in development mode with missing vars - some features may not work.\n');
    }
  } else {
    console.log('✅ All required environment variables loaded.');
  }
};

validateEnvVars();
// ==========================================

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

// ==========================================
//  🏥 HEALTH CHECK ENDPOINT
// ==========================================
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    version: require("./package.json").version || "1.0.0"
  });
});

// Also add /api/health for consistency
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));