const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

const uploadsDbPath = path.join(__dirname, "../data/uploads.json");

router.get("/:wallet/status", (req, res) => {
  const wallet = req.params.wallet;
  
  // Validate wallet parameter
  if (!wallet) {
    return res.status(400).json({ error: "Wallet address required", conversionStatus: null });
  }
  
  if (!fs.existsSync(uploadsDbPath)) {
    return res.status(404).json({ error: "No uploads found", conversionStatus: null });
  }
  
  try {
    const uploads = JSON.parse(fs.readFileSync(uploadsDbPath, "utf8"));
    const userUpload = uploads.find(u => u.wallet === wallet);

    // Task 1 Fix: Check if user exists before accessing properties
    if (!userUpload) {
      return res.status(404).json({ error: "User not found", conversionStatus: null });
    }

    res.json({ conversionStatus: userUpload.status });
  } catch (error) {
    console.error("Error reading uploads:", error.message);
    res.status(500).json({ error: "Internal server error", conversionStatus: null });
  }
});
 
module.exports = router;
