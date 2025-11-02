import { createWalletClient, custom, parseUnits, parseAbi, type Address } from 'viem';
import { baseSepolia } from 'viem/chains'

// USDC Contract Address on Base Sepolia
// Note: You may need to verify this address for Base Sepolia
// Common testnet USDC addresses - verify before using in production
const USDC_ADDRESS: Address = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // Base Sepolia USDC (verify this)

// USDC has 6 decimals
const USDC_DECIMALS = 6;
const AMOUNT = parseUnits('1', USDC_DECIMALS); // 1 USDC

// USDC ABI for approve and transfer functions
const usdcAbi = parseAbi([
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function transfer(address recipient, uint256 amount) external returns (bool)',
]);

export const BEEFY_ZAP_ABI = [
    // executeOrder - The function that actually works!
    {
        name: 'executeOrder',
        inputs: [
            {
                name: 'order',
                type: 'tuple',
                components: [
                    {
                        name: 'inputs',
                        type: 'tuple[]',
                        components: [
                            { name: 'token', type: 'address' },
                            { name: 'amount', type: 'uint256' }
                        ]
                    },
                    {
                        name: 'outputs',
                        type: 'tuple[]',
                        components: [
                            { name: 'token', type: 'address' },
                            { name: 'minOutputAmount', type: 'uint256' }
                        ]
                    },
                    {
                        name: 'relay',
                        type: 'tuple',
                        components: [
                            { name: 'target', type: 'address' },
                            { name: 'value', type: 'uint256' },
                            { name: 'data', type: 'bytes' }
                        ]
                    },
                    { name: 'user', type: 'address' },
                    { name: 'recipient', type: 'address' }
                ]
            }
        ],
        outputs: [],
        stateMutability: 'payable',
        type: 'function'
    },
    // Legacy beefIn for fallback
    {
        name: 'beefIn',
        inputs: [
            { name: 'beefyVault', type: 'address' },
            { name: 'tokenAmountOutMin', type: 'uint256' },
            { name: 'tokenIn', type: 'address' },
            { name: 'tokenInAmount', type: 'uint256' }
        ],
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function'
    }
] as const

export const BEEFY_ZAP_ROUTER = '0x6F19Da51d488926C007B9eBaa5968291a2eC6a63' as const

// Check if MetaMask is installed
function checkMetaMask(): boolean {
    if (typeof window.ethereum === 'undefined') {
        showStatus('MetaMask is not installed. Please install MetaMask to use this app.', 'error');
        return false;
    }
    return true;
}

// Create wallet client
let walletClient = createWalletClient({
    chain: baseSepolia,
    transport: custom(window.ethereum!),
});

// UI Elements
const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
const sendBatchBtn = document.getElementById('sendBatchBtn') as HTMLButtonElement;
const accountInfo = document.getElementById('accountInfo') as HTMLDivElement;
const accountAddress = document.getElementById('accountAddress') as HTMLSpanElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

let connectedAddress: Address | null = null;

// Connect to MetaMask
connectBtn.addEventListener('click', async () => {
    if (!checkMetaMask()) return;

    try {
        showStatus('Connecting to MetaMask...', 'info');

        // Request account access
        const accounts = await window.ethereum.request({
            method: 'eth_requestAccounts',
        });

        if (accounts.length === 0) {
            showStatus('No accounts found. Please unlock MetaMask.', 'error');
            return;
        }

        connectedAddress = accounts[0] as Address;
        accountAddress.textContent = connectedAddress;
        accountInfo.style.display = 'block';
        connectBtn.disabled = true;
        sendBatchBtn.disabled = false;

        // Switch to Base Sepolia if not already
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x14a34' }], // Base Sepolia chainId
            });
        } catch (switchError: any) {
            // If chain doesn't exist, try to add it
            if (switchError.code === 4902) {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [
                        {
                            chainId: '0x14a34',
                            chainName: 'Base Sepolia',
                            nativeCurrency: {
                                name: 'ETH',
                                symbol: 'ETH',
                                decimals: 18,
                            },
                            rpcUrls: ['https://sepolia.base.org'],
                            blockExplorerUrls: ['https://sepolia-explorer.base.org'],
                        },
                    ],
                });
            }
        }

        showStatus(`Connected: ${connectedAddress}`, 'success');
    } catch (error: any) {
        showStatus(`Connection error: ${error.message}`, 'error');
    }
});

// Send batch transaction
sendBatchBtn.addEventListener('click', async () => {
    if (!connectedAddress) {
        showStatus('Please connect your wallet first.', 'error');
        return;
    }

    if (!checkMetaMask()) return;

    try {
        sendBatchBtn.disabled = true;
        showStatus('Preparing batch transaction...', 'info');

        const vaultAddress = "0x09139a80454609b69700836a9ee12db4b5dbb15f";

        // Build order structure (same as Beefy Zap integration)
        const order = {
            inputs: [
                {
                    token: USDC_ADDRESS,
                    amount: AMOUNT
                }
            ],
            outputs: [
                {
                    token: USDC_ADDRESS, // LP token address
                    minOutputAmount: 0 // Accept any output (same as regular Beefy Zap)
                }
            ],
            relay: {
                target: vaultAddress,
                value: 0,
                data: '0x'
            },
            user: connectedAddress,
            recipient: connectedAddress
        }

        // Prepare the batch calls
        const calls = [
            {
                to: USDC_ADDRESS,
                abi: usdcAbi,
                functionName: 'approve' as const,
                args: [BEEFY_ZAP_ROUTER, AMOUNT],
            },
            {
                to: BEEFY_ZAP_ROUTER as `0x${string}`,
                abi: BEEFY_ZAP_ABI,
                functionName: 'executeOrder',
                args: [order as any] // Complex type, cast to any for now
            }
        ];

        showStatus('Requesting wallet approval...', 'info');

        // Send the batch transaction
        const result = await walletClient.sendCalls({
            account: connectedAddress,
            calls,
            // Enable fallback for wallets that don't support EIP-5792
            experimental_fallback: true,
        });

        showStatus(
            `✅ Batch transaction submitted! ID: ${result.id}\n\n` +
            `The transaction batches:\n` +
            `1. Approve 1 USDC spending for Beefy Zap Router\n` +
            `2. Execute Beefy Zap order\n\n` +
            `Check the transaction status using the ID above.`,
            'success'
        );

        sendBatchBtn.disabled = false;
    } catch (error: any) {
        console.error('Batch transaction error:', error);
        showStatus(
            `❌ Transaction failed: ${error.message || 'Unknown error'}`,
            'error'
        );
        sendBatchBtn.disabled = false;
    }
});

// Helper function to show status messages
function showStatus(message: string, type: 'success' | 'error' | 'info') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
}

// Check MetaMask on load
if (typeof window.ethereum !== 'undefined') {
    // Check if already connected
    window.ethereum
        .request({ method: 'eth_accounts' })
        .then((accounts: string[]) => {
            if (accounts.length > 0) {
                connectedAddress = accounts[0] as Address;
                accountAddress.textContent = connectedAddress;
                accountInfo.style.display = 'block';
                connectBtn.disabled = true;
                sendBatchBtn.disabled = false;
            }
        })
        .catch(console.error);

    // Listen for account changes
    window.ethereum.on('accountsChanged', (accounts: string[]) => {
        if (accounts.length === 0) {
            connectedAddress = null;
            accountInfo.style.display = 'none';
            connectBtn.disabled = false;
            sendBatchBtn.disabled = true;
            showStatus('Wallet disconnected', 'info');
        } else {
            connectedAddress = accounts[0] as Address;
            accountAddress.textContent = connectedAddress;
        }
    });

    // Listen for chain changes
    window.ethereum.on('chainChanged', () => {
        window.location.reload();
    });
}

// Extend Window interface for TypeScript
declare global {
    interface Window {
        ethereum?: {
            request: (args: { method: string; params?: any[] }) => Promise<any>;
            on: (event: string, callback: (...args: any[]) => void) => void;
            removeListener: (event: string, callback: (...args: any[]) => void) => void;
        };
    }
}

