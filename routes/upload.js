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
  const wallet = req.body.wallet;
  const method = req.body.method;
  const filename = req.file.filename;
  const filePath = `${req.protocol}://${req.get("host")}/uploads/${filename}`;

  // Save upload info to uploads.json
  const entry = {
    id: Date.now(), // unique ID
    wallet,
    method,
    filePath,
    status: "pending"
  };

  let uploads = [];
  if (fs.existsSync(uploadsDbPath)) {
    uploads = JSON.parse(fs.readFileSync(uploadsDbPath, "utf8"));
  }
  uploads.push(entry);
  fs.writeFileSync(uploadsDbPath, JSON.stringify(uploads, null, 2));

  // Send Telegram alert
  sendTelegramAlert(wallet, method, filePath);

  console.log("Screenshot uploaded:", filePath);
  res.send({ status: "ok" });
});

module.exports = router;
