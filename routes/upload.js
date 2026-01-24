const express = require("express");
const router = express.Router();

const multer = require("multer");
const path = require("path");
const fs = require("fs");

const sendTelegramAlert = require("../utils/sendTelegramAlert"); // Telegram alert function
const uploadsDbPath = path.join(__dirname, "../data/uploads.json");

// Setup multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "./uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

router.post("/upload-proof", upload.single("screenshot"), (req, res) => {
  // Validate file upload
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  
  const wallet = req.body.wallet;
  const method = req.body.method;
  
  // Validate required fields
  if (!wallet) {
    return res.status(400).json({ error: "Wallet address is required" });
  }
  
  const filename = req.file.filename;
  const filePath = `${req.protocol}://${req.get("host")}/uploads/${filename}`;

  // Save upload info to uploads.json
  const entry = {
    id: Date.now(), // unique ID
    wallet,
    method: method || 'unknown',
    filePath,
    status: "pending"
  };

  let uploads = [];
  if (fs.existsSync(uploadsDbPath)) {
    try {
      const content = fs.readFileSync(uploadsDbPath, "utf8");
      if (content.trim()) {
        uploads = JSON.parse(content);
      }
    } catch (parseError) {
      console.warn("uploads.json was corrupt, resetting to []");
      uploads = [];
    }
  }
  uploads.push(entry);
  fs.writeFileSync(uploadsDbPath, JSON.stringify(uploads, null, 2));

  // Send Telegram alert
  sendTelegramAlert(wallet, method, filePath);

  console.log("Screenshot uploaded:", filePath);
  res.send({ status: "ok" });
});

module.exports = router;
