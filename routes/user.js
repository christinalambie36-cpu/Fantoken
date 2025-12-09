const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

const uploadsDbPath = path.join(__dirname, "../data/uploads.json");

router.get("/:wallet/status", (req, res) => {
  const wallet = req.params.wallet;
  if (!fs.existsSync(uploadsDbPath)) return res.send({});
  const uploads = JSON.parse(fs.readFileSync(uploadsDbPath, "utf8"));
  const userUpload = uploads.find(u => u.wallet === wallet );

  fs.writeFileSync(uploadsDbPath, JSON.stringify(uploads, null, 2));

  res.send({ conversionStatus:  userUpload.status });
});
 
module.exports = router;
