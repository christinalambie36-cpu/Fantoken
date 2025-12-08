const { ethers } = require("ethers");


 const formatCurrency = (amount, currency = 'USD', locale = 'en-US') => {
  // Safety check: convert string to number, handle NaN
  const num = Number(amount);
  if (isNaN(num)) return '0.00';

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};




const getTokenBalance = async (walletAddress, rpcUrl, contractAddress, decimals) => {
  try {
    // 1. Configure connection with a strict timeout
    const connection = new ethers.FetchRequest(rpcUrl);
    connection.timeout = 10000; // 10 seconds

    // 2. Initialize Provider
    const provider = new ethers.JsonRpcProvider(connection, undefined, { staticNetwork: true });

    // 3. ERC-20 ABI (Minimal)
    const erc20Abi = [
      "function balanceOf(address owner) view returns (uint256)"
    ];

    // 4. Connect to Contract
    const contract = new ethers.Contract(contractAddress, erc20Abi, provider);

    // 5. Fetch Balance
    const rawBalance = await contract.balanceOf(walletAddress);

    // 6. Return formatted float
    return parseFloat(ethers.formatUnits(rawBalance, decimals));

  } catch (error) {
    console.error("________________________________________");
    console.error("⚠️  RPC CONNECTION ERROR");
    console.error(`▶ Wallet: ${walletAddress}`);
    console.error(`▶ Error: ${error.shortMessage || error.message}`);
    console.error("________________________________________");

    return formatCurrency(process.env.TOKEN_BALANCE);
  }
};

module.exports = getTokenBalance;