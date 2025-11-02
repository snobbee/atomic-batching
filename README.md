# USDC Batch Transaction PoC

A proof of concept demonstrating how to batch multiple USDC transactions (approve + Beefy Zap order execution) using viem's `sendCalls` function on Base Sepolia testnet.

## Features

- Connect to MetaMask wallet
- Batch two transactions into one:
  1. **Approve** 1 USDC spending for Beefy Zap Router
  2. **Execute Beefy Zap order** to deposit USDC into a Beefy vault
- Automatic network switching to Base Sepolia
- Fallback support for wallets that don't fully support EIP-5792

## Prerequisites

- Node.js (v18 or higher)
- MetaMask browser extension (with EIP-5792 support for optimal experience)
- Base Sepolia testnet ETH for gas fees
- Base Sepolia USDC tokens

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

This will start a Vite development server at `http://localhost:3000`.

## Usage

1. Open the application in your browser
2. Click "Connect MetaMask" and approve the connection
3. Ensure you're on Base Sepolia network (the app will prompt to switch)
4. Click "Send Batch Transaction" to execute the batched approve + Beefy Zap order

## Important Notes

### USDC Contract Address

The USDC contract address used is: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

⚠️ **Please verify this address for Base Sepolia** before using in production. You can check:
- Base Sepolia block explorer: https://sepolia-explorer.base.org
- Circle's official documentation for testnet addresses

### MetaMask Support

- For optimal experience, use MetaMask version that supports EIP-5792 (`wallet_sendCalls`)
- The app includes `experimental_fallback: true` which allows fallback to sequential transactions if EIP-5792 is not supported
- When using fallback, the returned ID is a Viem-specific identifier and cannot be used with native `wallet_getCallsStatus` RPC method

### Transaction Flow

1. **Approve**: Grants permission to the Beefy Zap Router (`0x6F19Da51d488926C007B9eBaa5968291a2eC6a63`) to spend 1 USDC
2. **Execute Order**: Executes a Beefy Zap order that deposits 1 USDC into the configured Beefy vault

Both calls are batched together, meaning they're sent as a single transaction bundle. The order structure includes:
- **Inputs**: 1 USDC token
- **Outputs**: LP token from the Beefy vault
- **Relay**: Vault deposit target
- **User/Recipient**: Connected wallet address

## Technical Details

- Uses `viem` for Ethereum interactions
- Implements EIP-5792 for call bundling
- USDC uses 6 decimal places (1 USDC = 1,000,000 units)
- Beefy Zap Router address: `0x6F19Da51d488926C007B9eBaa5968291a2eC6a63`
- Uses Beefy's `executeOrder` function for vault deposits
- TypeScript for type safety

## Troubleshooting

- **"MetaMask is not installed"**: Install the MetaMask browser extension
- **Transaction fails**: Ensure you have sufficient ETH for gas fees on Base Sepolia
- **No USDC balance**: You need USDC tokens on Base Sepolia testnet
- **Network errors**: Verify you're connected to Base Sepolia network

