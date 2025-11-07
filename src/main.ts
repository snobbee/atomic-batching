import { createWalletClient, createPublicClient, custom, http, parseAbi, type Address, encodeFunctionData, parseUnits } from 'viem';
import { baseSepolia, base } from 'viem/chains'
import { Contract, BrowserProvider } from "ethers"

const MAINNET = true;

// USDC ABI for approve and transfer functions
const USDC_ABI = parseAbi([
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function transfer(address recipient, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
]);

// Full ABI for Beefy Zap Router (kept for reference)
// Note: We use BEEFY_ZAP_EXECUTE_ORDER_ABI below to ensure consistent function signature selection
const BEEFY_ZAP_ABI = [
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_permit2",
                "type": "address"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "target",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "value",
                "type": "uint256"
            },
            {
                "internalType": "bytes",
                "name": "callData",
                "type": "bytes"
            }
        ],
        "name": "CallFailed",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "caller",
                "type": "address"
            }
        ],
        "name": "CallerNotZap",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "recipient",
                "type": "address"
            }
        ],
        "name": "EtherTransferFailed",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "balance",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "relayValue",
                "type": "uint256"
            }
        ],
        "name": "InsufficientRelayValue",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "owner",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "caller",
                "type": "address"
            }
        ],
        "name": "InvalidCaller",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "minAmountOut",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "balance",
                "type": "uint256"
            }
        ],
        "name": "Slippage",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "target",
                "type": "address"
            }
        ],
        "name": "TargetingInvalidContract",
        "type": "error"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "components": [
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "amount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Input[]",
                        "name": "inputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "minOutputAmount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Output[]",
                        "name": "outputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "target",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "value",
                                "type": "uint256"
                            },
                            {
                                "internalType": "bytes",
                                "name": "data",
                                "type": "bytes"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Relay",
                        "name": "relay",
                        "type": "tuple"
                    },
                    {
                        "internalType": "address",
                        "name": "user",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "recipient",
                        "type": "address"
                    }
                ],
                "indexed": true,
                "internalType": "struct IBeefyZapRouter.Order",
                "name": "order",
                "type": "tuple"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "caller",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "recipient",
                "type": "address"
            }
        ],
        "name": "FulfilledOrder",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "previousOwner",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "newOwner",
                "type": "address"
            }
        ],
        "name": "OwnershipTransferred",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "Paused",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "target",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "value",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "bytes",
                "name": "data",
                "type": "bytes"
            }
        ],
        "name": "RelayData",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            }
        ],
        "name": "TokenReturned",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "Unpaused",
        "type": "event"
    },
    {
        "inputs": [
            {
                "components": [
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "amount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IPermit2.TokenPermissions[]",
                        "name": "permitted",
                        "type": "tuple[]"
                    },
                    {
                        "internalType": "uint256",
                        "name": "nonce",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "deadline",
                        "type": "uint256"
                    }
                ],
                "internalType": "struct IPermit2.PermitBatchTransferFrom",
                "name": "_permit",
                "type": "tuple"
            },
            {
                "components": [
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "amount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Input[]",
                        "name": "inputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "minOutputAmount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Output[]",
                        "name": "outputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "target",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "value",
                                "type": "uint256"
                            },
                            {
                                "internalType": "bytes",
                                "name": "data",
                                "type": "bytes"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Relay",
                        "name": "relay",
                        "type": "tuple"
                    },
                    {
                        "internalType": "address",
                        "name": "user",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "recipient",
                        "type": "address"
                    }
                ],
                "internalType": "struct IBeefyZapRouter.Order",
                "name": "_order",
                "type": "tuple"
            },
            {
                "internalType": "bytes",
                "name": "_signature",
                "type": "bytes"
            },
            {
                "components": [
                    {
                        "internalType": "address",
                        "name": "target",
                        "type": "address"
                    },
                    {
                        "internalType": "uint256",
                        "name": "value",
                        "type": "uint256"
                    },
                    {
                        "internalType": "bytes",
                        "name": "data",
                        "type": "bytes"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "int32",
                                "name": "index",
                                "type": "int32"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.StepToken[]",
                        "name": "tokens",
                        "type": "tuple[]"
                    }
                ],
                "internalType": "struct IBeefyZapRouter.Step[]",
                "name": "_route",
                "type": "tuple[]"
            }
        ],
        "name": "executeOrder",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "components": [
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "amount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Input[]",
                        "name": "inputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "minOutputAmount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Output[]",
                        "name": "outputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "target",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "value",
                                "type": "uint256"
                            },
                            {
                                "internalType": "bytes",
                                "name": "data",
                                "type": "bytes"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Relay",
                        "name": "relay",
                        "type": "tuple"
                    },
                    {
                        "internalType": "address",
                        "name": "user",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "recipient",
                        "type": "address"
                    }
                ],
                "internalType": "struct IBeefyZapRouter.Order",
                "name": "_order",
                "type": "tuple"
            },
            {
                "components": [
                    {
                        "internalType": "address",
                        "name": "target",
                        "type": "address"
                    },
                    {
                        "internalType": "uint256",
                        "name": "value",
                        "type": "uint256"
                    },
                    {
                        "internalType": "bytes",
                        "name": "data",
                        "type": "bytes"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "int32",
                                "name": "index",
                                "type": "int32"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.StepToken[]",
                        "name": "tokens",
                        "type": "tuple[]"
                    }
                ],
                "internalType": "struct IBeefyZapRouter.Step[]",
                "name": "_route",
                "type": "tuple[]"
            }
        ],
        "name": "executeOrder",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "owner",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "pause",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "paused",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "permit2",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "renounceOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "tokenManager",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "newOwner",
                "type": "address"
            }
        ],
        "name": "transferOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "unpause",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "stateMutability": "payable",
        "type": "receive"
    }
]

const AERODROME_ROUTER_ABI = parseAbi([
    'function addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)',
    'function removeLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)',
    'function poolFor(address tokenA, address tokenB, bool stable, address factory) view returns (address)',
    'function defaultFactory() view returns (address)',
])

// Filtered ABI with only the payable executeOrder function (no Permit2)
// This ensures simulateContract and writeContract use the same function signature
const BEEFY_ZAP_EXECUTE_ORDER_ABI = [
    {
        "inputs": [
            {
                "components": [
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "amount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Input[]",
                        "name": "inputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "minOutputAmount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Output[]",
                        "name": "outputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "target",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "value",
                                "type": "uint256"
                            },
                            {
                                "internalType": "bytes",
                                "name": "data",
                                "type": "bytes"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Relay",
                        "name": "relay",
                        "type": "tuple"
                    },
                    {
                        "internalType": "address",
                        "name": "user",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "recipient",
                        "type": "address"
                    }
                ],
                "internalType": "struct IBeefyZapRouter.Order",
                "name": "_order",
                "type": "tuple"
            },
            {
                "components": [
                    {
                        "internalType": "address",
                        "name": "target",
                        "type": "address"
                    },
                    {
                        "internalType": "uint256",
                        "name": "value",
                        "type": "uint256"
                    },
                    {
                        "internalType": "bytes",
                        "name": "data",
                        "type": "bytes"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "int32",
                                "name": "index",
                                "type": "int32"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.StepToken[]",
                        "name": "tokens",
                        "type": "tuple[]"
                    }
                ],
                "internalType": "struct IBeefyZapRouter.Step[]",
                "name": "_route",
                "type": "tuple[]"
            }
        ],
        "name": "executeOrder",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    }
] as const

export const BEEFY_ZAP_ROUTER = MAINNET ? '0x6F19Da51d488926C007B9eBaa5968291a2eC6a63' : '0x6F19Da51d488926C007B9eBaa5968291a2eC6a63';

// Check if MetaMask is installed
function checkMetaMask(): boolean {
    if (typeof window.ethereum === 'undefined') {
        showStatus('MetaMask is not installed. Please install MetaMask to use this app.', 'error');
        return false;
    }
    return true;
}

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
        const accounts = await window.ethereum?.request({
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

        // Switch to Base if not already
        try {
            await window.ethereum?.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: MAINNET ? base.id : baseSepolia.id }], // Base chainId
            });
        } catch (switchError: any) {
            showStatus(`Chain switch error: ${switchError.message}`, 'error');
            return;
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

    // Create ethers.js provider and signer from window.ethereum
    const ethersProvider = new BrowserProvider(window.ethereum!);
    const signer = await ethersProvider.getSigner(connectedAddress);

    try {
        sendBatchBtn.disabled = true;
        showStatus('Preparing batch transaction...', 'info');

        // beefy zap router txs:
        // https://basescan.org/address/0x6f19da51d488926c007b9ebaa5968291a2ec6a63
        //
        // deposit:
        // https://basescan.org/tx/0x425a893112c0ede5c2603efec74da35890d52387ae3681d69d9a856cc1d0b0a6
        // https://basescan.org/inputdatadecoder?tx=0x425a893112c0ede5c2603efec74da35890d52387ae3681d69d9a856cc1d0b0a6
        //
        // withdraw:
        // https://basescan.org/tx/0x4e56db0202904c496979a4500a988affa7de80e2e3c2ce42068d379a0d7826b8
        // https://basescan.org/inputdatadecoder?tx=0x4e56db0202904c496979a4500a988affa7de80e2e3c2ce42068d379a0d7826b8

        // Contract Address on Base
        // Note: You may need to verify these addresses for Base
        const USDC_ADDRESS: Address = MAINNET ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' : '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // Base USDC
        const VAULT_ADDRESS: Address = "0x09139a80454609b69700836a9ee12db4b5dbb15f";
        const WETH_USDC_ADDRESS: Address = "0xcdac0d6c6c59727a65f871236188350531885c43";
        const WETH_ADDRESS: Address = "0x4200000000000000000000000000000000000006";
        const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';
        const AERODROME_ROUTER: Address = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";

        // USDC has 6 decimals
        const USDC_DECIMALS = 6;
        const AMOUNT = parseUnits('1', USDC_DECIMALS);
        // const AMOUNT = 314981n;

        // Build order structure (same as Beefy Zap integration)
        const order = {
            inputs: [
                // array 1
                {
                    token: USDC_ADDRESS,
                    amount: AMOUNT
                }
            ],
            outputs: [
                // array 1
                {
                    token: VAULT_ADDRESS,
                    minOutputAmount: 5967435617n
                },
                // array 2
                {
                    token: WETH_USDC_ADDRESS,
                    minOutputAmount: 0n
                },
                // array 3
                {
                    token: USDC_ADDRESS, // LP token address
                    minOutputAmount: 0n // Accept any output (same as regular Beefy Zap)
                },
                // array 4
                {
                    token: WETH_ADDRESS,
                    minOutputAmount: 0n
                }
            ],
            relay: {
                target: ZERO_ADDRESS,
                value: 0n,
                data: '0x' as `0x${string}`
            },
            user: connectedAddress,
            recipient: connectedAddress
        }

        // Create deadline (2 hour from now)
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600 * 2);

        const route = [
            {
                target: AERODROME_ROUTER,
                value: 0n,
                data: encodeFunctionData({
                    abi: AERODROME_ROUTER_ABI,
                    functionName: 'addLiquidity',
                    args: [WETH_ADDRESS, USDC_ADDRESS, false, 150448640747705n, 496315n, 148944154340227n, 491351n, BEEFY_ZAP_ROUTER, deadline]
                }),
                // data: "0x" as `0x${string}`,
                tokens: [
                    {
                        token: WETH_ADDRESS,
                        index: 100
                    },
                    {
                        token: USDC_ADDRESS,
                        index: 132
                    }
                ]
            }
        ]

        showStatus('Checking token approvals...', 'info');

        const usdcContract = new Contract(USDC_ADDRESS, USDC_ABI, signer);
        const allowance = await usdcContract.allowance(connectedAddress, BEEFY_ZAP_ROUTER);
        console.log(`Token ${USDC_ADDRESS} allowance to Beefy Zap Router:`, allowance.toString());

        if (allowance < AMOUNT) {
            showStatus(
                `Requesting approval for ${AMOUNT.toString()} tokens...\n` +
                `Current allowance: ${allowance.toString()}`,
                'info'
            );

            try {
                // Request approval for the exact amount needed
                const approveTx = await usdcContract.approve(BEEFY_ZAP_ROUTER, AMOUNT);

                showStatus(
                    `Approval transaction submitted: ${approveTx.hash}\n` +
                    `Waiting for confirmation...`,
                    'info'
                );

                // Wait for the approval transaction to be confirmed
                const approveReceipt = await approveTx.wait();
                console.log('Approval receipt:', approveReceipt);

                showStatus(
                    `✅ Approval confirmed! Proceeding with order execution...`,
                    'success'
                );
            } catch (approveError: any) {
                console.error('Approval error:', approveError);
                showStatus(
                    `❌ Approval failed: ${approveError.message || 'Unknown error'}\n` +
                    `Please approve tokens manually and try again.`,
                    'error'
                );
                sendBatchBtn.disabled = false;
                return;
            }
        } else {
            console.log(`Token ${USDC_ADDRESS} has sufficient allowance`);
        }

        // Debug: Encode the function data to see what selector we're generating
        // Use the filtered ABI to ensure we're using the correct function signature
        const encodedData = encodeFunctionData({
            abi: BEEFY_ZAP_EXECUTE_ORDER_ABI,
            functionName: 'executeOrder',
            args: [order, route]
        });
        console.log('Encoded function selector:', encodedData.slice(0, 10));
        console.log('Using executeOrder (payable, no Permit2)');

        showStatus('Preparing transaction with ethers.js...', 'info');

        // Create contract instance with ethers.js signer
        const beefyZapContract = new Contract(BEEFY_ZAP_ROUTER, BEEFY_ZAP_EXECUTE_ORDER_ABI, signer);

        // Estimate gas using ethers.js
        try {
            const gasEstimate = await beefyZapContract.executeOrder.estimateGas(order, route);
            console.log('Gas estimate:', gasEstimate.toString());
            showStatus(`Gas estimated: ${gasEstimate.toString()}`, 'info');
        } catch (gasError: any) {
            console.warn('Gas estimation failed:', gasError);
            showStatus(
                `⚠️ Gas estimation failed: ${gasError.message}\n` +
                `Proceeding with default gas limit...`,
                'info'
            );
        }

        showStatus('Submitting transaction...', 'info');

        // Execute the order with ethers.js
        const executeOrderTx = await beefyZapContract.executeOrder(order, route, {
            gasLimit: 1000000n, // Increased default gas limit
        });

        showStatus(
            `Transaction submitted: ${executeOrderTx.hash}\n` +
            `Waiting for confirmation...`,
            'info'
        );

        const executeOrderReceipt = await executeOrderTx.wait();
        console.log('Execute order receipt:', executeOrderReceipt);

        showStatus(
            `✅ Transaction confirmed! Hash: ${executeOrderReceipt.hash}\n\n` +
            `Block: ${executeOrderReceipt.blockNumber}\n` +
            `Gas used: ${executeOrderReceipt.gasUsed.toString()}`,
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

