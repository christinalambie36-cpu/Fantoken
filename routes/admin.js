const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const uploadsDbPath = path.join(__dirname, "../data/uploads.json");

// Get all uploads
router.get("/uploads", (req, res) => {
  const uploads = JSON.parse(fs.readFileSync(uploadsDbPath, "utf8"));
  res.json(uploads);
});

// Update status
router.post("/uploads/:id/status", (req, res) => {
  const { status } = req.body;
  const id = parseInt(req.params.id);

  let uploads = JSON.parse(fs.readFileSync(uploadsDbPath, "utf8"));
  const index = uploads.findIndex(u => u.id === id);
  if (index === -1) return res.status(404).json({ error: "Not found" });

  const entry = uploads[index];
  entry.status = status;

  // If marked as 'received', also set conversionStatus
  if (status === "received") {
    entry.conversionStatus = "in_progress";
  }

  fs.writeFileSync(uploadsDbPath, JSON.stringify(uploads, null, 2));
  res.json({ success: true });
});

module.exports = router;
