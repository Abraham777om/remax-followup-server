const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  res.send("REMAX Followup Server Running");
});

module.exports = router;
