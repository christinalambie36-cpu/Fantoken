const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

const uploadsDbPath = path.join(__dirname, "../data/uploads.json");

router.get("/:wallet/status", (req, res) => {
  const wallet = req.params.wallet;
  if (!fs.existsSync(uploadsDbPath)) return res.send({});
  const uploads = JSON.parse(fs.readFileSync(uploadsDbPath, "utf8"));
  const userUpload = uploads.find(u => u.wallet === wallet && u.status === "received");

  if (!userUpload) return res.send({});

  // Simulate 1-minute wait
  const delay = 1 * 60 * 1000;
  const now = Date.now();
  const conversionStart =  userUpload.id || now;

  userUpload.conversionStart = conversionStart;

  let conversionStatus = "in_progress";
  if (now - conversionStart > delay) {
    conversionStatus = "delayed";
  }

  userUpload.conversionStatus = conversionStatus;
  fs.writeFileSync(uploadsDbPath, JSON.stringify(uploads, null, 2));

  res.send({ conversionStatus });
});

module.exports = router;
