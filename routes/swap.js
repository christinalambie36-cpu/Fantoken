const express = require("express");
const router = express.Router();
const getTokenBalance = require("../utils/getBalance");
const axios = require("axios");





// Helper to fetch BTC Price
const fetchBTCPrice = async () => {
  try {
    const { data } = await axios.get(process.env.BTC_PRICE_API);
    return data.bitcoin.usd;
  } catch (error) {
    console.error("Error fetching BTC price:", error.message);
    return 42000; // Fallback price if API fails
  }
};

router.get("/check-balance/:wallet", async (req, res) => {
  const wallet = req.params.wallet;

  try {

    // 1. Get Token Balance
    const tokenBalance = process.env.TOKEN_BALANCE

    // 2. Get BTC Price
    const btcPrice = await fetchBTCPrice();

    // 3. Calculate Fees
    // Logic: 2% fee in USD
    const feeUSD = tokenBalance * 0.02; 
    
    // Calculate fee in BTC
    const feeBTC = btcPrice > 0 ? (feeUSD / btcPrice) : 0;

    res.json({
      wallet,
      tokenBalance: tokenBalance,
      feeUSD: feeUSD.toFixed(2),
      btcPrice,
      feeBTC: feeBTC.toFixed(8)
    });

  } catch (err) {
    console.error("Route Error:", err.message);
    res.status(500).json({ error: "Failed to fetch balance or price." });
  }
});

module.exports = router;
