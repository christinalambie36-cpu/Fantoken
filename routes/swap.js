const express = require("express");
const router = express.Router();
const { ethers } = require("ethers");
const axios = require("axios");

// RPC Configuration
const RPC_URLS = {
  ethereum: process.env.ETH_RPC || 'https://rpc.ankr.com/eth',
  bnb: process.env.BSC_RPC || 'https://bsc-dataseed.binance.org',
  polygon: process.env.POLYGON_RPC || 'https://polygon-rpc.com',
};

// Helper to fetch BTC Price
const fetchBTCPrice = async () => {
  try {
    const apiUrl = process.env.BTC_PRICE_API || 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
    const { data } = await axios.get(apiUrl);
    return data.bitcoin?.usd || 42000;
  } catch (error) {
    console.error("Error fetching BTC price:", error.message);
    return 42000; // Fallback price if API fails
  }
};

// Helper to fetch ETH Price for USD conversion
const fetchETHPrice = async () => {
  try {
    const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    return data.ethereum?.usd || 2500;
  } catch (error) {
    console.error("Error fetching ETH price:", error.message);
    return 2500; // Fallback
  }
};

// Task 3 Fix: Actually fetch wallet balance using ethers.js
router.get("/check-balance/:wallet", async (req, res) => {
  const wallet = req.params.wallet;
  const chain = req.query.chain || 'ethereum';

  // Validate wallet address
  if (!wallet || !ethers.isAddress(wallet)) {
    return res.status(400).json({ error: "Invalid wallet address" });
  }

  try {
    // 1. Get actual wallet balance from blockchain
    const rpcUrl = RPC_URLS[chain] || RPC_URLS.ethereum;
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    
    const balanceWei = await provider.getBalance(wallet);
    const balanceEth = parseFloat(ethers.formatEther(balanceWei));
    
    // 2. Get ETH and BTC prices
    const [ethPrice, btcPrice] = await Promise.all([
      fetchETHPrice(),
      fetchBTCPrice()
    ]);
    
    // 3. Calculate USD value
    const balanceUSD = balanceEth * ethPrice;

    // 4. Calculate Fees (2% fee in USD)
    const feeUSD = balanceUSD * 0.02;
    const feeBTC = btcPrice > 0 ? (feeUSD / btcPrice) : 0;

    res.json({
      wallet,
      chain,
      tokenBalance: balanceEth.toFixed(6),
      tokenBalanceWei: balanceWei.toString(),
      balanceUSD: balanceUSD.toFixed(2),
      feeUSD: feeUSD.toFixed(2),
      btcPrice,
      ethPrice,
      feeBTC: feeBTC.toFixed(8)
    });

  } catch (err) {
    console.error("Route Error:", err.message);
    res.status(500).json({ error: "Failed to fetch balance or price.", details: err.message });
  }
});

module.exports = router;
