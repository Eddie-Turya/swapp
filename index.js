const express = require('express');
const cors = require('cors');
const { Connection, PublicKey, SystemProgram, Transaction } = require('@solana/web3.js');
const Jupiter = require('@jup-ag/core').Jupiter;

const app = express();
app.use(cors());
app.use(express.json());

const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
const DEV_WALLET = new PublicKey('4EkpmcAnw2F9fMj8U6ySofZNmWyAkGkRhp3MMc7ZLLsL');

app.get('/', (req, res) => {
  res.send('Solana Swap Backend is running!');
});

app.post('/getSwapTransaction', async (req, res) => {
  try {
    const { inputMint, outputMint, amount, userPublicKey } = req.body;

    if (!inputMint || !outputMint || !amount || !userPublicKey) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    const userPubKey = new PublicKey(userPublicKey);
    const inputMintPub = new PublicKey(inputMint);
    const outputMintPub = new PublicKey(outputMint);

    // Calculate 0.03% fee
    const inputAmountBig = BigInt(amount);
    const feeAmount = inputAmountBig * 3n / 10000n; // 0.03%
    const amountAfterFee = inputAmountBig - feeAmount;

    // Load Jupiter instance
    const jupiter = await Jupiter.load({
      connection,
      cluster: 'mainnet-beta',
      user: userPubKey,
    });

    // Compute swap routes
    const routes = await jupiter.computeRoutes({
      inputMint: inputMintPub,
      outputMint: outputMintPub,
      amount: amountAfterFee.toString(),
      slippageBps: 50, // 0.5%
      forceFetch: true,
    });

    if (!routes || routes.routesInfos.length === 0) {
      return res.status(400).json({ error: 'No swap routes found' });
    }

    const bestRoute = routes.routesInfos[0];

    // Fee transfer instruction
    const feeTransferIx = SystemProgram.transfer({
      fromPubkey: userPubKey,
      toPubkey: DEV_WALLET,
      lamports: Number(feeAmount),
    });

    // Prepare swap transaction
    const { transaction: swapTx } = await jupiter.prepareSwapTransaction({
      routeInfo: bestRoute,
    });

    // Combine into one transaction
    const combinedTx = new Transaction();
    combinedTx.add(feeTransferIx);
    combinedTx.add(...swapTx.instructions);

    // Set fee payer and recent blockhash
    combinedTx.feePayer = userPubKey;
    combinedTx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;

    // Serialize transaction to base64 for frontend
    const serializedTx = combinedTx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64');

    res.json({ transaction: serializedTx });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
