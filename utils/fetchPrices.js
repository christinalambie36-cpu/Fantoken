const axios = require("axios");

const fetchBTCPrice = async () => {
  try {
  const url = process.env.BTC_PRICE_API;
  const res = await axios.get(url);
  return res.data.bitcoin.usd;

}   catch (err) {
  console.log(err)
    return 88998
  }
};

module.exports = fetchBTCPrice;
