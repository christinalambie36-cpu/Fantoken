const TelegramBot = require("node-telegram-bot-api");
const dotenv = require("dotenv");
dotenv.config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

const sendTelegramAlert = (wallet, method, filePath) => {
  const message = `
🚨 New Screenshot Uploaded
👛 Wallet: ${wallet}
💰 Method: ${method.toUpperCase()}
🖼️ Screenshot: ${filePath}
`;

  bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
};

module.exports = sendTelegramAlert;
